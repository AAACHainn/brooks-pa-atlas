import { NextResponse } from "next/server";

import { createIndexNode, getIndexTree } from "@/lib/index-tree";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  };

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
