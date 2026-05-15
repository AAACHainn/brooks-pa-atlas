import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  normalizeExamOptions,
  normalizeMaskRects,
  parseExamOptions,
  parseMaskRects,
  questionStatus,
  serializeExamQuestion,
} from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/exam/questions/[id]">,
) {
  const { id } = await context.params;
  const current = await prisma.examQuestion.findUnique({
    where: { id },
    include: { paper: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Exam question not found." }, { status: 404 });
  }

  if (current.paper.status !== "DRAFT") {
    return NextResponse.json({ error: "Published papers are locked." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    options?: unknown;
    correctOption?: string | null;
    explanation?: string;
    maskRects?: unknown;
    sortOrder?: number;
  };
  const options = body.options ? normalizeExamOptions(body.options) : parseExamOptions(current.optionsJson);
  const maskRects = body.maskRects ? normalizeMaskRects(body.maskRects) : parseMaskRects(current.maskRectsJson);
  const prompt = body.prompt ?? current.prompt;
  const correctOption = body.correctOption === undefined ? current.correctOption : body.correctOption;
  const explanation = body.explanation ?? current.explanation;

  const question = await prisma.examQuestion.update({
    where: { id },
    data: {
      prompt,
      optionsJson: JSON.stringify(options),
      correctOption: correctOption?.trim() || null,
      explanation,
      maskRectsJson: JSON.stringify(maskRects),
      status: questionStatus({ prompt, options, correctOption, explanation, maskRects }),
      sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : current.sortOrder,
    },
    include: { image: { include: { indexNode: true } } },
  });

  return NextResponse.json({ question: serializeExamQuestion(question) });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/exam/questions/[id]">,
) {
  const { id } = await context.params;
  const current = await prisma.examQuestion.findUnique({
    where: { id },
    include: { paper: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Exam question not found." }, { status: 404 });
  }

  if (current.paper.status !== "DRAFT") {
    return NextResponse.json({ error: "Published papers are locked." }, { status: 409 });
  }

  await prisma.examQuestion.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
