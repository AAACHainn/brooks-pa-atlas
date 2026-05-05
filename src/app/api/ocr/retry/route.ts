import { NextResponse } from "next/server";

import { retryFailedOcr } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    imageIds?: string[];
  };

  await retryFailedOcr(body.imageIds);
  return NextResponse.json({ ok: true });
}
