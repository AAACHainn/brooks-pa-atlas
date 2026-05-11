import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { createCanvas, Path2D } from "@napi-rs/canvas/node-canvas.js";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

import type { DocumentImportProgress, DocumentImporter } from "@/lib/document-importers";

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

type PdfPagePlan = {
  pageNumber: number;
  outlinePath: string[];
  targetIndexPath: string[];
  indexNodeId: string | null;
  fileName: string;
  groupKey: string;
  relativePath: string;
};

type RenderedPdfPage = {
  buffer: Buffer;
  width: number;
  height: number;
};

const pdfMimeTypes = new Set(["application/pdf", "application/x-pdf"]);
const defaultPdfRenderScale = 1.5;
const defaultPdfMaxImageEdge = 1800;
const defaultPdfJpegQuality = 82;
const defaultPdfImportConcurrency = 2;
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

function getPdfImportConcurrency() {
  return Math.round(
    numberFromEnv("BROOKS_PDF_IMPORT_CONCURRENCY", defaultPdfImportConcurrency, {
      min: 1,
      max: 4,
    }),
  );
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        await worker(items[index]);
      }
    }),
  );
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

async function renderPdfPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<RenderedPdfPage> {
  const renderOptions = getPdfRenderOptions();
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const maxBaseEdge = Math.max(baseViewport.width, baseViewport.height);
  const scale = Math.min(
    renderOptions.scale,
    maxBaseEdge > 0 ? renderOptions.maxImageEdge / maxBaseEdge : renderOptions.scale,
  );
  const viewport = page.getViewport({ scale });
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

  return {
    buffer: canvas.toBuffer("image/jpeg", { quality: renderOptions.jpegQuality / 100 }),
    width: canvas.width,
    height: canvas.height,
  };
}

export const pdfImporter: DocumentImporter = {
  kind: "pdf",

  supports: isPdf,

  async importDocument({ file, buffer, baseIndexPath, onProgress }) {
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
    let processedCount = 0;
    let importLock = Promise.resolve();

    async function withImportLock<T>(operation: () => Promise<T>) {
      const previous = importLock;
      let release: () => void = () => undefined;
      importLock = new Promise<void>((resolve) => {
        release = resolve;
      });

      await previous;

      try {
        return await operation();
      } finally {
        release();
      }
    }

    function emitProgress() {
      const progress: DocumentImportProgress = {
        batchId: batch.id,
        totalCount: pdf.numPages,
        processedCount,
        imported,
        failed,
        duplicate,
      };
      onProgress?.(progress);
    }

    try {
      const outline = (await pdf.getOutline()) as OutlineNode[] | null;
      const outlineEntries: OutlineEntry[] = [];
      await collectOutlineEntries(pdf, outline, [], outlineEntries, { current: 0 });
      console.info("[pdf-import] outline parsed", {
        fileName: file.name,
        topLevelOutlineCount: outline?.length ?? 0,
        mappedOutlineCount: outlineEntries.length,
      });

      const pagePlans: PdfPagePlan[] = Array.from({ length: pdf.numPages }, (_, index) => {
        const pageNumber = index + 1;
        const outlinePath = outlinePathForPage(outlineEntries, pageNumber);
        const targetIndexPath = [...containerPath, ...outlinePath];
        const fileName = pageFileName(stem, pageNumber, pdf.numPages);
        const groupKey = outlinePath.length ? outlinePath.join(" / ") : stem;
        const relativePath = `${file.name}/${fileName}`;

        return {
          pageNumber,
          outlinePath,
          targetIndexPath,
          indexNodeId: null,
          fileName,
          groupKey,
          relativePath,
        };
      });

      const indexNodeIdByPath = new Map<string, string | null>();
      for (const targetIndexPath of pagePlans.map((plan) => plan.targetIndexPath)) {
        const cacheKey = JSON.stringify(targetIndexPath);
        if (indexNodeIdByPath.has(cacheKey)) {
          continue;
        }

        const indexNode = await ensureIndexPath(targetIndexPath);
        indexNodeIdByPath.set(cacheKey, indexNode?.id ?? null);
      }

      for (const plan of pagePlans) {
        plan.indexNodeId = indexNodeIdByPath.get(JSON.stringify(plan.targetIndexPath)) ?? null;
      }

      const concurrency = getPdfImportConcurrency();
      console.info("[pdf-import] pages queued", {
        fileName: file.name,
        pageCount: pagePlans.length,
        indexPathCount: indexNodeIdByPath.size,
        concurrency,
      });

      await runWithConcurrency(pagePlans, concurrency, async (plan) => {
        try {
          const renderedPage = await renderPdfPage(pdf, plan.pageNumber);
          const result = await withImportLock(() => importImageBuffer({
            batchId: batch.id,
            buffer: renderedPage.buffer,
            fileName: plan.fileName,
            mimeType: "image/jpeg",
            sizeBytes: renderedPage.buffer.length,
            relativePath: plan.relativePath,
            groupKey: plan.groupKey,
            indexNodeId: plan.indexNodeId,
            dimensions: {
              width: renderedPage.width,
              height: renderedPage.height,
            },
            title: plan.fileName.replace(/\.jpg$/i, ""),
          }));

          if (result.status === "DUPLICATE") {
            duplicate += 1;
          } else {
            imported += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "PDF page import failed.";
          console.error("[pdf-import] page failed", {
            fileName: file.name,
            pageNumber: plan.pageNumber,
            message,
            stack: error instanceof Error ? error.stack : null,
          });
          failed += 1;
          await withImportLock(() => prisma.importItem.create({
            data: {
              batchId: batch.id,
              indexNodeId: plan.indexNodeId,
              originalName: plan.fileName,
              relativePath: plan.relativePath,
              groupKey: plan.groupKey,
              status: "FAILED",
              error: message.slice(0, 1000),
            },
          }));
        } finally {
          processedCount += 1;
          emitProgress();
        }
      });

      const persistedProcessedCount = await prisma.importItem.count({ where: { batchId: batch.id } });
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "PROCESSING_OCR",
          error: failed > 0 ? `${failed} page(s) failed during document import.` : null,
        },
      });

      await updateBatchCounters(batch.id);
      scheduleOcrPump();
      processedCount = persistedProcessedCount;
      emitProgress();
      console.info("[pdf-import] completed", {
        fileName: file.name,
        batchId: batch.id,
        imported,
        duplicate,
        failed,
        processedCount: persistedProcessedCount,
      });

      return {
        batchId: batch.id,
        totalCount: pdf.numPages,
        imported,
        failed,
        duplicate,
        processedCount: persistedProcessedCount,
      };
    } finally {
      await pdf.destroy();
    }
  },
};
