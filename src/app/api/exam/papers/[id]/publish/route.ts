import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { parseExamOptions, parseMaskRects, questionStatus, serializeExamPaper } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/exam/papers/[id]/publish">,
) {
  const { id } = await context.params;
  const current = await prisma.examPaper.findUnique({
    where: { id },
    include: {
      questions: {
        include: { image: { include: { indexNode: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      _count: { select: { questions: true, attempts: true } },
    },
  });
  if (!current) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  if (current.status !== "DRAFT") {
    return NextResponse.json({ error: "Paper is already published." }, { status: 409 });
  }

  const readyQuestionIds = current.questions
    .filter(
      (question) =>
        questionStatus({
          prompt: question.prompt,
          options: parseExamOptions(question.optionsJson),
          correctOption: question.correctOption,
          explanation: question.explanation,
          maskRects: parseMaskRects(question.maskRectsJson),
        }) === "READY",
    )
    .map((question) => question.id);

  if (current.questions.length === 0 || readyQuestionIds.length !== current.questions.length) {
    return NextResponse.json({ error: "All questions must be ready before publishing." }, { status: 409 });
  }

  await prisma.examQuestion.updateMany({
    where: { id: { in: readyQuestionIds } },
    data: { status: "READY" },
  });

  const paper = await prisma.examPaper.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
    include: {
      questions: {
        include: { image: { include: { indexNode: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      _count: { select: { questions: true, attempts: true } },
    },
  });

  return NextResponse.json({ paper: serializeExamPaper(paper) });
}
