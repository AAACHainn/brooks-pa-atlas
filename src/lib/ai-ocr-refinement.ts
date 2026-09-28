import sharp from "sharp";

import { createAiChatCompletion, type AiFetch } from "@/lib/ai-client";
import type { StoredAiEndpoint } from "@/lib/ai-config";

export async function prepareAiReferenceImage(buffer: Buffer) {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

export function buildOcrRefinementMessages(options: {
  prompt: string;
  originalName: string;
  ocrText: string;
  imageDataUrl: string;
}) {
  return [
    { role: "system" as const, content: options.prompt },
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `图片文件名：${options.originalName}\n\nOCR 草稿：\n${options.ocrText}`,
        },
        {
          type: "image_url" as const,
          image_url: { url: options.imageDataUrl },
        },
      ],
    },
  ];
}

export async function refineOcrTextWithAi(options: {
  endpoint: StoredAiEndpoint;
  model: string;
  prompt: string;
  originalName: string;
  ocrText: string;
  imageBuffer: Buffer;
  fetchImpl?: AiFetch;
  timeoutMs?: number;
}) {
  const preparedImage = await prepareAiReferenceImage(options.imageBuffer);
  return createAiChatCompletion(
    options.endpoint,
    options.model,
    buildOcrRefinementMessages({
      prompt: options.prompt,
      originalName: options.originalName,
      ocrText: options.ocrText,
      imageDataUrl: `data:image/jpeg;base64,${preparedImage.toString("base64")}`,
    }),
    { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs },
  );
}
