import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  ensureStoredImageThumbnail,
  readThumbnail,
  thumbnailEtag,
  thumbnailVersion,
} from "@/lib/thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function matchesEtag(ifNoneMatch: string | null, etag: string) {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((value) => value.trim() === etag || value.trim() === "*");
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/images/[id]/thumbnail">,
) {
  const { id } = await context.params;
  const version = new URL(request.url).searchParams.get("v") ?? thumbnailVersion;
  if (version !== thumbnailVersion) {
    return NextResponse.json({ error: "Unsupported thumbnail version." }, { status: 400 });
  }

  const image = await prisma.chartImage.findUnique({
    where: { id },
    select: { hash: true, libraryPath: true },
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  const etag = thumbnailEtag(image.hash, version);
  const cacheHeaders = {
    ETag: etag,
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  try {
    await ensureStoredImageThumbnail({ ...image, version });
    const { buffer, fileStat } = await readThumbnail(image.hash, version);
    return new Response(buffer, {
      headers: {
        ...cacheHeaders,
        "Content-Type": "image/webp",
        "Content-Length": String(fileStat.size),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Thumbnail generation failed.";
    console.error(`[thumbnail:${id}] generation failed`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
