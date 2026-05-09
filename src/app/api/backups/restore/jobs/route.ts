import { NextResponse } from "next/server";

import { serializeBackupJob, startRestoreJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let buffer: Buffer;

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("backup");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Backup zip file is required." }, { status: 400 });
    }

    buffer = Buffer.from(await file.arrayBuffer());
  } else {
    buffer = Buffer.from(await request.arrayBuffer());
  }

  if (buffer.length === 0) {
    return NextResponse.json({ error: "Backup zip file is required." }, { status: 400 });
  }

  const job = startRestoreJob(buffer);
  return NextResponse.json({ job: serializeBackupJob(job) });
}
