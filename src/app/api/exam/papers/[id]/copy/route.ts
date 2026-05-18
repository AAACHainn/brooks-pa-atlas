import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { serializeExamPaper } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/exam/papers/[id]/copy">,
) {
  const { id } = await context.params;
  const source = await prisma.examPaper.findUnique({
    where: { id },
    include: {
      questions: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  const paper = await prisma.$transaction(async (tx) => {
    const created = await tx.examPaper.create({
      data: {
        title: `${source.title} 副本`,
        description: source.description,
        status: "DRAFT",
        defaultOptionsJson: source.defaultOptionsJson,
      },
    });

    for (const question of source.questions) {
      await tx.examQuestion.create({
        data: {
          paperId: created.id,
          chartImageId: question.chartImageId,
          questionType: question.questionType,
          prompt: question.prompt,
          optionsJson: question.optionsJson,
          correctOption: question.correctOption,
          explanation: question.explanation,
          maskRectsJson: question.maskRectsJson,
          status: question.status,
          sortOrder: question.sortOrder,
        },
      });
    }

    return tx.examPaper.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        questions: {
          include: { image: { include: { indexNode: true } } },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { questions: true, attempts: true } },
      },
    });
  });

  return NextResponse.json({ paper: serializeExamPaper(paper) });
}
