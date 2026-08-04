import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { cleanNavigatorName, normalizeNavigatorName } from "@/lib/index-navigator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nameSchema = z.string().trim().min(1).max(100);

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Navigator option update failed." },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  const parsed = z
    .object({ categoryId: z.string().min(1), name: nameSchema })
    .safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Category and option name are required." }, { status: 400 });
  }

  try {
    const name = cleanNavigatorName(parsed.data.name);
    const sortOrder = await prisma.indexNavigatorOption.count({
      where: { categoryId: parsed.data.categoryId },
    });
    const option = await prisma.indexNavigatorOption.create({
      data: {
        categoryId: parsed.data.categoryId,
        name,
        normalizedName: normalizeNavigatorName(name),
        sortOrder,
      },
    });
    return NextResponse.json({ option });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const parsed = z
    .object({
      id: z.string().min(1).optional(),
      categoryId: z.string().min(1).optional(),
      name: nameSchema.optional(),
      orderedIds: z.array(z.string().min(1)).min(1).max(500).optional(),
    })
    .safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid option update." }, { status: 400 });
  }

  try {
    if (parsed.data.orderedIds) {
      if (!parsed.data.categoryId) {
        throw new Error("Category id is required for option ordering.");
      }
      const ids = parsed.data.orderedIds;
      if (new Set(ids).size !== ids.length) {
        throw new Error("Option order contains duplicates.");
      }
      const existing = await prisma.indexNavigatorOption.findMany({
        where: { categoryId: parsed.data.categoryId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((option) => option.id));
      if (existingIds.size !== ids.length || ids.some((id) => !existingIds.has(id))) {
        throw new Error("Option order must contain every option in the category exactly once.");
      }
      await prisma.$transaction(
        ids.map((id, sortOrder) =>
          prisma.indexNavigatorOption.update({ where: { id }, data: { sortOrder } }),
        ),
      );
      return NextResponse.json({ ok: true });
    }

    if (!parsed.data.id || !parsed.data.name) {
      throw new Error("Option id and name are required.");
    }
    const name = cleanNavigatorName(parsed.data.name);
    const option = await prisma.indexNavigatorOption.update({
      where: { id: parsed.data.id },
      data: { name, normalizedName: normalizeNavigatorName(name) },
    });
    return NextResponse.json({ option });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const parsed = z.object({ id: z.string().min(1) }).safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Option id is required." }, { status: 400 });
  }

  try {
    await prisma.indexNavigatorOption.delete({ where: { id: parsed.data.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
