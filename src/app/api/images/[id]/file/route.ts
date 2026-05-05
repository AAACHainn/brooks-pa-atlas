import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/images/[id]/file">,
) {
  const { id } = await context.params;
  const image = await prisma.chartImage.findUnique({ where: { id } });

  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  try {
    const { buffer, fileStat } = await readStoredImage(image.libraryPath);
    return new Response(buffer, {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(fileStat.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stored image is unavailable.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
