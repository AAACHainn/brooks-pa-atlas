import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { defaultExamOptions, normalizeExamOptions, serializeExamPaper } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const papers = await prisma.examPaper.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      _count: { select: { questions: true, attempts: true } },
    },
  });

  return NextResponse.json({ papers: papers.map(serializeExamPaper) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    description?: string | null;
    defaultOptions?: unknown;
  };
  const title = body.title?.trim() || "未命名试卷";
  const defaultOptions = body.defaultOptions
    ? normalizeExamOptions(body.defaultOptions)
    : defaultExamOptions;

  const paper = await prisma.examPaper.create({
    data: {
      title,
      description: body.description?.trim() || null,
      defaultOptionsJson: JSON.stringify(defaultOptions),
    },
    include: {
      questions: { include: { image: { include: { indexNode: true } } } },
      _count: { select: { questions: true, attempts: true } },
    },
  });

  return NextResponse.json({ paper: serializeExamPaper(paper) });
}
