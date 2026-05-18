import { createHash } from "node:crypto";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  maskRectsSchema,
  normalizeExamOptions,
  normalizeQuestionType,
  parseExamOptions,
  parseMaskRects,
} from "@/lib/exam";
import { absoluteImagePath, getLibraryRoot, sanitizeFileName } from "@/lib/storage";

const backupFormat = "brooks-pa-atlas.backup";
const backupVersion = 2;
const imageZipPrefix = "images/";

const ocrStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "SKIPPED"]);
const examPaperStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);
const examQuestionStatusSchema = z.enum(["DRAFT", "READY"]);
const examQuestionTypeSchema = z.enum(["SINGLE", "MULTIPLE"]);
const examAttemptStatusSchema = z.enum(["IN_PROGRESS", "SUBMITTED"]);

const backupIndexSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  parentPath: z.string().nullable(),
  depth: z.number().int().min(0),
  path: z.string().min(1),
  sortOrder: z.number().int(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

const backupImageSchema = z.object({
  originalName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().nullable(),
  notes: z.string().nullable(),
  ocrText: z.string().nullable(),
  ocrStatus: ocrStatusSchema,
  ocrError: z.string().nullable(),
  ocrUpdatedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  indexPath: z.string().nullable(),
  imagePath: z.string().min(1),
});

const backupExamQuestionSchema = z.object({
  id: z.string().optional(),
  imageHash: z.string().regex(/^[a-f0-9]{64}$/),
  questionType: examQuestionTypeSchema.optional().default("SINGLE"),
  prompt: z.string(),
  options: z.array(z.string()),
  correctOption: z.string().nullable(),
  explanation: z.string(),
  maskRects: maskRectsSchema,
  status: examQuestionStatusSchema,
  sortOrder: z.number().int(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const backupExamPaperSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: examPaperStatusSchema,
  defaultOptions: z.array(z.string()),
  publishedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  questions: z.array(backupExamQuestionSchema),
});

const backupExamAttemptAnswerSchema = z.object({
  questionImageHash: z.string().regex(/^[a-f0-9]{64}$/),
  order: z.number().int().min(0),
  userAnswer: z.string().nullable(),
  isCorrect: z.boolean(),
});

const backupExamAttemptSchema = z.object({
  id: z.string().optional(),
  paperId: z.string().optional(),
  paperTitle: z.string().min(1),
  status: examAttemptStatusSchema,
  startedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  totalCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  answers: z.array(backupExamAttemptAnswerSchema),
});

const backupManifestSchema = z.object({
  format: z.literal(backupFormat),
  version: z.union([z.literal(1), z.literal(backupVersion)]),
  exportedAt: z.string(),
  indexes: z.array(backupIndexSchema),
  images: z.array(backupImageSchema),
  exams: z.array(backupExamPaperSchema).optional().default([]),
  examAttempts: z.array(backupExamAttemptSchema).optional().default([]),
});

type BackupManifest = z.infer<typeof backupManifestSchema>;
type BackupImage = z.infer<typeof backupImageSchema>;

type PreparedImage = {
  image: BackupImage;
  fullPath: string;
};

type RestoreStats = {
  indexesCreated: number;
  indexesUpdated: number;
  imagesCreated: number;
  imagesUpdated: number;
  filesRestored: number;
  examPapersRestored: number;
  examAttemptsRestored: number;
};

type RestoreLogMetadata = Record<string, boolean | number | string | null | undefined>;

type RestoreOptions = {
  log?: (message: string, metadata?: RestoreLogMetadata) => void;
  onImageProgress?: (progress: { processedImages: number; totalImages: number }) => void;
};

type BackupOptions = {
  indexId?: string | null;
  onImageProgress?: (progress: { processedImages: number; totalImages: number }) => void;
};

type ZipSource = Buffer | { filePath: string };

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampForFileName(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
}

function rebaseSubtreePath(pathValue: string, rootPath: string) {
  const rootName = rootPath.split(" / ").at(-1) ?? rootPath;
  return pathValue === rootPath ? rootName : `${rootName} / ${pathValue.slice(rootPath.length + 3)}`;
}

function extensionForBackup(libraryPath: string, originalName: string, mimeType: string) {
  const fromLibraryPath = path.posix.extname(libraryPath).toLowerCase();
  if (fromLibraryPath) {
    return fromLibraryPath;
  }

  const fromOriginalName = path.extname(originalName).toLowerCase();
  if (fromOriginalName) {
    return fromOriginalName;
  }

  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    case "image/tiff":
      return ".tif";
    default:
      return ".img";
  }
}

function libraryRelativePath(fullPath: string) {
  return path.relative(/*turbopackIgnore: true*/ process.cwd(), fullPath).replace(/\\/g, "/");
}

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertSafeZipEntryName(entryName: string) {
  if (
    !entryName ||
    entryName.includes("\\") ||
    entryName.includes("\0") ||
    entryName.startsWith("/") ||
    /^[a-zA-Z]:/.test(entryName)
  ) {
    throw new Error(`Unsafe zip entry path: ${entryName || "(empty)"}`);
  }

  const parts = entryName.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe zip entry path: ${entryName}`);
  }

  if (path.posix.normalize(entryName) !== entryName) {
    throw new Error(`Unsafe zip entry path: ${entryName}`);
  }
}

function assertManifestImagePath(imagePath: string, hash: string) {
  assertSafeZipEntryName(imagePath);
  if (!imagePath.startsWith(imageZipPrefix)) {
    throw new Error(`Backup image path must be under ${imageZipPrefix}: ${imagePath}`);
  }

  const fileName = imagePath.slice(imageZipPrefix.length);
  if (!fileName.startsWith(hash)) {
    throw new Error(`Backup image path does not match hash: ${imagePath}`);
  }
}

function openZip(source: ZipSource) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    const options = { lazyEntries: true, strictFileNames: true, validateEntrySizes: true };
    const callback = (error: Error | null, zipFile?: yauzl.ZipFile) => {
      if (error) {
        reject(error);
        return;
      }

      if (!zipFile) {
        reject(new Error("Backup zip could not be opened."));
        return;
      }

      resolve(zipFile);
    };

    if (Buffer.isBuffer(source)) {
      yauzl.fromBuffer(source, options, callback);
    } else {
      yauzl.open(source.filePath, options, callback);
    }
  });
}

function openReadStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<Readable>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stream);
    });
  });
}

function readStreamToBuffer(stream: Readable) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function readZipEntries(
  source: ZipSource,
  onEntry: (zipFile: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>,
) {
  const zipFile = await openZip(source);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    function finish(error?: unknown) {
      if (settled) {
        return;
      }

      settled = true;
      zipFile.close();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    zipFile.on("error", finish);
    zipFile.on("end", () => finish());
    zipFile.on("entry", (entry: yauzl.Entry) => {
      void onEntry(zipFile, entry).then(
        () => zipFile.readEntry(),
        (error) => finish(error),
      );
    });

    zipFile.readEntry();
  });
}

async function readManifestAndEntryNames(source: ZipSource) {
  const manifestState: { buffer: Buffer | null } = { buffer: null };
  const entryNames = new Set<string>();

  await readZipEntries(source, async (zipFile, entry) => {
    assertSafeZipEntryName(entry.fileName);
    entryNames.add(entry.fileName);

    if (entry.fileName === "manifest.json") {
      manifestState.buffer = await readStreamToBuffer(await openReadStream(zipFile, entry));
    }
  });

  if (!manifestState.buffer) {
    throw new Error("Backup zip is missing manifest.json.");
  }

  const manifest = backupManifestSchema.parse(JSON.parse(manifestState.buffer.toString("utf8")));
  const expectedImagePaths = new Set<string>();

  for (const image of manifest.images) {
    assertManifestImagePath(image.imagePath, image.hash);
    if (expectedImagePaths.has(image.imagePath)) {
      throw new Error(`Duplicate image path in manifest: ${image.imagePath}`);
    }

    expectedImagePaths.add(image.imagePath);
  }

  for (const entryName of entryNames) {
    if (entryName === "manifest.json") {
      continue;
    }

    if (!expectedImagePaths.has(entryName)) {
      throw new Error(`Unexpected zip entry: ${entryName}`);
    }
  }

  for (const expectedImagePath of expectedImagePaths) {
    if (!entryNames.has(expectedImagePath)) {
      throw new Error(`Backup zip is missing image entry: ${expectedImagePath}`);
    }
  }

  return manifest;
}

async function zipSourceSize(source: ZipSource) {
  if (Buffer.isBuffer(source)) {
    return source.length;
  }

  return (await stat(source.filePath)).size;
}

async function currentImageFileExists(libraryPath: string | null | undefined) {
  if (!libraryPath) {
    return false;
  }

  try {
    await access(absoluteImagePath(libraryPath));
    return true;
  } catch {
    return false;
  }
}

async function saveRestoredImage(image: BackupImage, buffer: Buffer) {
  const ext = path.posix.extname(image.imagePath).toLowerCase() || ".img";
  const createdAt = parseDate(image.createdAt) ?? new Date();
  const yearMonth = createdAt.toISOString().slice(0, 7);
  const folder = path.join(getLibraryRoot(), yearMonth);
  await mkdir(folder, { recursive: true });

  const safeName =
    sanitizeFileName(path.basename(image.originalName, path.extname(image.originalName))) || "chart";
  const fileName = `${safeName}-${image.hash.slice(0, 16)}${ext}`;
  const fullPath = path.join(folder, fileName);
  await writeFile(fullPath, buffer);

  return libraryRelativePath(fullPath);
}

export async function createBackupZip(options: BackupOptions = {}) {
  const allIndexes = await prisma.indexNode.findMany({
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const rootIndex = options.indexId
    ? allIndexes.find((index) => index.id === options.indexId)
    : null;

  if (options.indexId && !rootIndex) {
    throw new Error("Backup index was not found.");
  }

  const indexes = rootIndex
    ? allIndexes.filter(
        (index) => index.id === rootIndex.id || index.path.startsWith(`${rootIndex.path} / `),
      )
    : allIndexes;
  const indexIds = new Set(indexes.map((index) => index.id));
  const images = await prisma.chartImage.findMany({
    where: rootIndex ? { indexNodeId: { in: [...indexIds] } } : undefined,
    orderBy: [{ originalName: "asc" }, { createdAt: "asc" }],
    include: { indexNode: true },
  });
  const [examPapers, examAttempts] = rootIndex
    ? [[], []] as const
    : await Promise.all([
        prisma.examPaper.findMany({
          orderBy: [{ createdAt: "asc" }],
          include: {
            questions: {
              include: { image: true },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
          },
        }),
        prisma.examAttempt.findMany({
          orderBy: [{ createdAt: "asc" }],
          include: {
            paper: true,
            answers: {
              include: { question: { include: { image: true } } },
              orderBy: { order: "asc" },
            },
          },
        }),
      ]);
  const indexPathById = new Map(indexes.map((index) => [index.id, index.path]));
  const exportPathByOriginalPath = new Map(
    indexes.map((index) => [
      index.path,
      rootIndex ? rebaseSubtreePath(index.path, rootIndex.path) : index.path,
    ]),
  );
  const preparedImages: PreparedImage[] = [];
  let processedImages = 0;

  for (const image of images) {
    const fullPath = absoluteImagePath(image.libraryPath);
    let fileStat;

    try {
      fileStat = await stat(fullPath);
    } catch {
      throw new Error(`Image file is missing: ${image.libraryPath}`);
    }

    const ext = extensionForBackup(image.libraryPath, image.originalName, image.mimeType);
    const imagePath = `${imageZipPrefix}${image.hash}${ext}`;
    preparedImages.push({
      fullPath,
      image: {
        originalName: image.originalName,
        mimeType: image.mimeType,
        sizeBytes: fileStat.size,
        width: image.width,
        height: image.height,
        hash: image.hash,
        title: image.title,
        notes: image.notes,
        ocrText: image.ocrText,
        ocrStatus: image.ocrStatus,
        ocrError: image.ocrError,
        ocrUpdatedAt: iso(image.ocrUpdatedAt),
        createdAt: iso(image.createdAt),
        updatedAt: iso(image.updatedAt),
        indexPath: image.indexNode?.path ? exportPathByOriginalPath.get(image.indexNode.path) ?? null : null,
        imagePath,
      },
    });
    processedImages += 1;
    options.onImageProgress?.({ processedImages, totalImages: images.length });
  }

  const manifest: BackupManifest = {
    format: backupFormat,
    version: rootIndex ? 1 : backupVersion,
    exportedAt: new Date().toISOString(),
    indexes: indexes.map((index) => ({
      id: index.id,
      name: index.name,
      parentPath:
        rootIndex && index.id === rootIndex.id
          ? null
          : index.parentId
            ? exportPathByOriginalPath.get(indexPathById.get(index.parentId) ?? "") ?? null
            : null,
      depth: rootIndex ? index.depth - rootIndex.depth : index.depth,
      path: exportPathByOriginalPath.get(index.path) ?? index.path,
      sortOrder: index.sortOrder,
      createdAt: iso(index.createdAt),
      updatedAt: iso(index.updatedAt),
    })),
    images: preparedImages.map((item) => item.image),
    exams: rootIndex
      ? []
      : examPapers.map((paper) => ({
          id: paper.id,
          title: paper.title,
          description: paper.description,
          status: paper.status,
          defaultOptions: parseExamOptions(paper.defaultOptionsJson),
          publishedAt: iso(paper.publishedAt),
          createdAt: iso(paper.createdAt),
          updatedAt: iso(paper.updatedAt),
          questions: paper.questions.map((question) => ({
            id: question.id,
            imageHash: question.image.hash,
            questionType: question.questionType,
            prompt: question.prompt,
            options: parseExamOptions(question.optionsJson),
            correctOption: question.correctOption,
            explanation: question.explanation,
            maskRects: parseMaskRects(question.maskRectsJson),
            status: question.status,
            sortOrder: question.sortOrder,
            createdAt: iso(question.createdAt),
            updatedAt: iso(question.updatedAt),
          })),
        })),
    examAttempts: rootIndex
      ? []
      : examAttempts.map((attempt) => ({
          id: attempt.id,
          paperId: attempt.paperId,
          paperTitle: attempt.paper.title,
          status: attempt.status,
          startedAt: iso(attempt.startedAt),
          submittedAt: iso(attempt.submittedAt),
          durationSeconds: attempt.durationSeconds,
          totalCount: attempt.totalCount,
          correctCount: attempt.correctCount,
          accuracy: attempt.accuracy,
          createdAt: iso(attempt.createdAt),
          updatedAt: iso(attempt.updatedAt),
          answers: attempt.answers.map((answer) => ({
            questionImageHash: answer.question.image.hash,
            order: answer.order,
            userAnswer: answer.userAnswer,
            isCorrect: answer.isCorrect,
          })),
        })),
  };

  const zipFile = new yazl.ZipFile();
  zipFile.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json", {
    mtime: new Date(),
  });

  for (const item of preparedImages) {
    zipFile.addFile(item.fullPath, item.image.imagePath, {
      mtime: parseDate(item.image.updatedAt) ?? new Date(),
    });
  }

  zipFile.end();

  return {
    fileName: rootIndex
      ? `brooks-pa-atlas-${sanitizeFileName(rootIndex.name) || "index"}-${timestampForFileName()}.zip`
      : `brooks-pa-atlas-backup-${timestampForFileName()}.zip`,
    stream: Readable.toWeb(zipFile.outputStream) as ReadableStream<Uint8Array>,
  };
}

async function restoreBackupSource(
  source: ZipSource,
  options: RestoreOptions = {},
): Promise<RestoreStats> {
  const log = options.log ?? (() => {});
  log("zip validation started", { zipBytes: await zipSourceSize(source) });
  const manifest = await readManifestAndEntryNames(source);
  log("manifest loaded", {
    exportedAt: manifest.exportedAt,
    indexes: manifest.indexes.length,
    images: manifest.images.length,
  });

  const stats: RestoreStats = {
    indexesCreated: 0,
    indexesUpdated: 0,
    imagesCreated: 0,
    imagesUpdated: 0,
    filesRestored: 0,
    examPapersRestored: 0,
    examAttemptsRestored: 0,
  };
  const indexIdByPath = new Map<string, string>();
  const sortedIndexes = [...manifest.indexes].sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.path.localeCompare(right.path);
  });

  log("index restore started", { indexes: sortedIndexes.length });
  for (const index of sortedIndexes) {
    const parentId = index.parentPath ? indexIdByPath.get(index.parentPath) : null;

    if (index.parentPath && !parentId) {
      throw new Error(`Backup index is missing parent: ${index.parentPath}`);
    }

    const existing = await prisma.indexNode.findFirst({
      where: { parentId, name: index.name },
    });

    if (existing) {
      const updated = await prisma.indexNode.update({
        where: { id: existing.id },
        data: {
          depth: index.depth,
          path: index.path,
          sortOrder: index.sortOrder,
        },
      });
      indexIdByPath.set(index.path, updated.id);
      stats.indexesUpdated += 1;
    } else {
      const created = await prisma.indexNode.create({
        data: {
          name: index.name,
          parentId,
          depth: index.depth,
          path: index.path,
          sortOrder: index.sortOrder,
          createdAt: parseDate(index.createdAt) ?? undefined,
        },
      });
      indexIdByPath.set(index.path, created.id);
      stats.indexesCreated += 1;
    }
  }
  log("index restore completed", {
    indexesCreated: stats.indexesCreated,
    indexesUpdated: stats.indexesUpdated,
  });

  const imagesByPath = new Map(manifest.images.map((image) => [image.imagePath, image]));
  let processedImages = 0;

  log("image restore started", { images: manifest.images.length });
  await readZipEntries(source, async (zipFile, entry) => {
    const image = imagesByPath.get(entry.fileName);
    if (!image) {
      return;
    }

    processedImages += 1;

    try {
      const imageBuffer = await readStreamToBuffer(await openReadStream(zipFile, entry));
      const actualHash = hashBuffer(imageBuffer);

      if (actualHash !== image.hash) {
        throw new Error(`Image hash mismatch: ${image.imagePath}`);
      }

      if (imageBuffer.length !== image.sizeBytes) {
        throw new Error(`Image size mismatch: ${image.imagePath}`);
      }

      const existing = await prisma.chartImage.findUnique({ where: { hash: image.hash } });
      const existingFileOk = await currentImageFileExists(existing?.libraryPath);
      const libraryPath =
        existingFileOk && existing ? existing.libraryPath : await saveRestoredImage(image, imageBuffer);

      if (!existingFileOk) {
        stats.filesRestored += 1;
      }

      const indexNodeId = image.indexPath ? indexIdByPath.get(image.indexPath) ?? null : null;

      if (image.indexPath && !indexNodeId) {
        throw new Error(`Backup image references a missing index: ${image.indexPath}`);
      }

      const imageData = {
        libraryPath,
        originalName: image.originalName,
        mimeType: image.mimeType,
        sizeBytes: imageBuffer.length,
        width: image.width,
        height: image.height,
        title: image.title,
        notes: image.notes,
        ocrText: image.ocrText,
        ocrStatus: image.ocrStatus,
        ocrError: image.ocrError,
        ocrUpdatedAt: parseDate(image.ocrUpdatedAt),
        indexNodeId,
      };

      if (existing) {
        await prisma.chartImage.update({
          where: { id: existing.id },
          data: imageData,
        });
        stats.imagesUpdated += 1;
      } else {
        await prisma.chartImage.create({
          data: {
            ...imageData,
            hash: image.hash,
            createdAt: parseDate(image.createdAt) ?? undefined,
          },
        });
        stats.imagesCreated += 1;
      }

      if (processedImages === 1 || processedImages % 100 === 0 || processedImages === manifest.images.length) {
        log("image restore progress", {
          processedImages,
          totalImages: manifest.images.length,
          imagesCreated: stats.imagesCreated,
          imagesUpdated: stats.imagesUpdated,
          filesRestored: stats.filesRestored,
        });
      }
      options.onImageProgress?.({ processedImages, totalImages: manifest.images.length });
    } catch (error) {
      log("image restore failed", {
        processedImages,
        imagePath: image.imagePath,
        originalName: image.originalName,
        hash: image.hash,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  });

  log("image restore completed", {
    imagesCreated: stats.imagesCreated,
    imagesUpdated: stats.imagesUpdated,
    filesRestored: stats.filesRestored,
  });

  if (manifest.version >= 2 && manifest.exams.length > 0) {
    const imagesByHash = new Map(
      (
        await prisma.chartImage.findMany({
          where: { hash: { in: manifest.images.map((image) => image.hash) } },
          select: { id: true, hash: true },
        })
      ).map((image) => [image.hash, image.id]),
    );
    const paperIdByBackupId = new Map<string, string>();
    const questionIdByPaperAndImageHash = new Map<string, string>();

    log("exam restore started", {
      papers: manifest.exams.length,
      attempts: manifest.examAttempts.length,
    });

    for (const paper of manifest.exams) {
      const existing = paper.id
        ? await prisma.examPaper.findUnique({ where: { id: paper.id } })
        : null;
      const paperData = {
        title: paper.title,
        description: paper.description,
        status: paper.status,
        defaultOptionsJson: JSON.stringify(normalizeExamOptions(paper.defaultOptions)),
        publishedAt: parseDate(paper.publishedAt),
        createdAt: parseDate(paper.createdAt) ?? undefined,
      };
      const restoredPaper = existing
        ? await prisma.examPaper.update({
            where: { id: existing.id },
            data: {
              title: paperData.title,
              description: paperData.description,
              status: paperData.status,
              defaultOptionsJson: paperData.defaultOptionsJson,
              publishedAt: paperData.publishedAt,
            },
          })
        : await prisma.examPaper.create({
            data: {
              id: paper.id,
              ...paperData,
            },
          });

      if (paper.id) {
        paperIdByBackupId.set(paper.id, restoredPaper.id);
      }
      stats.examPapersRestored += 1;

      for (const question of paper.questions) {
        const chartImageId = imagesByHash.get(question.imageHash);
        if (!chartImageId) {
          throw new Error(`Backup exam question references a missing image: ${question.imageHash}`);
        }

        const existingQuestion = await prisma.examQuestion.findFirst({
          where: { paperId: restoredPaper.id, chartImageId },
        });
        const questionData = {
          paperId: restoredPaper.id,
          chartImageId,
          questionType: normalizeQuestionType(question.questionType),
          prompt: question.prompt,
          optionsJson: JSON.stringify(normalizeExamOptions(question.options)),
          correctOption: question.correctOption,
          explanation: question.explanation,
          maskRectsJson: JSON.stringify(question.maskRects),
          status: question.status,
          sortOrder: question.sortOrder,
          createdAt: parseDate(question.createdAt) ?? undefined,
        };
        const restoredQuestion = existingQuestion
          ? await prisma.examQuestion.update({
              where: { id: existingQuestion.id },
              data: {
                questionType: questionData.questionType,
                prompt: questionData.prompt,
                optionsJson: questionData.optionsJson,
                correctOption: questionData.correctOption,
                explanation: questionData.explanation,
                maskRectsJson: questionData.maskRectsJson,
                status: questionData.status,
                sortOrder: questionData.sortOrder,
              },
            })
          : await prisma.examQuestion.create({
              data: {
                id: question.id,
                ...questionData,
              },
            });

        questionIdByPaperAndImageHash.set(
          `${restoredPaper.id}:${question.imageHash}`,
          restoredQuestion.id,
        );
      }
    }

    for (const attempt of manifest.examAttempts) {
      const paperId = attempt.paperId ? paperIdByBackupId.get(attempt.paperId) : null;
      if (!paperId) {
        continue;
      }

      const existingAttempt = attempt.id
        ? await prisma.examAttempt.findUnique({ where: { id: attempt.id } })
        : null;
      const attemptData = {
        paperId,
        status: attempt.status,
        startedAt: parseDate(attempt.startedAt) ?? new Date(),
        submittedAt: parseDate(attempt.submittedAt),
        durationSeconds: attempt.durationSeconds,
        totalCount: attempt.totalCount,
        correctCount: attempt.correctCount,
        accuracy: attempt.accuracy,
        createdAt: parseDate(attempt.createdAt) ?? undefined,
      };
      const restoredAttempt = existingAttempt
        ? await prisma.examAttempt.update({
            where: { id: existingAttempt.id },
            data: {
              paperId: attemptData.paperId,
              status: attemptData.status,
              startedAt: attemptData.startedAt,
              submittedAt: attemptData.submittedAt,
              durationSeconds: attemptData.durationSeconds,
              totalCount: attemptData.totalCount,
              correctCount: attemptData.correctCount,
              accuracy: attemptData.accuracy,
            },
          })
        : await prisma.examAttempt.create({
            data: {
              id: attempt.id,
              ...attemptData,
            },
          });

      await prisma.examAttemptAnswer.deleteMany({
        where: { attemptId: restoredAttempt.id },
      });

      for (const answer of attempt.answers) {
        const questionId = questionIdByPaperAndImageHash.get(
          `${paperId}:${answer.questionImageHash}`,
        );
        if (!questionId) {
          throw new Error(`Backup exam answer references a missing question: ${answer.questionImageHash}`);
        }

        await prisma.examAttemptAnswer.create({
          data: {
            attemptId: restoredAttempt.id,
            questionId,
            order: answer.order,
            userAnswer: answer.userAnswer,
            isCorrect: answer.isCorrect,
          },
        });
      }
      stats.examAttemptsRestored += 1;
    }

    log("exam restore completed", {
      examPapersRestored: stats.examPapersRestored,
      examAttemptsRestored: stats.examAttemptsRestored,
    });
  }

  log("restore completed", stats);
  return stats;
}

export async function restoreBackupZip(
  buffer: Buffer,
  options: RestoreOptions = {},
): Promise<RestoreStats> {
  return restoreBackupSource(buffer, options);
}

export async function restoreBackupZipFromFile(
  filePath: string,
  options: RestoreOptions = {},
): Promise<RestoreStats> {
  return restoreBackupSource({ filePath }, options);
}
