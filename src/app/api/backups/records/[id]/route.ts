import { NextResponse } from "next/server";

import { backupDownloadResponse, deleteBackupRecord } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function HEAD(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return backupDownloadResponse(request, id, true);
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return backupDownloadResponse(request, id);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const deleted = await deleteBackupRecord(id);
    if (!deleted) {
      return NextResponse.json({ error: "Backup record not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[backup-delete:${id}] failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Backup delete failed." }, { status: 500 });
  }
}
