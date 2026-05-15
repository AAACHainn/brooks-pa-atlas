import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { parseExamOptions, serializeExamQuestion } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: RouteContext<"/api/exam/papers/[id]/questions">,
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { chartImageId?: string };
  if (!body.chartImageId) {
    return NextResponse.json({ error: "Image id is required." }, { status: 400 });
  }

  const [paper, image] = await Promise.all([
    prisma.examPaper.findUnique({ where: { id } }),
    prisma.chartImage.findUnique({ where: { id: body.chartImageId } }),
  ]);
  if (!paper) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  if (paper.status !== "DRAFT") {
    return NextResponse.json({ error: "Published papers are locked." }, { status: 409 });
  }

  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  const sortOrder = await prisma.examQuestion.count({ where: { paperId: id } });

  try {
    const question = await prisma.examQuestion.create({
      data: {
        paperId: id,
        chartImageId: image.id,
        optionsJson: JSON.stringify(parseExamOptions(paper.defaultOptionsJson)),
        sortOrder,
      },
      include: { image: { include: { indexNode: true } } },
    });

    return NextResponse.json({ question: serializeExamQuestion(question) });
  } catch {
    return NextResponse.json({ error: "This image is already in the paper." }, { status: 409 });
  }
}
