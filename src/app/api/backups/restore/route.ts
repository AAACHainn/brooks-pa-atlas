import { NextResponse } from "next/server";

import { restoreBackupZip } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "merge";

  if (mode !== "merge") {
    return NextResponse.json({ error: "Only merge restore is supported." }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("backup");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Backup zip file is required." }, { status: 400 });
    }

    const stats = await restoreBackupZip(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup restore failed." },
      { status: 400 },
    );
  }
}
