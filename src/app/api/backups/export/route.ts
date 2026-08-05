import { NextResponse } from "next/server";
import { Readable } from "node:stream";

import { createBackupZip } from "@/lib/backup";
import { attachmentContentDisposition } from "@/lib/download-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const backup = await createBackupZip({ indexId: url.searchParams.get("indexId") });

    return new Response(Readable.toWeb(backup.stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": attachmentContentDisposition(backup.fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup export failed." },
      { status: 500 },
    );
  }
}
