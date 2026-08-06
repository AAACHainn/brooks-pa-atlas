import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { absoluteImagePath } from "@/lib/storage";

export const thumbnailVersion = "1";
export const thumbnailMaxEdge = 420;
export const thumbnailWebpQuality = 72;

const defaultThumbnailRoot = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "data",
  "library",
  "thumbnails",
);

type ThumbnailGenerationResult = {
  path: string;
  generated: boolean;
};

type ThumbnailPromiseStore = Map<string, Promise<ThumbnailGenerationResult>>;

const globalForThumbnails = globalThis as typeof globalThis & {
  brooksThumbnailPromises?: ThumbnailPromiseStore;
};

const generationPromises =
  globalForThumbnails.brooksThumbnailPromises ?? new Map<string, Promise<ThumbnailGenerationResult>>();
globalForThumbnails.brooksThumbnailPromises = generationPromises;

function assertThumbnailHash(hash: string) {
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error("Invalid image hash for thumbnail path.");
  }
  return hash.toLowerCase();
}

function assertThumbnailVersion(version: string) {
  if (version !== thumbnailVersion) {
    throw new Error(`Unsupported thumbnail version: ${version}.`);
  }
  return version;
}

export function getThumbnailRoot() {
  return process.env.BROOKS_THUMBNAIL_ROOT
    ? path.resolve(process.env.BROOKS_THUMBNAIL_ROOT)
    : defaultThumbnailRoot;
}

export function thumbnailPathForHash(hash: string, version = thumbnailVersion) {
  const safeHash = assertThumbnailHash(hash);
  const safeVersion = assertThumbnailVersion(version);
  const versionRoot = path.resolve(getThumbnailRoot(), `v${safeVersion}`);
  const resolved = path.resolve(versionRoot, safeHash.slice(0, 2), `${safeHash}.webp`);
  const relative = path.relative(versionRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Thumbnail path is outside the configured thumbnail root.");
  }

  return resolved;
}

export function thumbnailEtag(hash: string, version = thumbnailVersion) {
  return `"thumbnail-v${assertThumbnailVersion(version)}-${assertThumbnailHash(hash)}"`;
}

export async function thumbnailExists(hash: string, version = thumbnailVersion) {
  try {
    const fileStat = await stat(thumbnailPathForHash(hash, version));
    return fileStat.isFile() && fileStat.size > 0;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "ENOENT") return false;
    throw error;
  }
}

async function generateThumbnail(
  buffer: Buffer,
  hash: string,
  version: string,
): Promise<ThumbnailGenerationResult> {
  const targetPath = thumbnailPathForHash(hash, version);
  if (await thumbnailExists(hash, version)) {
    return { path: targetPath, generated: false };
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;

  try {
    const thumbnailBuffer = await sharp(buffer)
      .rotate()
      .resize({
        width: thumbnailMaxEdge,
        height: thumbnailMaxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: thumbnailWebpQuality })
      .toBuffer();
    await writeFile(temporaryPath, thumbnailBuffer, { flag: "wx" });
    await rename(temporaryPath, targetPath);
    return { path: targetPath, generated: true };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    if (await thumbnailExists(hash, version).catch(() => false)) {
      return { path: targetPath, generated: false };
    }
    throw error;
  }
}

export function ensureThumbnailFromBuffer(
  buffer: Buffer,
  hash: string,
  version = thumbnailVersion,
) {
  const safeHash = assertThumbnailHash(hash);
  const safeVersion = assertThumbnailVersion(version);
  const key = `${safeVersion}:${safeHash}`;
  const existingPromise = generationPromises.get(key);
  if (existingPromise) return existingPromise;

  const promise = generateThumbnail(buffer, safeHash, safeVersion).finally(() => {
    if (generationPromises.get(key) === promise) {
      generationPromises.delete(key);
    }
  });
  generationPromises.set(key, promise);
  return promise;
}

export async function ensureStoredImageThumbnail({
  hash,
  libraryPath,
  version = thumbnailVersion,
}: {
  hash: string;
  libraryPath: string;
  version?: string;
}) {
  if (await thumbnailExists(hash, version)) {
    return { path: thumbnailPathForHash(hash, version), generated: false };
  }
  const source = await readFile(absoluteImagePath(libraryPath));
  return ensureThumbnailFromBuffer(source, hash, version);
}

export async function readThumbnail(hash: string, version = thumbnailVersion) {
  const fullPath = thumbnailPathForHash(hash, version);
  const [buffer, fileStat] = await Promise.all([readFile(fullPath), stat(fullPath)]);
  return { buffer, fileStat };
}

export async function removeThumbnail(hash: string, version = thumbnailVersion) {
  try {
    await unlink(thumbnailPathForHash(hash, version));
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "ENOENT") return false;
    throw error;
  }
}
