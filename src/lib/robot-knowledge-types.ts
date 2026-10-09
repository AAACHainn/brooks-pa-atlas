import { z } from "zod";
import { knowledgeLocatorSchema } from "@/lib/knowledge-locator-schema";
import { knowledgeSourceFormats, knowledgeSourceTypes } from "@/lib/knowledge-types";

export const robotKnowledgeSourceSchema = z.object({
  id: z.string(), documentId: z.string(), versionId: z.string(), versionNumber: z.number().int(),
  title: z.string(), lessonCode: z.string().nullable(), sourceType: z.enum(knowledgeSourceTypes), sourceFormat: z.enum(knowledgeSourceFormats),
  locator: knowledgeLocatorSchema, indexNodeId: z.string().nullable(), indexPath: z.string(), text: z.string(), citation: z.string(),
  page: z.object({ offset: z.number().int().nonnegative(), returned: z.number().int().nonnegative(), total: z.number().int().nonnegative(), partial: z.boolean() }),
});
export type RobotKnowledgeSource = z.infer<typeof robotKnowledgeSourceSchema>;
export const robotKnowledgeSnapshotSchema = z.object({
  v: z.literal(1), sources: z.array(robotKnowledgeSourceSchema), warnings: z.array(z.string()),
  retrieval: z.object({ embeddingRequests: z.number().int().nonnegative(), estimatedEmbeddingInputTokens: z.number().int().nonnegative(), semanticSearchUsed: z.boolean() }),
});
export type RobotKnowledgeSnapshot = z.infer<typeof robotKnowledgeSnapshotSchema>;

export function parseRobotKnowledge(value: string | null | undefined): RobotKnowledgeSnapshot | null {
  try { const result = robotKnowledgeSnapshotSchema.safeParse(JSON.parse(value ?? "null")); return result.success ? result.data : null; }
  catch { return null; }
}
export function validateRobotKnowledgeCitations(text: string, sources: readonly RobotKnowledgeSource[], locale: "zh" | "en") {
  const allowed = new Set(sources.map((source) => source.citation));
  return text.replace(/\[(K\d+)\]/g, (match, id: string) => allowed.has(id) ? match : locale === "zh" ? "[未验证引用]" : "[Unverified citation]");
}
