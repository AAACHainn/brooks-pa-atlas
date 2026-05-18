import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { prisma } from "@/lib/db";
import { parseExamPaperTransfer } from "@/lib/exam-paper-transfer";
import { questionStatus, serializeExamPaper } from "@/lib/exam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Exam paper file is required." }, { status: 400 });
  }

  let transfer: ReturnType<typeof parseExamPaperTransfer>;
  try {
    transfer = parseExamPaperTransfer(JSON.parse(await file.text()));
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message : "Invalid exam paper file.";
    return NextResponse.json({ error: message || "Invalid exam paper file." }, { status: 400 });
  }

  const imageHashes = [...new Set(transfer.paper.questions.map((question) => question.imageHash))];
  const images = await prisma.chartImage.findMany({
    where: { hash: { in: imageHashes } },
    select: { id: true, hash: true },
  });
  const imageIdByHash = new Map(images.map((image) => [image.hash, image.id]));
  const missingImages = transfer.paper.questions
    .filter((question) => !imageIdByHash.has(question.imageHash))
    .map((question) => ({
      imageHash: question.imageHash,
      imageOriginalName: question.imageOriginalName,
      indexPath: question.indexPath ?? null,
    }));

  if (missingImages.length > 0) {
    return NextResponse.json(
      {
        error: "Imported exam paper references missing images.",
        missingImages,
      },
      { status: 409 },
    );
  }

  if (imageHashes.length !== transfer.paper.questions.length) {
    return NextResponse.json(
      { error: "Imported exam paper contains duplicate image questions." },
      { status: 400 },
    );
  }

  const paper = await prisma.$transaction(async (tx) => {
    const created = await tx.examPaper.create({
      data: {
        title: transfer.paper.title,
        description: transfer.paper.description,
        status: "DRAFT",
        defaultOptionsJson: JSON.stringify(transfer.paper.defaultOptions),
      },
    });

    for (const question of transfer.paper.questions) {
      const chartImageId = imageIdByHash.get(question.imageHash);
      if (!chartImageId) {
        throw new Error(`Missing image: ${question.imageHash}`);
      }

      await tx.examQuestion.create({
        data: {
          paperId: created.id,
          chartImageId,
          questionType: question.questionType,
          prompt: question.prompt,
          optionsJson: JSON.stringify(question.options),
          correctOption: question.correctOption,
          explanation: question.explanation,
          maskRectsJson: JSON.stringify(question.maskRects),
          status: questionStatus({
            questionType: question.questionType,
            prompt: question.prompt,
            options: question.options,
            correctOption: question.correctOption,
            explanation: question.explanation,
            maskRects: question.maskRects,
          }),
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
