import { z } from "zod";
export type RobotMode = "normal" | "reading" | "task";
export const taskScopeSchema = z.strictObject({
  kind: z.enum(["current", "library", "indexes", "images", "documents"]),
  ids: z.array(z.string().min(1).max(200)).max(100).default([]),
});
export const taskPlanSchema = z.strictObject({
  title: z.string().min(1).max(200),
  scope: taskScopeSchema,
  steps: z.array(z.string().min(1).max(500)).length(3),
  approach: z.string().min(1).max(4_000),
});
export type TaskPlan = z.infer<typeof taskPlanSchema>;
export type TaskScope = z.infer<typeof taskScopeSchema>;
export type TaskBudget = { modelCalls: number; toolCalls: number; inputTokens: number; elapsedMs: number; embeddingRequests: number; estimatedEmbeddingInputTokens: number };
export type TaskSource = { citation: string; kind: "index" | "image" | "knowledge"; id: string; title: string; version?: string; location?: string; text: string };
export type TaskCheckpoint = { ordinal: number; kind: "read" | "reduce"; summary: string; sources: TaskSource[] };
export type TaskSnapshot = {
  id: string; conversationId: string; goal: string; status: string; revision: number; planVersion: number;
  currentStep: number;
  checkpointCount: number;
  plan: TaskPlan | null; scopeLabel: string; totalBatches: number; completedBatches: number;
  totalSources: number; completedSources: number;
  budget: TaskBudget; checkpoints: TaskCheckpoint[]; result: string | null; error: string | null;
};
export const taskCreateSchema = z.strictObject({ content: z.string().trim().min(1).max(20_000),
  locale: z.enum(["zh", "en"]).default("zh"), imageId: z.string().min(1).max(200).nullable().optional(), indexNodeId: z.string().min(1).max(200).nullable().optional() });
export const taskActionSchema = z.strictObject({
  action: z.enum(["start", "pause", "resume", "cancel", "replan"]),
  revision: z.number().int().nonnegative(), planVersion: z.number().int().nonnegative(),
  feedback: z.string().trim().min(1).max(20_000).optional(),
});
export function parseTaskPlan(text: string): TaskPlan {
  return taskPlanSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
}
export const emptyTaskBudget = (): TaskBudget => ({ modelCalls: 0, toolCalls: 0, inputTokens: 0, elapsedMs: 0, embeddingRequests: 0, estimatedEmbeddingInputTokens: 0 });
export function validateTaskCitations(text: string, allowed: ReadonlySet<string>) {
  return text.replace(/\[(T\d+)\]/g, (match, citation: string) => allowed.has(citation) ? match : "[未验证引用]");
}
