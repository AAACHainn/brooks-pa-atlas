import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { serializeExamAttempt } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: RouteContext<"/api/exam/attempts/[id]/submit">,
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    answers?: Record<string, string | null | undefined>;
  };
  const submittedAnswers = body.answers ?? {};

  const current = await prisma.examAttempt.findUnique({
    where: { id },
    include: {
      answers: {
        include: { question: true },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!current) {
    return NextResponse.json({ error: "Exam attempt not found." }, { status: 404 });
  }

  if (current.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "Exam attempt has already been submitted." }, { status: 409 });
  }

  const now = new Date();
  let correctCount = 0;

  const attempt = await prisma.$transaction(async (tx) => {
    for (const answer of current.answers) {
      const userAnswer = submittedAnswers[answer.questionId]?.trim() || null;
      const isCorrect = Boolean(userAnswer && userAnswer === answer.question.correctOption);
      if (isCorrect) {
        correctCount += 1;
      }

      await tx.examAttemptAnswer.update({
        where: { id: answer.id },
        data: { userAnswer, isCorrect },
      });
    }

    const totalCount = current.answers.length;
    const durationSeconds = Math.max(
      0,
      Math.round((now.getTime() - current.startedAt.getTime()) / 1000),
    );
    await tx.examAttempt.update({
      where: { id: current.id },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        durationSeconds,
        totalCount,
        correctCount,
        accuracy: totalCount ? correctCount / totalCount : 0,
      },
    });

    return tx.examAttempt.findUniqueOrThrow({
      where: { id: current.id },
      include: {
        paper: true,
        answers: {
          include: { question: { include: { image: { include: { indexNode: true } } } } },
          orderBy: { order: "asc" },
        },
      },
    });
  });

  return NextResponse.json({ attempt: serializeExamAttempt(attempt, { revealAnswers: true }) });
}
