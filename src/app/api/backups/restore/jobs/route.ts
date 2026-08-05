import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { NextResponse } from "next/server";

import { serializeBackupJob, startRestoreJobFromFile } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function saveRequestBodyToTempFile(request: Request) {
  if (!request.body) {
    throw new Error("Backup zip file is required.");
  }

  const uploadDir = path.join(tmpdir(), "brooks-pa-atlas-restore");
  await mkdir(uploadDir, { recursive: true });

  const filePath = path.join(uploadDir, `${randomUUID()}.zip`);
  try {
    await pipeline(
      Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>),
      createWriteStream(filePath, { flags: "wx" }),
    );

    const fileStat = await stat(filePath);
    if (fileStat.size === 0) {
      throw new Error("Backup zip file is required.");
    }

    return { filePath, size: fileStat.size };
  } catch (error) {
    await unlink(filePath).catch(() => {});
    throw error;
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "Large backup restore requires the zip file as the raw request body." },
      { status: 415 },
    );
  }

  try {
    const { filePath } = await saveRequestBodyToTempFile(request);
    const job = startRestoreJobFromFile(filePath);
    return NextResponse.json({ job: serializeBackupJob(job) });
  } catch (error) {
    console.error("[backup-restore] request failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup restore failed." },
      { status: 400 },
    );
  }
}
