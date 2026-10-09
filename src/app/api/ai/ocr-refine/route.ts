import { NextResponse } from "next/server";
import { z } from "zod";

import { AiServiceError } from "@/lib/ai-client";
import { OCR_REFINEMENT_SKILL_KEY, resolveAiEndpointUrls, resolveAiModelSelection } from "@/lib/ai-config";
import { refineOcrTextWithAi } from "@/lib/ai-ocr-refinement";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { prisma } from "@/lib/db";
import { readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  imageId: z.string().trim().min(1).max(200),
  ocrText: z.string().trim().max(100_000).default(""),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid image ID is required. The optional OCR draft must be a string of at most 100,000 characters." },
      { status: 400 },
    );
  }

  const image = await prisma.chartImage.findUnique({
    where: { id: parsed.data.imageId },
    select: { id: true, originalName: true, libraryPath: true },
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  const config = await readStoredAiConfig();
  const endpoint = config.endpoints.find((item) => item.id === config.activeEndpointId);
  const skill = config.skills[OCR_REFINEMENT_SKILL_KEY];
  const { model } = resolveAiModelSelection(config, skill.modelOverride);
  try {
    if (!endpoint || !model) {
      return NextResponse.json(
        { error: "AI configuration is incomplete. Select an active endpoint and model." },
        { status: 409 },
      );
    }
    try {
      resolveAiEndpointUrls(endpoint);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "AI endpoint URL is invalid." },
        { status: 409 },
      );
    }
    const { buffer } = await readStoredImage(image.libraryPath);
    const refinedText = await refineOcrTextWithAi({
      endpoint,
      model,
      prompt: skill.prompt,
      originalName: image.originalName,
      ocrText: parsed.data.ocrText,
      imageBuffer: buffer,
    });
    return NextResponse.json({ refinedText });
  } catch (error) {
    if (error instanceof AiServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.kind === "timeout" ? 504 : error.kind === "configuration" ? 409 : 502 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI OCR refinement failed." },
      { status: 500 },
    );
  }
}
