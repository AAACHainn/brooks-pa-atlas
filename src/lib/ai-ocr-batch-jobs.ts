import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ChartImage, AiOcrBatchJob, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AiServiceError } from "@/lib/ai-client";
import { resolveAiEndpointUrls, resolveAiModelSelection, type StoredAiConfig } from "@/lib/ai-config";
import { buildOcrRefinementMessages, refineOcrTextWithAi } from "@/lib/ai-ocr-refinement";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { acquireHeavyTaskOrThrow, releaseHeavyTask } from "@/lib/background-task-coordinator";
import { readStoredImage } from "@/lib/storage";
import type { AiOcrBatchMode, AiOcrBatchPreview, AiOcrBatchSnapshot } from "@/lib/ai-ocr-batch-types";

type Client = Prisma.TransactionClient;
type Worker = { runId: string; controller: AbortController; done: Promise<void> };
const globals = globalThis as typeof globalThis & { brooksAiOcrWorkers?: Map<string, Worker> };
const workers = globals.brooksAiOcrWorkers ??= new Map();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class AiOcrBatchError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
const conflict = () => new AiOcrBatchError("范围、OCR 或 AI 配置已变化，请刷新预览后重新确认。 / Sources or AI settings changed; refresh the preview.");
export const hasAiOcrText = (value: string | null) => Boolean(value?.trim());
function selection(config: StoredAiConfig) {
  const endpoint = config.endpoints.find((e) => e.id === config.activeEndpointId);
  const skill = config.skills.ocrRefinement;
  const { model } = resolveAiModelSelection(config, skill.modelOverride);
  if (!endpoint || !model || !skill.prompt.trim()) throw new AiOcrBatchError("AI 配置不完整，请选择端点和模型。 / Configure an AI endpoint and model.");
  let url: string;
  try { url = resolveAiEndpointUrls(endpoint).chatCompletionsUrl; } catch { throw new AiOcrBatchError("AI 端点地址无效。 / Invalid AI endpoint URL."); }
  // Only a digest is persisted. Credentials stay in AppSetting and the executing segment's memory.
  const fingerprint = digest({ endpoint: endpoint.id, provider: endpoint.provider, url, model, prompt: skill.prompt });
  return { endpoint, model, prompt: skill.prompt, url, fingerprint };
}
function sourceFingerprint(image: ChartImage) {
  return digest([image.id, image.hash, image.libraryPath, image.originalName, image.indexNodeId,
    image.ocrText, image.ocrStatus, image.ocrError, image.ocrUpdatedAt]);
}
export function estimateAiOcrInput(prompt: string, image: Pick<ChartImage, "originalName" | "ocrText">) {
  const messages = buildOcrRefinementMessages({ prompt, originalName: image.originalName, ocrText: image.ocrText ?? "", imageDataUrl: "" });
  return messages.reduce((sum, message) => sum + 32 + (typeof message.content === "string"
    ? Math.ceil(Buffer.byteLength(message.content, "utf8") / 2)
    : message.content.reduce((n, part) => n + (part.type === "text" ? Math.ceil(Buffer.byteLength(part.text, "utf8") / 2) : 4096), 0)), 32);
}
async function scope(indexId: string, db: Client = prisma) {
  const nodes = await db.indexNode.findMany({ select: { id: true, parentId: true, path: true }, orderBy: { id: "asc" } });
  const root = nodes.find((n) => n.id === indexId);
  if (!root) throw new AiOcrBatchError("索引不存在。 / Index not found.", 404);
  const ids = new Set([root.id]);
  const children = new Map<string, string[]>();
  for (const node of nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  const queue = [root.id];
  for (let i = 0; i < queue.length; i++) for (const id of children.get(queue[i]) ?? []) if (!ids.has(id)) { ids.add(id); queue.push(id); }
  return { root, nodes: nodes.filter((n) => ids.has(n.id)), ids: [...ids].sort() };
}
async function bundle(indexId: string, job?: AiOcrBatchJob, action: "start" | "resume" | "retry" = "start", db: Client = prisma) {
  const tree = await scope(indexId, db);
  let images = await db.chartImage.findMany({ where: { indexNodeId: { in: tree.ids } }, orderBy: { id: "asc" } });
  if (job) {
    const items = await db.aiOcrBatchItem.findMany({ where: { jobId: job.id, status: action === "retry" ? "FAILED" : "PENDING" }, orderBy: { ordinal: "asc" } });
    const ids = new Set(items.map((i) => i.sourceImageId));
    images = images.filter((i) => ids.has(i.id));
    // Include deleted/moved items in the preview digest so consent never silently changes.
    const manifest = items.map((i) => [i.id, i.sourceFingerprint, i.status]);
    return finishBundle(await readStoredAiConfig(db), tree, images, manifest, job, action);
  }
  return finishBundle(await readStoredAiConfig(db), tree, images, [], undefined, action);
}
function finishBundle(config: StoredAiConfig, tree: Awaited<ReturnType<typeof scope>>, images: ChartImage[], manifest: unknown[], job: AiOcrBatchJob | undefined, action: string) {
  let selected: ReturnType<typeof selection> | null = null, error: string | null = null;
  try { selected = selection(config); } catch (e) { error = (e as Error).message; }
  const missing = images.filter((i) => !hasAiOcrText(i.ocrText));
  const estimate = (list: ChartImage[]) => selected ? list.reduce((n, image) => n + estimateAiOcrInput(selected!.prompt, image), 0) : 0;
  return { tree, images, selected, error, fingerprint: digest({ tree: tree.nodes, images: images.map(sourceFingerprint), manifest,
    action, revision: job?.revision, config: selected?.fingerprint, key: selected ? digest(selected.endpoint.apiKey) : null }),
    modes: { missing: { count: missing.length, estimatedInputTokens: estimate(missing) }, all: { count: images.length, estimatedInputTokens: estimate(images) } } };
}
export async function previewAiOcrBatch(indexId: string, jobId?: string, action: "start" | "resume" | "retry" = "start"): Promise<AiOcrBatchPreview> {
  const job = jobId ? await prisma.aiOcrBatchJob.findUniqueOrThrow({ where: { id: jobId } }) : undefined;
  const data = await bundle(indexId, job, action);
  const token = randomUUID(), expiresAt = new Date(Date.now() + 600_000);
  await prisma.aiOcrBatchPreview.deleteMany({ where: { consumedJobId: null, expiresAt: { lt: new Date() } } });
  await prisma.aiOcrBatchPreview.create({ data: { token, indexNodeId: indexId, jobId, action, revision: job?.revision, fingerprint: data.fingerprint, expiresAt } });
  return { previewToken: token, indexPath: data.tree.root.path, totalImages: data.images.length,
    withTextImages: data.images.filter((i) => hasAiOcrText(i.ocrText)).length, withoutTextImages: data.modes.missing.count,
    modes: data.modes, endpoint: data.selected ? { name: data.selected.endpoint.name, url: data.selected.url, model: data.selected.model } : null,
    error: data.error, expiresAt: expiresAt.toISOString(), action };
}
async function checkPreview(db: Client, token: string, indexId: string, job?: AiOcrBatchJob, action = "start") {
  const preview = await db.aiOcrBatchPreview.findUnique({ where: { token } });
  if (!preview || preview.indexNodeId !== indexId || preview.action !== action || (preview.jobId ?? undefined) !== job?.id) throw conflict();
  if (preview.consumedJobId) return { consumed: preview.consumedJobId };
  if (preview.expiresAt.getTime() < Date.now()) throw new AiOcrBatchError("预览已过期，请重新确认。 / Preview expired; refresh it.");
  const data = await bundle(indexId, job, action as "start" | "resume" | "retry", db);
  if (data.fingerprint !== preview.fingerprint) throw conflict();
  if (!data.selected) throw new AiOcrBatchError(data.error!);
  return { data };
}
export async function startAiOcrBatch(indexId: string, mode: AiOcrBatchMode, token: string) {
  const existingPreview = await prisma.aiOcrBatchPreview.findUnique({ where: { token } });
  if (existingPreview?.indexNodeId === indexId && existingPreview.action === "start" && existingPreview.consumedJobId) return getAiOcrBatch(existingPreview.consumedJobId);
  const id = randomUUID(), runId = randomUUID();
  acquireHeavyTaskOrThrow("ai-ocr-batch", id);
  let selected: ReturnType<typeof selection> | undefined;
  try {
    const created = await prisma.$transaction(async (db) => {
      const checked = await checkPreview(db, token, indexId);
      if (checked.consumed) return checked.consumed;
      const data = checked.data!;
      if (await db.aiOcrBatchJob.findUnique({ where: { activeKey: "global" } })) throw new AiOcrBatchError("请先继续或取消已有 AI 精校任务。 / Resume or cancel the unfinished batch first.");
      const images = mode === "missing" ? data.images.filter((i) => !hasAiOcrText(i.ocrText)) : data.images;
      if (!images.length) throw new AiOcrBatchError("没有可处理图片。 / No eligible images.");
      selected = data.selected!;
      await db.aiOcrBatchJob.create({ data: { id, activeKey: "global", indexNodeId: indexId, indexPath: data.tree.root.path,
        scopeJson: JSON.stringify(data.tree.ids), mode, status: "RUNNING", runId, configFingerprint: selected.fingerprint,
        endpointName: selected.endpoint.name, model: selected.model, totalImages: images.length,
        items: { create: images.map((image, ordinal) => ({ id: randomUUID(), chartImageId: image.id, sourceImageId: image.id,
          originalName: image.originalName, ordinal, sourceFingerprint: sourceFingerprint(image) })) } } });
      await db.aiOcrBatchPreview.update({ where: { token }, data: { consumedJobId: id } });
      return id;
    });
    if (created !== id) { releaseHeavyTask("ai-ocr-batch", id); return getAiOcrBatch(created); }
    dispatch(id, runId, selected!);
    return getAiOcrBatch(id);
  } catch (error) { releaseHeavyTask("ai-ocr-batch", id); throw error; }
}
export async function getAiOcrBatch(id: string): Promise<AiOcrBatchSnapshot> {
  const job = await prisma.aiOcrBatchJob.findUnique({ where: { id } });
  if (!job) throw new AiOcrBatchError("任务不存在。 / Job not found.", 404);
  const current = await prisma.aiOcrBatchItem.findFirst({ where: { jobId: id, status: "RUNNING" } });
  const issues = await prisma.aiOcrBatchItem.findMany({ where: { jobId: id, status: { in: ["FAILED", "SKIPPED"] } }, orderBy: { ordinal: "asc" }, take: 20, select: { originalName: true, status: true, error: true } });
  const processedImages = job.completedImages + job.failedImages + job.skippedImages;
  return { id, revision: job.revision, indexPath: job.indexPath, mode: job.mode as AiOcrBatchMode, status: job.status as AiOcrBatchSnapshot["status"],
    totalImages: job.totalImages, completedImages: job.completedImages, failedImages: job.failedImages, skippedImages: job.skippedImages,
    processedImages, progressPercent: Math.floor(100 * processedImages / job.totalImages), currentImage: current?.originalName ?? null,
    requests: job.requests, estimatedInputTokens: job.estimatedInputTokens, reportedInputTokens: job.inputReportedRequests ? job.reportedInputTokens : null,
    reportedOutputTokens: job.outputReportedRequests ? job.reportedOutputTokens : null, inputReportedRequests: job.inputReportedRequests,
    outputReportedRequests: job.outputReportedRequests, endpointName: job.endpointName, model: job.model, error: job.error,
    updatedAt: job.updatedAt.toISOString(), issues };
}
export async function activeAiOcrBatch() {
  const job = await prisma.aiOcrBatchJob.findUnique({ where: { activeKey: "global" } });
  return job ? getAiOcrBatch(job.id) : null;
}
function authorized(job: AiOcrBatchJob | null, runId: string) { return Boolean(job?.runId === runId && ["RUNNING", "PAUSING"].includes(job.status)); }
async function sourceError(db: Client, job: AiOcrBatchJob, image: ChartImage | null, fingerprint: string) {
  if (!image) return "图片已删除。 / Image deleted.";
  const confirmedIds: string[] = JSON.parse(job.scopeJson);
  let currentIds: string[];
  try { currentIds = (await scope(job.indexNodeId, db)).ids; } catch { return "索引已删除。 / Index deleted."; }
  if (!image.indexNodeId || !confirmedIds.includes(image.indexNodeId) || !currentIds.includes(image.indexNodeId)) return "图片已移出确认范围。 / Image moved outside the confirmed scope.";
  if (sourceFingerprint(image) !== fingerprint) return "图片或 OCR 已修改。 / Image or OCR changed.";
  if (["PENDING", "RUNNING"].includes(image.ocrStatus)) return "本地 OCR 正在等待或运行。 / Local OCR queued or running.";
  return null;
}
async function settle(id: string, runId: string, itemId: string, status: "COMPLETED" | "FAILED" | "SKIPPED", error: string | null, text?: string) {
  return prisma.$transaction(async (db) => {
    const job = await db.aiOcrBatchJob.findUnique({ where: { id } });
    if (!authorized(job, runId)) return;
    const item = await db.aiOcrBatchItem.findUniqueOrThrow({ where: { id: itemId } });
    if (!["RUNNING", "PENDING"].includes(item.status)) return;
    if (status === "COMPLETED") {
      const image = await db.chartImage.findUnique({ where: { id: item.sourceImageId } });
      const changed = await sourceError(db, job!, image, item.sourceFingerprint);
      if (changed) { status = "SKIPPED"; error = changed; }
      else await db.chartImage.update({ where: { id: item.sourceImageId }, data: { ocrText: text, ocrStatus: "COMPLETED", ocrError: null, ocrUpdatedAt: new Date() } });
    }
    await db.aiOcrBatchItem.update({ where: { id: itemId }, data: { status, error } });
    await db.aiOcrBatchJob.update({ where: { id }, data: { [status === "COMPLETED" ? "completedImages" : status === "FAILED" ? "failedImages" : "skippedImages"]: { increment: 1 } } });
  });
}
function safeFailure(error: unknown): { message: string; global: boolean } {
  // Never persist raw upstream errors, which may echo a key, request body or data URL.
  if (error instanceof AiServiceError) {
    const code = error.upstreamStatus;
    const global = error.kind === "configuration" || error.kind === "unsupported-image" || [401, 403, 404, 429].includes(code ?? 0);
    const labels: Record<string, string> = { configuration: "AI 配置错误 / AI configuration error", "unsupported-image": "模型不支持图片 / Model does not support images", timeout: "请求超时 / Request timed out", "invalid-response": "结果为空、截断或被过滤 / Empty, truncated or filtered result", upstream: "远端请求失败 / Upstream request failed" };
    return { global, message: `${labels[error.kind] ?? "AI 请求失败 / AI request failed"}${code ? ` (HTTP ${code})` : ""}` };
  }
  return { global: false, message: "图片读取或精校失败 / Image read or refinement failed" };
}
function dispatch(id: string, runId: string, selected: ReturnType<typeof selection>) {
  const controller = new AbortController();
  const worker: Worker = { runId, controller, done: Promise.resolve() };
  workers.set(id, worker);
  worker.done = execute(id, runId, selected, controller.signal).catch(async () => {
    try {
      await prisma.aiOcrBatchJob.updateMany({ where: { id, runId }, data: { status: "PAUSED", runId: null, revision: { increment: 1 }, error: "后台执行中断，请继续 / Execution interrupted; resume manually" } });
    } catch { console.warn("AI OCR batch persistence failed; check database availability."); }
  }).finally(() => { if (workers.get(id) === worker) { workers.delete(id); releaseHeavyTask("ai-ocr-batch", id); } });
}
async function execute(id: string, runId: string, selected: ReturnType<typeof selection>, signal: AbortSignal) {
  for (;;) {
    if (signal.aborted) return;
    const job = await prisma.aiOcrBatchJob.findUniqueOrThrow({ where: { id } });
    if (!authorized(job, runId)) return;
    if (job.status === "PAUSING") {
      await prisma.aiOcrBatchJob.updateMany({ where: { id, runId }, data: { status: "PAUSED", runId: null, revision: { increment: 1 } } }); return;
    }
    const item = await prisma.aiOcrBatchItem.findFirst({ where: { jobId: id, status: "PENDING" }, orderBy: { ordinal: "asc" } });
    if (!item) {
      await prisma.$transaction(async (db) => {
        const current = await db.aiOcrBatchJob.findUnique({ where: { id } });
        if (!authorized(current, runId)) return;
        await db.aiOcrBatchJob.update({ where: { id }, data: current!.status === "PAUSING"
          ? { status: "PAUSED", runId: null, revision: { increment: 1 } }
          : { status: current!.failedImages ? "COMPLETED_WITH_ERRORS" : "COMPLETED", activeKey: null, runId: null, finishedAt: new Date(), revision: { increment: 1 } } });
      }); return;
    }
    const image = await prisma.chartImage.findUnique({ where: { id: item.sourceImageId } });
    const changed = await sourceError(prisma, job, image, item.sourceFingerprint);
    if (changed) { await settle(id, runId, item.id, "SKIPPED", changed); continue; }
    let dispatched = false;
    try {
      const { buffer } = await readStoredImage(image!.libraryPath);
      if (signal.aborted) return;
      const estimate = estimateAiOcrInput(selected.prompt, image!);
      dispatched = await prisma.$transaction(async (db) => {
        const current = await db.aiOcrBatchJob.findUnique({ where: { id } });
        if (!authorized(current, runId) || current!.status !== "RUNNING") return false;
        const latest = await db.chartImage.findUnique({ where: { id: item.sourceImageId } });
        if (await sourceError(db, current!, latest, item.sourceFingerprint)) return false;
        await db.aiOcrBatchItem.update({ where: { id: item.id }, data: { status: "RUNNING", attempts: { increment: 1 }, estimatedInputTokens: { increment: estimate }, reportedInputTokens: null, reportedOutputTokens: null, finishReason: null, error: null } });
        await db.aiOcrBatchJob.update({ where: { id }, data: { requests: { increment: 1 }, estimatedInputTokens: { increment: estimate } } });
        return true;
      });
      if (!dispatched) continue;
      const text = await refineOcrTextWithAi({ ...selected, originalName: image!.originalName, ocrText: image!.ocrText ?? "", imageBuffer: buffer, signal,
        onUsage: async (usage) => { await prisma.$transaction(async (db) => {
          const current = await db.aiOcrBatchJob.findUnique({ where: { id } });
          if (!authorized(current, runId)) return;
          await db.aiOcrBatchItem.update({ where: { id: item.id }, data: { reportedInputTokens: usage.inputTokens, reportedOutputTokens: usage.outputTokens } });
          await db.aiOcrBatchJob.update({ where: { id }, data: {
            ...(usage.inputTokens !== null ? { inputReportedRequests: { increment: 1 }, reportedInputTokens: { increment: usage.inputTokens } } : {}),
            ...(usage.outputTokens !== null ? { outputReportedRequests: { increment: 1 }, reportedOutputTokens: { increment: usage.outputTokens } } : {}) } });
        }); },
        onFinishReason: async (finishReason) => { if (!signal.aborted) await prisma.aiOcrBatchItem.updateMany({ where: { id: item.id, job: { runId } }, data: { finishReason } }); } });
      if (signal.aborted) return;
      if (!text.trim()) throw new AiServiceError("invalid-response", "Empty OCR result");
      await settle(id, runId, item.id, "COMPLETED", null, text);
    } catch (error) {
      if (signal.aborted) return;
      const failure = safeFailure(error);
      await settle(id, runId, item.id, "FAILED", failure.message);
      if (failure.global) {
        await prisma.aiOcrBatchJob.updateMany({ where: { id, runId }, data: { status: "PAUSED", runId: null, revision: { increment: 1 }, error: failure.message } }); return;
      }
    }
  }
}
export async function controlAiOcrBatch(id: string, action: "pause" | "resume" | "cancel" | "retry", revision: number, token?: string) {
  if (action === "resume" || action === "retry") {
    const prior = await prisma.aiOcrBatchJob.findUnique({ where: { id } });
    // A paused/completed segment may still be releasing its lease. Wait for its
    // cleanup before taking the same job's lease for a new segment.
    if (prior && ["PAUSED", "COMPLETED", "COMPLETED_WITH_ERRORS"].includes(prior.status)) await workers.get(id)?.done;
  }
  const runId = randomUUID();
  let leased = false, selected: ReturnType<typeof selection> | undefined;
  try {
    const result = await prisma.$transaction(async (db) => {
      const job = await db.aiOcrBatchJob.findUnique({ where: { id } });
      if (!job) throw new AiOcrBatchError("任务不存在 / Job not found", 404);
      if (token) {
        const old = await db.aiOcrBatchPreview.findUnique({ where: { token } });
        if (old?.jobId === id && old.action === action && old.consumedJobId === id) return "unchanged";
      }
      if (job.revision !== revision) throw new AiOcrBatchError("任务状态已变化，请刷新。 / Job state changed; refresh it.");
      if (action === "cancel") {
        if (!job.activeKey) throw new AiOcrBatchError("任务已结束 / Job already ended");
        await db.aiOcrBatchJob.update({ where: { id }, data: { status: "CANCELLED", activeKey: null, runId: null, finishedAt: new Date(), revision: { increment: 1 } } });
        await db.aiOcrBatchItem.updateMany({ where: { jobId: id, status: "RUNNING" }, data: { status: "PENDING" } }); return "cancel";
      }
      if (action === "pause") {
        if (job.status !== "RUNNING") throw new AiOcrBatchError("任务未运行 / Job is not running");
        await db.aiOcrBatchJob.update({ where: { id }, data: { status: "PAUSING", revision: { increment: 1 } } }); return "pause";
      }
      if (action === "resume" && job.status !== "PAUSED" || action === "retry" && !["COMPLETED_WITH_ERRORS", "COMPLETED"].includes(job.status)) throw new AiOcrBatchError("当前状态不能执行该操作 / Action unavailable in this state");
      const active = await db.aiOcrBatchJob.findUnique({ where: { activeKey: "global" } });
      if (active && active.id !== id) throw new AiOcrBatchError("已有未结束任务 / Another batch is unfinished");
      const checked = token ? await checkPreview(db, token, job.indexNodeId, job, action) : undefined;
      if (checked?.consumed) return "unchanged";
      selected = checked?.data?.selected ?? selection(await readStoredAiConfig(db));
      if (action === "retry" && !token || selected!.fingerprint !== job.configFingerprint && !token) throw new AiOcrBatchError("配置已变化，请重新估算并确认剩余工作。 / Reconfirm the estimate for the remaining work.");
      if (action === "retry") {
        const failed = await db.aiOcrBatchItem.findMany({ where: { jobId: id, status: "FAILED" } });
        if (!failed.length) throw new AiOcrBatchError("没有失败项 / No failed images");
        for (const item of failed) {
          const image = await db.chartImage.findUnique({ where: { id: item.sourceImageId } });
          // A retry cannot authorize changed sources; such items will be skipped by the worker.
          await db.aiOcrBatchItem.update({ where: { id: item.id }, data: { status: "PENDING", error: null, originalName: image?.originalName ?? item.originalName } });
        }
        await db.aiOcrBatchJob.update({ where: { id }, data: { failedImages: 0 } });
      }
      acquireHeavyTaskOrThrow("ai-ocr-batch", id); leased = true;
      await db.aiOcrBatchJob.update({ where: { id }, data: { status: "RUNNING", activeKey: "global", runId, finishedAt: null, error: null,
        configFingerprint: selected!.fingerprint, endpointName: selected!.endpoint.name, model: selected!.model, revision: { increment: 1 } } });
      if (token) await db.aiOcrBatchPreview.update({ where: { token }, data: { consumedJobId: id } });
      return "run";
    });
    if (result === "cancel") { workers.get(id)?.controller.abort(); releaseHeavyTask("ai-ocr-batch", id); }
    if (result === "run") dispatch(id, runId, selected!);
    return getAiOcrBatch(id);
  } catch (error) { if (leased) releaseHeavyTask("ai-ocr-batch", id); throw error; }
}
export async function recoverAiOcrBatches() {
  // Called only during process startup. Never dispatch requests from an active-job GET.
  await prisma.$transaction(async (db) => {
    const interrupted = await db.aiOcrBatchJob.findMany({ where: { status: { in: ["RUNNING", "PAUSING"] } } });
    for (const job of interrupted) {
      await db.aiOcrBatchItem.updateMany({ where: { jobId: job.id, status: "RUNNING" }, data: { status: "PENDING" } });
      await db.aiOcrBatchJob.update({ where: { id: job.id }, data: { status: "PAUSED", runId: null, revision: { increment: 1 }, error: "服务曾中断，请手动继续 / Server restarted; resume manually" } });
    }
  });
}
export async function waitAiOcrBatch(id: string) { await workers.get(id)?.done; }
