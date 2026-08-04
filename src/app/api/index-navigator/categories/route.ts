import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { cleanNavigatorName, normalizeNavigatorName } from "@/lib/index-navigator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nameSchema = z.string().trim().min(1).max(100);

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Navigator category update failed." },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  const parsed = z.object({ name: nameSchema }).safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A category name is required." }, { status: 400 });
  }

  try {
    const name = cleanNavigatorName(parsed.data.name);
    const sortOrder = await prisma.indexNavigatorCategory.count();
    const category = await prisma.indexNavigatorCategory.create({
      data: { name, normalizedName: normalizeNavigatorName(name), sortOrder },
    });
    return NextResponse.json({ category });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const parsed = z
    .object({
      id: z.string().min(1).optional(),
      name: nameSchema.optional(),
      orderedIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    })
    .safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid category update." }, { status: 400 });
  }

  try {
    if (parsed.data.orderedIds) {
      const ids = parsed.data.orderedIds;
      if (new Set(ids).size !== ids.length) {
        throw new Error("Category order contains duplicates.");
      }
      const existing = await prisma.indexNavigatorCategory.findMany({ select: { id: true } });
      const existingIds = new Set(existing.map((category) => category.id));
      if (existingIds.size !== ids.length || ids.some((id) => !existingIds.has(id))) {
        throw new Error("Category order must contain every category exactly once.");
      }
      await prisma.$transaction(
        ids.map((id, sortOrder) =>
          prisma.indexNavigatorCategory.update({ where: { id }, data: { sortOrder } }),
        ),
      );
      return NextResponse.json({ ok: true });
    }

    if (!parsed.data.id || !parsed.data.name) {
      throw new Error("Category id and name are required.");
    }
    const name = cleanNavigatorName(parsed.data.name);
    const category = await prisma.indexNavigatorCategory.update({
      where: { id: parsed.data.id },
      data: { name, normalizedName: normalizeNavigatorName(name) },
    });
    return NextResponse.json({ category });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const parsed = z.object({ id: z.string().min(1) }).safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Category id is required." }, { status: 400 });
  }

  try {
    await prisma.indexNavigatorCategory.delete({ where: { id: parsed.data.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
