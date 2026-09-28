import { NextResponse } from "next/server";
import { z } from "zod";

import {
  aiEndpointInputSchema,
  storedAiEndpointSchema,
} from "@/lib/ai-config";
import { AiServiceError, fetchAiModels } from "@/lib/ai-client";
import { readStoredAiConfig, resolveEndpointApiKey } from "@/lib/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ endpoint: aiEndpointInputSchema });

function serviceErrorResponse(error: unknown) {
  const status = error instanceof AiServiceError && error.kind === "timeout" ? 504 : 502;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Could not fetch AI models." },
    { status },
  );
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid AI endpoint." }, { status: 400 });
  }

  const stored = await readStoredAiConfig();
  const endpointResult = storedAiEndpointSchema.safeParse({
    ...parsed.data.endpoint,
    apiKey: resolveEndpointApiKey(
      parsed.data.endpoint.id,
      parsed.data.endpoint.apiKey,
      parsed.data.endpoint.clearApiKey,
      stored.endpoints,
    ),
  });
  if (!endpointResult.success) {
    return NextResponse.json({ error: "Invalid AI endpoint." }, { status: 400 });
  }

  try {
    return NextResponse.json({ models: await fetchAiModels(endpointResult.data) });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
