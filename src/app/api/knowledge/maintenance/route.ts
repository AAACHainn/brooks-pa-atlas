import { NextResponse } from "next/server";
import { z } from "zod";

import { HeavyTaskBusyError } from "@/lib/background-task-coordinator";
import { createEmbeddingRebuildJob, knowledgeMaintenanceSummary, rebuildFtsNow } from "@/lib/knowledge-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ kind: z.enum(["fts", "embeddings"]) });

export async function GET() {
  try {
    return NextResponse.json({ summary: await knowledgeMaintenanceSummary() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load maintenance summary." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid maintenance kind." }, { status: 400 });
  try {
    if (parsed.data.kind === "fts") return NextResponse.json(rebuildFtsNow());
    return NextResponse.json({ job: await createEmbeddingRebuildJob() }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Maintenance failed." },
      { status: error instanceof HeavyTaskBusyError ? 409 : 400 },
    );
  }
}
