import { NextResponse } from "next/server";
import { z } from "zod";

import { HeavyTaskBusyError } from "@/lib/background-task-coordinator";
import { prisma } from "@/lib/db";
import { createKnowledgeImportJob } from "@/lib/knowledge-import-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mappingsSchema = z.array(z.object({ fileIndex: z.number().int().nonnegative(), indexNodeId: z.string().min(1) })).min(1).max(200);
const processingModeSchema = z.enum(["QUICK", "AI"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const mappings = mappingsSchema.parse(JSON.parse(String(form.get("mappings") ?? "null")));
    const manualReview = form.get("manualReview") === "true";
    const processingMode = processingModeSchema.parse(String(form.get("processingMode") ?? "QUICK"));
    if (files.length !== mappings.length) throw new Error("每个字幕文件都必须确认一个目标索引。");
    const nodeIds = [...new Set(mappings.map((mapping) => mapping.indexNodeId))];
    const nodes = await prisma.indexNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true, path: true } });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const sources = await Promise.all(mappings.map(async (mapping) => {
      const file = files[mapping.fileIndex];
      const node = nodeById.get(mapping.indexNodeId);
      if (!file || !node) throw new Error("字幕文件或目标索引不存在。");
      return {
        fileName: file.name,
        mimeType: file.type,
        buffer: Buffer.from(await file.arrayBuffer()),
        targetIndexNodeId: node.id,
        targetIndexPath: node.path,
      };
    }));
    return NextResponse.json({ job: await createKnowledgeImportJob(sources, manualReview, processingMode) }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start knowledge import." },
      { status: error instanceof HeavyTaskBusyError ? 409 : 400 },
    );
  }
}
