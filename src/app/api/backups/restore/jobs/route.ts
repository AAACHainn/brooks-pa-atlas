import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { NextResponse } from "next/server";

import { serializeBackupJob, startRestoreJob, startRestoreJobFromFile } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function saveRequestBodyToTempFile(request: Request) {
  if (!request.body) {
    throw new Error("Backup zip file is required.");
  }

  const uploadDir = path.join(tmpdir(), "brooks-pa-atlas-restore");
  await mkdir(uploadDir, { recursive: true });

  const filePath = path.join(uploadDir, `${randomUUID()}.zip`);
  await pipeline(
    Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>),
    createWriteStream(filePath),
  );

  const fileStat = await stat(filePath);
  if (fileStat.size === 0) {
    throw new Error("Backup zip file is required.");
  }

  return { filePath, size: fileStat.size };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("backup");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Backup zip file is required." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Backup zip file is required." }, { status: 400 });
    }

    const job = startRestoreJob(buffer);
    return NextResponse.json({ job: serializeBackupJob(job) });
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
