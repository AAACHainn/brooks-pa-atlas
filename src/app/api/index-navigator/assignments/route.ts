import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idsSchema = z.array(z.string().min(1)).max(1000);

export async function GET(request: Request) {
  const nodeIds = [...new Set(new URL(request.url).searchParams.getAll("nodeId").filter(Boolean))];
  if (nodeIds.length === 0 || nodeIds.length > 1000) {
    return NextResponse.json({ error: "Between 1 and 1000 node ids are required." }, { status: 400 });
  }

  const assignments = await prisma.indexNodeNavigatorOption.findMany({
    where: { indexNodeId: { in: nodeIds } },
    select: { indexNodeId: true, optionId: true },
  });
  return NextResponse.json({
    nodes: nodeIds.map((nodeId) => ({
      nodeId,
      optionIds: assignments
        .filter((assignment) => assignment.indexNodeId === nodeId)
        .map((assignment) => assignment.optionId),
    })),
  });
}

export async function PATCH(request: Request) {
  const parsed = z
    .object({
      nodeIds: idsSchema.min(1),
      addOptionIds: z.array(z.string().min(1)).max(200).default([]),
      removeOptionIds: z.array(z.string().min(1)).max(200).default([]),
    })
    .safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid navigator assignment update." }, { status: 400 });
  }

  const nodeIds = [...new Set(parsed.data.nodeIds)];
  const addOptionIds = [...new Set(parsed.data.addOptionIds)];
  const removeOptionIds = [...new Set(parsed.data.removeOptionIds)];
  if (addOptionIds.some((id) => removeOptionIds.includes(id))) {
    return NextResponse.json({ error: "An option cannot be added and removed together." }, { status: 400 });
  }

  const [nodeCount, optionCount] = await Promise.all([
    prisma.indexNode.count({ where: { id: { in: nodeIds } } }),
    prisma.indexNavigatorOption.count({
      where: { id: { in: [...addOptionIds, ...removeOptionIds] } },
    }),
  ]);
  if (nodeCount !== nodeIds.length) {
    return NextResponse.json({ error: "One or more index nodes were not found." }, { status: 404 });
  }
  if (optionCount !== new Set([...addOptionIds, ...removeOptionIds]).size) {
    return NextResponse.json({ error: "One or more navigator options were not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (removeOptionIds.length > 0) {
      await tx.indexNodeNavigatorOption.deleteMany({
        where: { indexNodeId: { in: nodeIds }, optionId: { in: removeOptionIds } },
      });
    }
    if (addOptionIds.length > 0) {
      for (const indexNodeId of nodeIds) {
        for (const optionId of addOptionIds) {
          await tx.indexNodeNavigatorOption.upsert({
            where: { indexNodeId_optionId: { indexNodeId, optionId } },
            create: { indexNodeId, optionId },
            update: {},
          });
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}
