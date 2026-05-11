import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { createCanvas, Path2D } from "@napi-rs/canvas/node-canvas.js";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

import type { DocumentImporter } from "@/lib/document-importers";

import { ensureIndexPath } from "@/lib/index-tree";
import { importImageBuffer } from "@/lib/import-images";
import { prisma } from "@/lib/db";
import { sanitizeFileName } from "@/lib/storage";
import { scheduleOcrPump, updateBatchCounters } from "@/lib/ocr-queue";

type OutlineNode = {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineNode[];
};

type OutlineEntry = {
  pageNumber: number;
  path: string[];
  depth: number;
  order: number;
};

const pdfMimeTypes = new Set(["application/pdf", "application/x-pdf"]);
const defaultPdfRenderScale = 1.5;
const defaultPdfMaxImageEdge = 1800;
const defaultPdfJpegQuality = 82;
const requireFromProject = createRequire(`${process.cwd()}${path.sep}`);
const drawOps = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

function configurePdfWorker() {
  const workerPath = requireFromProject.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}

function isPdf(file: File) {
  return pdfMimeTypes.has(file.type) || /\.pdf$/i.test(file.name);
}

function sanitizeIndexSegment(value: string, fallback: string) {
  return sanitizeFileName(value).replace(/\s+/g, " ").trim() || fallback;
}

function pdfStem(fileName: string) {
  return sanitizeIndexSegment(path.basename(fileName, path.extname(fileName)), "document");
}

function pageFileName(stem: string, pageNumber: number, pageCount: number) {
  const width = Math.max(3, String(pageCount).length);
  return `${stem}-p${String(pageNumber).padStart(width, "0")}.jpg`;
}

function numberFromEnv(name: string, fallback: number, options: { min: number; max: number }) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(options.max, Math.max(options.min, parsed));
}

function getPdfRenderOptions() {
  return {
    scale: numberFromEnv("BROOKS_PDF_RENDER_SCALE", defaultPdfRenderScale, {
      min: 0.5,
      max: 3,
    }),
    maxImageEdge: Math.round(
      numberFromEnv("BROOKS_PDF_MAX_IMAGE_EDGE", defaultPdfMaxImageEdge, {
        min: 800,
        max: 4000,
      }),
    ),
    jpegQuality: Math.round(
      numberFromEnv("BROOKS_PDF_JPEG_QUALITY", defaultPdfJpegQuality, {
        min: 40,
        max: 95,
      }),
    ),
  };
}

function pathFromDrawOps(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  const path = new Path2D();
  for (let index = 0; index < value.length;) {
    switch (value[index++]) {
      case drawOps.moveTo:
        path.moveTo(Number(value[index++]), Number(value[index++]));
        break;
      case drawOps.lineTo:
        path.lineTo(Number(value[index++]), Number(value[index++]));
        break;
      case drawOps.curveTo:
        path.bezierCurveTo(
          Number(value[index++]),
          Number(value[index++]),
          Number(value[index++]),
          Number(value[index++]),
          Number(value[index++]),
          Number(value[index++]),
        );
        break;
      case drawOps.quadraticCurveTo:
        path.quadraticCurveTo(
          Number(value[index++]),
          Number(value[index++]),
          Number(value[index++]),
          Number(value[index++]),
        );
        break;
      case drawOps.closePath:
        path.closePath();
        break;
      default:
        console.warn("[pdf-import] unknown draw op", { op: value[index - 1] });
        break;
    }
  }

  return path;
}

function patchPdfRenderContext(context: CanvasRenderingContext2D) {
  const target = context as CanvasRenderingContext2D & {
    clip: (...args: unknown[]) => void;
    fill: (...args: unknown[]) => void;
    stroke: (...args: unknown[]) => void;
  };
  const originalClip = target.clip.bind(target);
  const originalFill = target.fill.bind(target);
  const originalStroke = target.stroke.bind(target);

  target.clip = (...args: unknown[]) => {
    if (Array.isArray(args[0])) {
      args[0] = pathFromDrawOps(args[0]);
    }
    originalClip(...args);
  };

  target.fill = (...args: unknown[]) => {
    if (Array.isArray(args[0])) {
      args[0] = pathFromDrawOps(args[0]);
    }
    originalFill(...args);
  };

  target.stroke = (...args: unknown[]) => {
    if (Array.isArray(args[0])) {
      args[0] = pathFromDrawOps(args[0]);
    }
    originalStroke(...args);
  };

  return context;
}

async function pageNumberForDest(pdf: PDFDocumentProxy, dest: string | unknown[] | null) {
  if (!dest) {
    return null;
  }

  const explicitDest = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  const pageRef = explicitDest?.[0];

  if (typeof pageRef === "number") {
    return pageRef + 1;
  }

  if (pageRef && typeof pageRef === "object") {
    try {
      return (await pdf.getPageIndex(pageRef as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1;
    } catch {
      return null;
    }
  }

  return null;
}

async function collectOutlineEntries(
  pdf: PDFDocumentProxy,
  nodes: OutlineNode[] | null,
  parentPath: string[],
  entries: OutlineEntry[],
  orderRef: { current: number },
) {
  for (const node of nodes ?? []) {
    const name = sanitizeIndexSegment(node.title, "");
    const nodePath = name ? [...parentPath, name] : parentPath;
    const pageNumber = await pageNumberForDest(pdf, node.dest);

    if (pageNumber !== null && nodePath.length > 0) {
      entries.push({
        pageNumber,
        path: nodePath,
        depth: nodePath.length,
        order: orderRef.current,
      });
      orderRef.current += 1;
    }

    await collectOutlineEntries(pdf, node.items ?? [], nodePath, entries, orderRef);
  }
}

function outlinePathForPage(entries: OutlineEntry[], pageNumber: number) {
  let best: OutlineEntry | null = null;

  for (const entry of entries) {
    if (entry.pageNumber > pageNumber) {
      continue;
    }

    if (
      !best ||
      entry.pageNumber > best.pageNumber ||
      (entry.pageNumber === best.pageNumber && entry.depth > best.depth) ||
      (entry.pageNumber === best.pageNumber && entry.depth === best.depth && entry.order > best.order)
    ) {
      best = entry;
    }
  }

  return best?.path ?? [];
}

async function renderPdfPage(pdf: PDFDocumentProxy, pageNumber: number) {
  const renderOptions = getPdfRenderOptions();
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: renderOptions.scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const canvasContext = patchPdfRenderContext(
    canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
  );

  try {
    await page.render({
      canvas: null,
      canvasContext,
      viewport,
    }).promise;
  } finally {
    page.cleanup();
  }

  return sharp(canvas.toBuffer("image/png"))
    .resize({
      width: renderOptions.maxImageEdge,
      height: renderOptions.maxImageEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: renderOptions.jpegQuality,
      mozjpeg: true,
    })
    .toBuffer();
}

export const pdfImporter: DocumentImporter = {
  kind: "pdf",

  supports: isPdf,

  async importDocument({ file, buffer, baseIndexPath }) {
    configurePdfWorker();
    console.info("[pdf-import] starting", {
      fileName: file.name,
      sizeBytes: file.size,
      baseIndexPath,
      workerSrc: GlobalWorkerOptions.workerSrc,
    });

    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      stopAtErrors: false,
    });

    const pdf = await loadingTask.promise;
    const stem = pdfStem(file.name);
    const containerPath = [...baseIndexPath, stem];
    console.info("[pdf-import] loaded", {
      fileName: file.name,
      pageCount: pdf.numPages,
      containerPath,
    });

    const batch = await prisma.importBatch.create({
      data: {
        status: "IMPORTING",
        totalCount: pdf.numPages,
        startedAt: new Date(),
      },
    });

    let imported = 0;
    let failed = 0;
    let duplicate = 0;

    try {
      await ensureIndexPath(containerPath);

      const outline = (await pdf.getOutline()) as OutlineNode[] | null;
      const outlineEntries: OutlineEntry[] = [];
      await collectOutlineEntries(pdf, outline, [], outlineEntries, { current: 0 });
      console.info("[pdf-import] outline parsed", {
        fileName: file.name,
        topLevelOutlineCount: outline?.length ?? 0,
        mappedOutlineCount: outlineEntries.length,
      });

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const outlinePath = outlinePathForPage(outlineEntries, pageNumber);
        const targetIndexPath = [...containerPath, ...outlinePath];
        const fileName = pageFileName(stem, pageNumber, pdf.numPages);
        const groupKey = outlinePath.length ? outlinePath.join(" / ") : stem;
        const relativePath = `${file.name}/${fileName}`;

        try {
          const imageBuffer = await renderPdfPage(pdf, pageNumber);
          const result = await importImageBuffer({
            batchId: batch.id,
            buffer: imageBuffer,
            fileName,
            mimeType: "image/jpeg",
            sizeBytes: imageBuffer.length,
            relativePath,
            groupKey,
            indexPath: targetIndexPath,
            title: fileName.replace(/\.jpg$/i, ""),
          });

          if (result.status === "DUPLICATE") {
            duplicate += 1;
          } else {
            imported += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "PDF page import failed.";
          console.error("[pdf-import] page failed", {
            fileName: file.name,
            pageNumber,
            message,
            stack: error instanceof Error ? error.stack : null,
          });
          failed += 1;
          await prisma.importItem.create({
            data: {
              batchId: batch.id,
              originalName: fileName,
              relativePath,
              groupKey,
              status: "FAILED",
              error: message.slice(0, 1000),
            },
          });
        }
      }

      const processedCount = await prisma.importItem.count({ where: { batchId: batch.id } });
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "PROCESSING_OCR",
          error: failed > 0 ? `${failed} page(s) failed during document import.` : null,
        },
      });

      await updateBatchCounters(batch.id);
      scheduleOcrPump();
      console.info("[pdf-import] completed", {
        fileName: file.name,
        batchId: batch.id,
        imported,
        duplicate,
        failed,
        processedCount,
      });

      return {
        batchId: batch.id,
        totalCount: pdf.numPages,
        imported,
        failed,
        duplicate,
        processedCount,
      };
    } finally {
      await pdf.destroy();
    }
  },
};
