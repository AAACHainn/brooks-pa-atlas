import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const DEFAULT_LIBRARY_ROOT = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "data",
  "library",
  "images",
);

export const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
]);

export function getLibraryRoot() {
  return process.env.BROOKS_LIBRARY_ROOT
    ? path.resolve(process.env.BROOKS_LIBRARY_ROOT)
    : DEFAULT_LIBRARY_ROOT;
}

export function isSupportedImage(file: File) {
  if (imageMimeTypes.has(file.type)) {
    return true;
  }

  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"].includes(
    path.extname(file.name).toLowerCase(),
  );
}

export async function ensureLibraryRoot() {
  await mkdir(getLibraryRoot(), { recursive: true });
}

export async function fileToBuffer(file: File) {
  return Buffer.from(await file.arrayBuffer());
}

export function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sanitizeFileName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function extensionFor(file: File) {
  const fromName = path.extname(file.name).toLowerCase();
  if (fromName) {
    return fromName;
  }

  switch (file.type) {
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

export async function saveImageBuffer(file: File, buffer: Buffer, hash: string) {
  await ensureLibraryRoot();

  const ext = extensionFor(file);
  const yearMonth = new Date().toISOString().slice(0, 7);
  const folder = path.join(getLibraryRoot(), yearMonth);
  await mkdir(folder, { recursive: true });

  const safeName = sanitizeFileName(path.basename(file.name, path.extname(file.name))) || "chart";
  const fileName = `${hash.slice(0, 16)}-${safeName}${ext}`;
  const fullPath = path.join(folder, fileName);
  await writeFile(fullPath, buffer);

  return path.relative(/*turbopackIgnore: true*/ process.cwd(), fullPath).replace(/\\/g, "/");
}

export function absoluteImagePath(libraryPath: string) {
  const resolved = path.resolve(/*turbopackIgnore: true*/ process.cwd(), libraryPath);
  const root = path.resolve(getLibraryRoot());
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Image path is outside the configured library root.");
  }

  return resolved;
}

export async function readStoredImage(libraryPath: string) {
  const fullPath = absoluteImagePath(libraryPath);
  const [buffer, fileStat] = await Promise.all([readFile(fullPath), stat(fullPath)]);
  return { buffer, fileStat };
}

export async function getImageDimensions(buffer: Buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    };
  } catch {
    return { width: null, height: null };
  }
}
