import { gzipSync } from "node:zlib";

import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { findAtlasImagePage } from "@/lib/atlas-images";
import { serializeImageAnnotation } from "@/lib/image-annotations";
import { getIndexTree } from "@/lib/index-tree";
import { navigatorImageWhere } from "@/lib/index-navigator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AtlasScope = "all" | "metadata" | "images";

function snippet(value: string | null | undefined, length = 180) {
  if (!value) {
    return null;
  }

  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function atlasJsonResponse(request: Request, payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Accept-Encoding",
  });
  if (/\bgzip\b/i.test(request.headers.get("accept-encoding") ?? "")) {
    const compressed = gzipSync(json, { level: 4 });
    headers.set("Content-Encoding", "gzip");
    headers.set("Content-Length", String(compressed.byteLength));
    return new NextResponse(new Uint8Array(compressed), { headers });
  }
  headers.set("Content-Length", String(Buffer.byteLength(json)));
  return new NextResponse(json, { headers });
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  const url = new URL(request.url);
  const requestedScope = url.searchParams.get("scope") ?? "all";
  if (!(["all", "metadata", "images"] as string[]).includes(requestedScope)) {
    return NextResponse.json({ error: "Invalid Atlas response scope." }, { status: 400 });
  }
  const scope = requestedScope as AtlasScope;
  const includeImages = scope === "all" || scope === "images";
  const includeMetadata = scope === "all" || scope === "metadata";
  const payload: Record<string, unknown> = {};
  let navigatorDuration = 0;
  let imageDuration = 0;
  let metadataDuration = 0;

  if (includeImages) {
    const query = url.searchParams.get("q")?.trim();
    const indexId = url.searchParams.get("indexId")?.trim();
    const tagIds = [
      ...new Set(url.searchParams.getAll("tagId").map((tagId) => tagId.trim()).filter(Boolean)),
    ];
    const navigatorOptionIds = [
      ...new Set(
        url.searchParams.getAll("navigatorOptionId").map((id) => id.trim()).filter(Boolean),
      ),
    ];
    const requestedPage = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const requestedPageSize = Number(url.searchParams.get("pageSize")) || 50;
    const pageSize = [25, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 50;

    const navigatorStartedAt = performance.now();
    const selectedNode = indexId
      ? await prisma.indexNode.findUnique({ where: { id: indexId } })
      : null;
    let navigatorWhere: Prisma.ChartImageWhereInput | null = null;
    try {
      navigatorWhere = await navigatorImageWhere(navigatorOptionIds);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid navigator filter." },
        { status: 400 },
      );
    }
    navigatorDuration = performance.now() - navigatorStartedAt;

    const imageWhere: Prisma.ChartImageWhereInput = {
      AND: [
        selectedNode
          ? {
              OR: [
                { indexNodeId: selectedNode.id },
                { indexNode: { path: { startsWith: `${selectedNode.path} /` } } },
              ],
            }
          : {},
        query
          ? {
              OR: [
                { originalName: { contains: query } },
                { title: { contains: query } },
                { notes: { contains: query } },
                { ocrText: { contains: query } },
                { indexNode: { path: { contains: query } } },
                { tags: { some: { tag: { name: { contains: query } } } } },
                { annotations: { some: { text: { contains: query } } } },
              ],
            }
          : {},
        ...tagIds.map((tagId) => ({ tags: { some: { tagId } } })),
        ...(navigatorWhere ? [navigatorWhere] : []),
      ],
    };
    const imageStartedAt = performance.now();
    const { images, pagination } = await findAtlasImagePage(imageWhere, requestedPage, pageSize);
    imageDuration = performance.now() - imageStartedAt;
    payload.images = images.map((image) => ({
      id: image.id,
      originalName: image.originalName,
      title: image.title,
      notes: image.notes,
      libraryPath: image.libraryPath,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      hash: image.hash,
      ocrStatus: image.ocrStatus,
      ocrText: snippet(image.ocrText),
      ocrError: snippet(image.ocrError, 120),
      createdAt: image.createdAt,
      tags: image.tags
        .map((item) => item.tag)
        .sort((left, right) => left.name.localeCompare(right.name)),
      annotations: image.annotations.map(serializeImageAnnotation),
      indexNode: image.indexNode
        ? { id: image.indexNode.id, name: image.indexNode.name, path: image.indexNode.path }
        : null,
    }));
    payload.pagination = pagination;
  }

  if (includeMetadata) {
    const metadataStartedAt = performance.now();
    const [tree, batches, stats, tags, imageCount, unclassifiedCount] = await Promise.all([
      getIndexTree(),
      prisma.importBatch.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          items: {
            where: { status: "FAILED" },
            take: 3,
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      prisma.chartImage.groupBy({ by: ["ocrStatus"], _count: { _all: true } }),
      prisma.tag.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.chartImage.count(),
      prisma.chartImage.count({ where: { indexNodeId: null } }),
    ]);
    metadataDuration = performance.now() - metadataStartedAt;
    payload.tree = tree;
    payload.batches = batches;
    payload.tags = tags;
    payload.stats = {
      imageCount,
      unclassifiedCount,
      ocr: Object.fromEntries(stats.map((item) => [item.ocrStatus, item._count._all])),
    };
  }

  const response = atlasJsonResponse(request, payload);
  response.headers.set(
    "Server-Timing",
    [
      includeImages ? `navigator;dur=${navigatorDuration.toFixed(1)}` : null,
      includeImages ? `images;dur=${imageDuration.toFixed(1)}` : null,
      includeMetadata ? `metadata;dur=${metadataDuration.toFixed(1)}` : null,
      `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
    ]
      .filter(Boolean)
      .join(", "),
  );
  return response;
}
