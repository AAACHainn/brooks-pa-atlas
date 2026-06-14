import { NextResponse } from "next/server";

import { createIndexNode, getIndexTree } from "@/lib/index-tree";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prismaChunkSize = 500;

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function GET() {
  return NextResponse.json({ tree: await getIndexTree() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    parentId?: string | null;
  };

  try {
    const node = await createIndexNode(body.name ?? "", body.parentId ?? null);
    return NextResponse.json({ node });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create index node.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    sortOrder?: number;
    parentId?: string | null;
    orderedIds?: string[];
  };

  if (body.orderedIds) {
    const parentId = body.parentId ?? null;
    const orderedIds = body.orderedIds;
    const uniqueIds = new Set(orderedIds);

    if (orderedIds.length === 0 || uniqueIds.size !== orderedIds.length) {
      return NextResponse.json({ error: "A unique node order is required." }, { status: 400 });
    }

    const siblings = await prisma.indexNode.findMany({
      where: { parentId },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const siblingIds = new Set(siblings.map((node) => node.id));
    const matchesSiblings =
      siblingIds.size === orderedIds.length && orderedIds.every((id) => siblingIds.has(id));

    if (!matchesSiblings) {
      return NextResponse.json(
        { error: "Node order must contain every sibling exactly once." },
        { status: 400 },
      );
    }

    await prisma.$transaction(
      orderedIds.map((id, sortOrder) =>
        prisma.indexNode.update({
          where: { id },
          data: { sortOrder },
        }),
      ),
    );

    return NextResponse.json({ ok: true });
  }

  if (!body.id) {
    return NextResponse.json({ error: "Node id is required." }, { status: 400 });
  }

  const current = await prisma.indexNode.findUnique({ where: { id: body.id } });
  if (!current) {
    return NextResponse.json({ error: "Index node not found." }, { status: 404 });
  }

  const parent = current.parentId
    ? await prisma.indexNode.findUnique({ where: { id: current.parentId } })
    : null;
  const name = body.name?.trim() || current.name;
  const path = parent?.path ? `${parent.path} / ${name}` : name;

  const node = await prisma.indexNode.update({
    where: { id: current.id },
    data: {
      name,
      path,
      sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : current.sortOrder,
    },
  });

  const descendants = await prisma.indexNode.findMany({
    where: { path: { startsWith: `${current.path} /` } },
    orderBy: { depth: "asc" },
  });

  for (const descendant of descendants) {
    await prisma.indexNode.update({
      where: { id: descendant.id },
      data: {
        path: descendant.path.replace(current.path, path),
      },
    });
  }

  return NextResponse.json({ node });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as {
    id?: string;
  };

  if (!body.id) {
    return NextResponse.json({ error: "Node id is required." }, { status: 400 });
  }

  const node = await prisma.indexNode.findUnique({ where: { id: body.id } });
  if (!node) {
    return NextResponse.json({ error: "Index node not found." }, { status: 404 });
  }

  const descendants = await prisma.indexNode.findMany({
    where: { path: { startsWith: `${node.path} /` } },
    orderBy: { depth: "desc" },
  });
  const nodeIds = [node.id, ...descendants.map((descendant) => descendant.id)];
  let imageCount = 0;

  for (const nodeIdChunk of chunkArray(nodeIds, prismaChunkSize)) {
    imageCount += await prisma.chartImage.count({
      where: { indexNodeId: { in: nodeIdChunk } },
    });
    if (imageCount > 0) {
      break;
    }
  }

  if (imageCount > 0) {
    return NextResponse.json(
      { error: "Index node still contains images." },
      { status: 409 },
    );
  }

  for (const descendant of descendants) {
    await prisma.indexNode.delete({ where: { id: descendant.id } });
  }
  await prisma.indexNode.delete({ where: { id: node.id } });

  return NextResponse.json({ ok: true, removedCount: nodeIds.length });
}
