import { NextResponse } from "next/server";

import { createBackupZip } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const backup = await createBackupZip({ indexId: url.searchParams.get("indexId") });

    return new Response(backup.stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${backup.fileName}"`,
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
