import { NextResponse } from "next/server";
import { z } from "zod";

import { embeddingEndpointInputSchema, storedEmbeddingEndpointSchema } from "@/lib/ai-config";
import { AiServiceError, fetchAiModels } from "@/lib/ai-client";
import { readStoredAiConfig, resolveEndpointApiKey } from "@/lib/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ endpoint: embeddingEndpointInputSchema });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid embedding endpoint." }, { status: 400 });
  const stored = await readStoredAiConfig();
  const endpoint = storedEmbeddingEndpointSchema.safeParse({
    ...parsed.data.endpoint,
    apiKey: resolveEndpointApiKey(parsed.data.endpoint.id, parsed.data.endpoint.apiKey,
      parsed.data.endpoint.clearApiKey, stored.embeddingEndpoints),
  });
  if (!endpoint.success) return NextResponse.json({ error: "Invalid embedding endpoint." }, { status: 400 });
  try {
    return NextResponse.json({ models: await fetchAiModels(endpoint.data) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not fetch embedding models." },
      { status: error instanceof AiServiceError && error.kind === "timeout" ? 504 : 502 },
    );
  }
}
