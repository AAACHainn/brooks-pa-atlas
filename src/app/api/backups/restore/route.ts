import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { NextResponse } from "next/server";

import { restoreBackupZipFromFile } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function restoreErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Backup restore failed.";
}

function errorCauseMessage(error: unknown) {
  if (!(error instanceof Error) || !("cause" in error)) {
    return null;
  }

  const cause = error.cause;
  return cause instanceof Error ? cause.message : String(cause);
}

async function saveRequestBodyToTempFile(request: Request, restoreId: string) {
  if (!request.body) throw new Error("Backup zip file is required.");
  const uploadDir = path.join(tmpdir(), "brooks-pa-atlas-restore");
  await mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, `${restoreId}.zip`);

  try {
    await pipeline(
      Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>),
      createWriteStream(filePath, { flags: "wx" }),
    );
    const fileStat = await stat(filePath);
    if (fileStat.size === 0) throw new Error("Backup zip file is required.");
    return filePath;
  } catch (error) {
    await unlink(filePath).catch(() => {});
    throw error;
  }
}

export async function POST(request: Request) {
  const restoreId = randomUUID();
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "merge";
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = request.headers.get("content-length");

  console.info(`[backup-restore:${restoreId}] request started`, {
    contentLength,
    contentType: contentType || "(empty)",
    mode,
  });

  if (mode !== "merge") {
    console.warn(`[backup-restore:${restoreId}] unsupported restore mode`, { mode });
    return NextResponse.json(
      { error: "Only merge restore is supported.", restoreId },
      { status: 400 },
    );
  }

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      {
        error: "Large backup restore requires the zip file as the raw request body.",
        restoreId,
      },
      { status: 415 },
    );
  }

  let filePath: string | null = null;
  try {
    console.info(`[backup-restore:${restoreId}] streaming raw zip body to disk`);
    filePath = await saveRequestBodyToTempFile(request, restoreId);
    const fileStat = await stat(filePath);
    console.info(`[backup-restore:${restoreId}] backup file saved`, { bytes: fileStat.size });

    const stats = await restoreBackupZipFromFile(filePath, {
      log(message, metadata) {
        console.info(`[backup-restore:${restoreId}] ${message}`, metadata ?? {});
      },
    });

    console.info(`[backup-restore:${restoreId}] request completed`, stats);
    return NextResponse.json({ ok: true, restoreId, stats });
  } catch (error) {
    console.error(`[backup-restore:${restoreId}] request failed`, {
      cause: errorCauseMessage(error),
      error: restoreErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: restoreErrorMessage(error), restoreId },
      { status: 400 },
    );
  } finally {
    if (filePath) await unlink(filePath).catch(() => {});
  }
}
