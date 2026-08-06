import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { hashBuffer } from "@/lib/storage";
import {
  ensureThumbnailFromBuffer,
  readThumbnail,
  thumbnailEtag,
  thumbnailExists,
  thumbnailPathForHash,
} from "@/lib/thumbnails";

process.env.BROOKS_THUMBNAIL_ROOT = path.join(tmpdir(), `brooks-thumbnail-test-${randomUUID()}`);

async function samplePng(width: number, height: number, color: string) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

test("thumbnail paths are hash-safe and versioned", () => {
  const hash = "ab".padEnd(64, "0");
  const target = thumbnailPathForHash(hash);
  assert.match(target, /[\\/]v1[\\/]ab[\\/]ab0{62}\.webp$/);
  assert.equal(thumbnailEtag(hash), `"thumbnail-v1-${hash}"`);
  assert.throws(() => thumbnailPathForHash("../unsafe"), /Invalid image hash/);
  assert.throws(() => thumbnailPathForHash(hash, "2"), /Unsupported thumbnail version/);
});

test("thumbnail generation is cached, bounded, and does not enlarge", async () => {
  const source = await samplePng(900, 300, "#0e7490");
  const hash = hashBuffer(source);
  const first = await ensureThumbnailFromBuffer(source, hash);
  const second = await ensureThumbnailFromBuffer(source, hash);
  const { buffer } = await readThumbnail(hash);
  const metadata = await sharp(buffer).metadata();

  assert.equal(first.generated, true);
  assert.equal(second.generated, false);
  assert.equal(await thumbnailExists(hash), true);
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 420);
  assert.equal(metadata.height, 140);

  const smallSource = await samplePng(120, 80, "#18181b");
  const smallHash = hashBuffer(smallSource);
  await ensureThumbnailFromBuffer(smallSource, smallHash);
  const smallMetadata = await sharp((await readThumbnail(smallHash)).buffer).metadata();
  assert.equal(smallMetadata.width, 120);
  assert.equal(smallMetadata.height, 80);
});

test("concurrent generation for one hash shares the same promise", async () => {
  const source = await samplePng(640, 640, "#22c55e");
  const hash = hashBuffer(source);
  const first = ensureThumbnailFromBuffer(source, hash);
  const second = ensureThumbnailFromBuffer(source, hash);
  assert.strictEqual(first, second);
  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.equal(left.generated, true);
});
