import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { serializeExamAttempt, shuffle } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attemptInclude = {
  paper: true,
  answers: {
    include: { question: { include: { image: { include: { indexNode: true } } } } },
    orderBy: { order: "asc" as const },
  },
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { paperId?: string };
  if (!body.paperId) {
    return NextResponse.json({ error: "Paper id is required." }, { status: 400 });
  }

  const paper = await prisma.examPaper.findUnique({
    where: { id: body.paperId },
    include: {
      questions: {
        where: { status: "READY" },
        include: { image: true },
      },
    },
  });
  if (!paper) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  if (paper.status !== "PUBLISHED" || paper.questions.length === 0) {
    return NextResponse.json({ error: "Only published papers can be tested." }, { status: 409 });
  }

  const attempt = await prisma.$transaction(async (tx) => {
    const created = await tx.examAttempt.create({
      data: {
        paperId: paper.id,
        totalCount: paper.questions.length,
      },
    });

    for (const [order, question] of shuffle(paper.questions).entries()) {
      await tx.examAttemptAnswer.create({
        data: {
          attemptId: created.id,
          questionId: question.id,
          order,
        },
      });
    }

    return tx.examAttempt.findUniqueOrThrow({
      where: { id: created.id },
      include: attemptInclude,
    });
  });

  return NextResponse.json({ attempt: serializeExamAttempt(attempt) });
}
