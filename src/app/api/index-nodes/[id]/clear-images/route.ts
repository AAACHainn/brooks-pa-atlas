import { unlink } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { absoluteImagePath } from "@/lib/storage";
import { cleanupUnusedTags } from "@/lib/tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requiredConfirmation = "确认删除";

export async function POST(
  request: Request,
  context: RouteContext<"/api/index-nodes/[id]/clear-images">,
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    confirmation?: string;
  };

  if (body.confirmation !== requiredConfirmation) {
    return NextResponse.json(
      { error: "Confirmation phrase is required." },
      { status: 400 },
    );
  }

  const node = await prisma.indexNode.findUnique({ where: { id } });
  if (!node) {
    return NextResponse.json({ error: "Index node not found." }, { status: 404 });
  }

  const descendants = await prisma.indexNode.findMany({
    where: { path: { startsWith: `${node.path} /` } },
    select: { id: true },
  });
  const nodeIds = [node.id, ...descendants.map((descendant) => descendant.id)];
  const images = await prisma.chartImage.findMany({
    where: { indexNodeId: { in: nodeIds } },
    select: { id: true, libraryPath: true },
  });
  const examQuestionCount = await prisma.examQuestion.count({
    where: { chartImageId: { in: images.map((image) => image.id) } },
  });

  if (examQuestionCount > 0) {
    return NextResponse.json(
      { error: "Some images are used by exam questions and cannot be deleted." },
      { status: 409 },
    );
  }

  for (const image of images) {
    try {
      await unlink(absoluteImagePath(image.libraryPath));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      if (code !== "ENOENT") {
        return NextResponse.json(
          { error: `Failed to remove ${image.libraryPath}.` },
          { status: 500 },
        );
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.chartImage.deleteMany({
      where: { id: { in: images.map((image) => image.id) } },
    });
    await cleanupUnusedTags(tx);
  });

  return NextResponse.json({ ok: true, removedCount: images.length });
}
