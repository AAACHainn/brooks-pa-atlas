export type AiOcrBatchMode = "missing" | "all";
export type AiOcrBatchStatus = "RUNNING" | "PAUSING" | "PAUSED" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "CANCELLED";
export type AiOcrBatchPreview = {
  previewToken: string; indexPath: string; totalImages: number; withTextImages: number; withoutTextImages: number;
  modes: Record<AiOcrBatchMode, { count: number; estimatedInputTokens: number }>;
  endpoint: { name: string; url: string; model: string } | null; error: string | null;
  expiresAt: string; action: "start" | "resume" | "retry";
};
export type AiOcrBatchSnapshot = {
  id: string; revision: number; indexPath: string; mode: AiOcrBatchMode; status: AiOcrBatchStatus;
  totalImages: number; completedImages: number; failedImages: number; skippedImages: number;
  processedImages: number; progressPercent: number; currentImage: string | null;
  requests: number; estimatedInputTokens: number; reportedInputTokens: number | null; reportedOutputTokens: number | null;
  inputReportedRequests: number; outputReportedRequests: number; endpointName: string; model: string;
  error: string | null; updatedAt: string;
  issues: { originalName: string; status: string; error: string | null }[];
};
export const aiOcrBatchIsActive = (status: AiOcrBatchStatus) => ["RUNNING", "PAUSING", "PAUSED"].includes(status);

// Refresh remote fields only when the user has not edited that field locally.
export function mergeAiOcrDraft<T extends object>(current: T, baseline: T, incoming: T): T {
  return Object.fromEntries(Object.entries(incoming).map(([name, value]) => {
    const key = name as keyof T;
    return [name, JSON.stringify(current[key]) === JSON.stringify(baseline[key]) ? value : current[key]];
  })) as T;
}
