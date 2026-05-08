import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { restoreBackupZip } from "@/lib/backup";

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

  try {
    let buffer: Buffer;

    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      console.info(`[backup-restore:${restoreId}] parsing multipart form`);
      const formData = await request.formData();
      const file = formData.get("backup");

      if (!(file instanceof File)) {
        console.warn(`[backup-restore:${restoreId}] missing backup file`);
        return NextResponse.json(
          { error: "Backup zip file is required.", restoreId },
          { status: 400 },
        );
      }

      console.info(`[backup-restore:${restoreId}] backup file received`, {
        name: file.name,
        size: file.size,
        type: file.type || "(empty)",
      });

      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      console.info(`[backup-restore:${restoreId}] reading raw zip body`);
      buffer = Buffer.from(await request.arrayBuffer());
    }

    if (buffer.length === 0) {
      console.warn(`[backup-restore:${restoreId}] empty backup body`);
      return NextResponse.json({ error: "Backup zip file is required.", restoreId }, { status: 400 });
    }

    console.info(`[backup-restore:${restoreId}] backup file loaded`, { bytes: buffer.length });

    const stats = await restoreBackupZip(buffer, {
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
  }
}
