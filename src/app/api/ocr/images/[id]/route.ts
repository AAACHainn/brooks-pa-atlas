import { NextResponse } from "next/server";

import { queueImageOcr } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/ocr/images/[id]">,
) {
  const { id } = await context.params;
  const image = await queueImageOcr(id);

  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
