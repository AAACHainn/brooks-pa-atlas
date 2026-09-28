import { NextResponse } from "next/server";

import { aiConfigInputSchema } from "@/lib/ai-config";
import { readAiConfigDto, saveAiConfig } from "@/lib/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ config: await readAiConfigDto() });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = aiConfigInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid AI configuration." }, { status: 400 });
  }

  try {
    const config = await saveAiConfig(parsed.data);
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save AI configuration." },
      { status: 400 },
    );
  }
}
