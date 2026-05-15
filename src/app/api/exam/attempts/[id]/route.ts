import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { serializeExamAttempt } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/exam/attempts/[id]">,
) {
  const { id } = await context.params;
  const attempt = await prisma.examAttempt.findUnique({
    where: { id },
    include: {
      paper: true,
      answers: {
        include: { question: { include: { image: { include: { indexNode: true } } } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!attempt) {
    return NextResponse.json({ error: "Exam attempt not found." }, { status: 404 });
  }

  return NextResponse.json({
    attempt: serializeExamAttempt(attempt, { revealAnswers: attempt.status === "SUBMITTED" }),
  });
}
