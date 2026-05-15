import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { serializeExamAttempt } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/exam/papers/[id]/attempts">,
) {
  const { id } = await context.params;
  const paper = await prisma.examPaper.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!paper) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  const attempts = await prisma.examAttempt.findMany({
    where: { paperId: id },
    include: { paper: true },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json({
    attempts: attempts.map((attempt) => serializeExamAttempt(attempt)),
  });
}
