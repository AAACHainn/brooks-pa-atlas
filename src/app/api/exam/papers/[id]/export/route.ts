import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { buildExamPaperTransfer } from "@/lib/exam-paper-transfer";
import { sanitizeFileName } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/exam/papers/[id]/export">,
) {
  const { id } = await context.params;
  const paper = await prisma.examPaper.findUnique({
    where: { id },
    include: {
      questions: {
        include: { image: { include: { indexNode: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!paper) {
    return NextResponse.json({ error: "Exam paper not found." }, { status: 404 });
  }

  if (paper.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Only published papers can be exported." }, { status: 409 });
  }

  const manifest = buildExamPaperTransfer(paper);
  const fileName = `${sanitizeFileName(paper.title) || "exam-paper"}.exam-paper.json`;
  const encodedFileName = encodeURIComponent(fileName);

  return new NextResponse(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="exam-paper.json"; filename*=UTF-8''${encodedFileName}`,
    },
  });
}
