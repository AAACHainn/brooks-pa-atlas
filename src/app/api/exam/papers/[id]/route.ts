import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeExamOptions, serializeExamPaper } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paperInclude = {
  questions: {
    include: { image: { include: { indexNode: true } } },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
  },
  _count: { select: { questions: true, attempts: true } },
};

export async function GET(
  _request: Request,
  context: RouteContext<"/api/exam/papers/[id]">,
) {
  const { id } = await context.params;
  const paper = await prisma.examPaper.findUnique({
    where: { id },
    include: paperInclude,
  });

  if (!paper) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  return NextResponse.json({ paper: serializeExamPaper(paper) });
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/exam/papers/[id]">,
) {
  const { id } = await context.params;
  const current = await prisma.examPaper.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  if (current.status !== "DRAFT") {
    return NextResponse.json({ error: "Published papers are locked." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    description?: string | null;
    defaultOptions?: unknown;
  };
  const paper = await prisma.examPaper.update({
    where: { id },
    data: {
      title: body.title?.trim() || current.title,
      description: body.description?.trim() || null,
      defaultOptionsJson: body.defaultOptions
        ? JSON.stringify(normalizeExamOptions(body.defaultOptions))
        : current.defaultOptionsJson,
    },
    include: paperInclude,
  });

  return NextResponse.json({ paper: serializeExamPaper(paper) });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/exam/papers/[id]">,
) {
  const { id } = await context.params;
  const current = await prisma.examPaper.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    const attempts = await tx.examAttempt.findMany({
      where: { paperId: id },
      select: { id: true },
    });
    const attemptIds = attempts.map((attempt) => attempt.id);

    if (attemptIds.length > 0) {
      await tx.examAttemptAnswer.deleteMany({
        where: { attemptId: { in: attemptIds } },
      });
      await tx.examAttempt.deleteMany({ where: { id: { in: attemptIds } } });
    }

    await tx.examPaper.delete({ where: { id } });
  });
  return NextResponse.json({ ok: true });
}
