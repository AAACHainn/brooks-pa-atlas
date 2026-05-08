import { createHash } from "node:crypto";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { absoluteImagePath, getLibraryRoot, sanitizeFileName } from "@/lib/storage";

const backupFormat = "brooks-pa-atlas.backup";
const backupVersion = 1;
const imageZipPrefix = "images/";

const ocrStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "SKIPPED"]);

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

const backupManifestSchema = z.object({
  format: z.literal(backupFormat),
  version: z.literal(backupVersion),
  exportedAt: z.string(),
  indexes: z.array(backupIndexSchema),
  images: z.array(backupImageSchema),
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
};

type RestoreLogMetadata = Record<string, boolean | number | string | null | undefined>;

type RestoreOptions = {
  log?: (message: string, metadata?: RestoreLogMetadata) => void;
};

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

function openZip(buffer: Buffer) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zipFile) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(zipFile);
      },
    );
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
  buffer: Buffer,
  onEntry: (zipFile: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>,
) {
  const zipFile = await openZip(buffer);

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

async function readManifestAndEntryNames(buffer: Buffer) {
  const manifestState: { buffer: Buffer | null } = { buffer: null };
  const entryNames = new Set<string>();

  await readZipEntries(buffer, async (zipFile, entry) => {
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

export async function createBackupZip() {
  const [indexes, images] = await Promise.all([
    prisma.indexNode.findMany({
      orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.chartImage.findMany({
      orderBy: [{ originalName: "asc" }, { createdAt: "asc" }],
      include: { indexNode: true },
    }),
  ]);
  const indexPathById = new Map(indexes.map((index) => [index.id, index.path]));
  const preparedImages: PreparedImage[] = [];

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
        indexPath: image.indexNode?.path ?? null,
        imagePath,
      },
    });
  }

  const manifest: BackupManifest = {
    format: backupFormat,
    version: backupVersion,
    exportedAt: new Date().toISOString(),
    indexes: indexes.map((index) => ({
      id: index.id,
      name: index.name,
      parentPath: index.parentId ? indexPathById.get(index.parentId) ?? null : null,
      depth: index.depth,
      path: index.path,
      sortOrder: index.sortOrder,
      createdAt: iso(index.createdAt),
      updatedAt: iso(index.updatedAt),
    })),
    images: preparedImages.map((item) => item.image),
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
    fileName: `brooks-pa-atlas-backup-${timestampForFileName()}.zip`,
    stream: Readable.toWeb(zipFile.outputStream) as ReadableStream<Uint8Array>,
  };
}

export async function restoreBackupZip(
  buffer: Buffer,
  options: RestoreOptions = {},
): Promise<RestoreStats> {
  const log = options.log ?? (() => {});
  log("zip validation started", { zipBytes: buffer.length });
  const manifest = await readManifestAndEntryNames(buffer);
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
  await readZipEntries(buffer, async (zipFile, entry) => {
    const image = imagesByPath.get(entry.fileName);
    if (!image) {
      return;
    }

    processedImages += 1;

    try {
      const buffer = await readStreamToBuffer(await openReadStream(zipFile, entry));
      const actualHash = hashBuffer(buffer);

      if (actualHash !== image.hash) {
        throw new Error(`Image hash mismatch: ${image.imagePath}`);
      }

      if (buffer.length !== image.sizeBytes) {
        throw new Error(`Image size mismatch: ${image.imagePath}`);
      }

      const existing = await prisma.chartImage.findUnique({ where: { hash: image.hash } });
      const existingFileOk = await currentImageFileExists(existing?.libraryPath);
      const libraryPath =
        existingFileOk && existing ? existing.libraryPath : await saveRestoredImage(image, buffer);

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
        sizeBytes: buffer.length,
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
  log("restore completed", stats);
  return stats;
}
