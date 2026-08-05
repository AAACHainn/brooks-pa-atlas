import { NextResponse } from "next/server";

import { listBackupRecords } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const records = await listBackupRecords();
  return NextResponse.json({ records });
}
