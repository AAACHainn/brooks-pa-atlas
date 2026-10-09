import sharp from "sharp";

import { createAiChatCompletion, type AiFetch } from "@/lib/ai-client";
import type { StoredAiEndpoint } from "@/lib/ai-config";

export async function prepareAiReferenceImage(buffer: Buffer, options: { maxBytes?: number; signal?: AbortSignal } = {}) {
  const encode = (edge: number, quality: number) => sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: edge,
      height: edge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  options.signal?.throwIfAborted();
  let prepared = await encode(1920, 85);
  options.signal?.throwIfAborted();
  if (options.maxBytes === undefined) return prepared;
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error("Invalid reference image byte limit.");
  for (const [edge, quality] of [[1920, 75], [1920, 65], [1440, 75], [1080, 75], [810, 65], [512, 60]]) {
    if (prepared.length <= options.maxBytes) return prepared;
    options.signal?.throwIfAborted();
    prepared = await encode(edge, quality);
    options.signal?.throwIfAborted();
  }
  if (prepared.length > options.maxBytes) throw new Error("Reference image exceeds the byte limit.");
  return prepared;
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
