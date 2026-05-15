import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { serializeExamPaper } from "@/lib/exam";

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

  if (current.questions.length === 0 || current.questions.some((question) => question.status !== "READY")) {
    return NextResponse.json({ error: "All questions must be ready before publishing." }, { status: 409 });
  }

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
