import { NextResponse } from "next/server";
import { z } from "zod";

import { embeddingEndpointInputSchema, storedEmbeddingEndpointSchema } from "@/lib/ai-config";
import { AiServiceError, testAiEmbeddingConnection } from "@/lib/ai-client";
import { readStoredAiConfig, resolveEndpointApiKey } from "@/lib/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ endpoint: embeddingEndpointInputSchema, model: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "An endpoint and embedding model are required." }, { status: 400 });
  const stored = await readStoredAiConfig();
  const endpoint = storedEmbeddingEndpointSchema.safeParse({
    ...parsed.data.endpoint,
    apiKey: resolveEndpointApiKey(parsed.data.endpoint.id, parsed.data.endpoint.apiKey,
      parsed.data.endpoint.clearApiKey, stored.embeddingEndpoints),
  });
  if (!endpoint.success) return NextResponse.json({ error: "Invalid AI endpoint." }, { status: 400 });
  try {
    const result = await testAiEmbeddingConnection(endpoint.data, parsed.data.model);
    return NextResponse.json({ ok: true, dimension: result.dimension });
  } catch (error) {
    const status = error instanceof AiServiceError && error.kind === "timeout" ? 504 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Embedding test failed." }, { status });
  }
}
