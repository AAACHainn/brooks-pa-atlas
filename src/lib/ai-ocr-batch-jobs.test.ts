import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import sharp from "sharp";
import { defaultStoredAiConfig, AI_CONFIG_SETTING_KEY } from "@/lib/ai-config";
import { currentHeavyTask, acquireHeavyTask, releaseHeavyTask } from "@/lib/background-task-coordinator";
import { mergeAiOcrDraft } from "@/lib/ai-ocr-batch-types";
import type { PrismaClient } from "@/generated/prisma/client";

let directory: string, prisma: PrismaClient;
let service: typeof import("@/lib/ai-ocr-batch-jobs");
let batch: typeof import("@/app/api/ai/ocr-refine/index-nodes/[id]/batch/route");
let actions: typeof import("@/app/api/ai/ocr-refine/jobs/[id]/actions/route");
const originalFetch = globalThis.fetch;
const config = defaultStoredAiConfig();
config.activeEndpointId = "mock";
config.endpoints = [{ id: "mock", name: "Mock", provider: "custom", baseUrl: "http://mock.invalid/v1", useCustomUrls: false,
  chatCompletionsUrl: "", modelsUrl: "", apiKey: "secret-never-log", models: ["vision"], defaultModel: "vision" }];
const response = (content: string, usage?: { prompt_tokens: number; completion_tokens: number }, finish_reason = "stop") => Response.json({ choices: [{ message: { content }, finish_reason }], ...(usage ? { usage } : {}) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function until(check: () => Promise<boolean>) { for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error("Timed out waiting for fixture"); }
async function saveConfig(value = config) { await prisma.appSetting.upsert({ where: { key: AI_CONFIG_SETTING_KEY }, update: { value: JSON.stringify(value) }, create: { key: AI_CONFIG_SETTING_KEY, value: JSON.stringify(value) } }); }
async function start(mode: "missing" | "all" = "missing") { const p = await service.previewAiOcrBatch("root"); return service.startAiOcrBatch("root", mode, p.previewToken); }
async function job(id: string) { return service.getAiOcrBatch(id); }
async function image(id: string) { return prisma.chartImage.findUniqueOrThrow({ where: { id } }); }

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "atlas-ai-ocr-batch-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "main.db")}`;
  process.env.BROOKS_LIBRARY_ROOT = directory;
  const db = new Database(path.join(directory, "main.db"));
  for (const name of (await readdir("prisma/migrations")).sort()) if (name !== "migration_lock.toml") db.exec(await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  db.close();
  await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toFile(path.join(directory, "image.png"));
  prisma = (await import("@/lib/db")).prisma;
  service = await import("@/lib/ai-ocr-batch-jobs");
  batch = await import("@/app/api/ai/ocr-refine/index-nodes/[id]/batch/route");
  actions = await import("@/app/api/ai/ocr-refine/jobs/[id]/actions/route");
});
beforeEach(async () => {
  globalThis.fetch = async () => response("Recognized original text");
  await prisma.aiOcrBatchPreview.deleteMany();
  await prisma.aiOcrBatchJob.deleteMany();
  await prisma.chartImage.deleteMany();
  await prisma.indexNode.deleteMany();
  await saveConfig();
  await prisma.indexNode.create({ data: { id: "root", name: "Root", path: "Root" } });
  await prisma.indexNode.create({ data: { id: "child", parentId: "root", name: "Child", path: "Unrelated stored path" } });
  await prisma.indexNode.create({ data: { id: "outside", name: "Outside", path: "Root / misleading" } });
  for (const [id, node, text] of [["a", "root", null], ["b", "child", " \n\t "], ["c", "child", "Original draft"], ["d", "outside", null]] as const) {
    // A unique safe path per record; the generated fixture is read via symlink-free explicit file paths.
    const file = `${id}.png`;
    const { copyFile } = await import("node:fs/promises"); await copyFile(path.join(directory, "image.png"), path.join(directory, file));
    await prisma.chartImage.create({ data: { id, originalName: file, libraryPath: path.relative(process.cwd(), path.join(directory, file)), mimeType: "image/png", sizeBytes: 100,
      hash: id.repeat(64), indexNodeId: node, ocrText: text, ocrStatus: "SKIPPED" } });
  }
});
after(async () => {
  globalThis.fetch = originalFetch;
  await prisma?.$disconnect();
  for (const name of ["a.png", "b.png", "c.png", "d.png", "image.png", "main.db"]) await unlink(path.join(directory, name));
});

test("preview uses actual descendants, whitespace rules and real messages without remote calls", async () => {
  globalThis.fetch = async () => { throw new Error("Preview must not fetch"); };
  const p = await service.previewAiOcrBatch("root");
  assert.equal(p.totalImages, 3); assert.equal(p.withTextImages, 1); assert.equal(p.withoutTextImages, 2);
  assert.equal(p.modes.missing.count, 2); assert.equal(p.modes.all.count, 3);
  assert.equal(p.modes.missing.estimatedInputTokens, service.estimateAiOcrInput(config.skills.ocrRefinement.prompt, await image("a")) + service.estimateAiOcrInput(config.skills.ocrRefinement.prompt, await image("b")));
  assert.ok(p.modes.all.estimatedInputTokens > p.modes.missing.estimatedInputTokens);
  assert.equal(JSON.stringify(p).includes("secret-never-log"), false);
  // Preview needs metadata only, even when an image file is missing.
  await unlink(path.join(directory, "a.png"));
  assert.equal((await service.previewAiOcrBatch("root")).modes.all.count, 3);
});

test("incomplete AI config and empty scope cannot start", async () => {
  await saveConfig(defaultStoredAiConfig());
  const p = await service.previewAiOcrBatch("root"); assert.equal(p.endpoint, null); assert.ok(p.error);
  await assert.rejects(service.startAiOcrBatch("root", "missing", p.previewToken));
  await saveConfig();
  await prisma.chartImage.updateMany({ where: { indexNodeId: { in: ["root", "child"] } }, data: { ocrText: "already present" } });
  await assert.rejects(start(), /No eligible images/);
});

test("expired, changed OCR, moved scope and changed configuration previews are rejected before requesting", async () => {
  let requests = 0; globalThis.fetch = async () => { requests++; return response("text"); };
  let p = await service.previewAiOcrBatch("root");
  await prisma.aiOcrBatchPreview.update({ where: { token: p.previewToken }, data: { expiresAt: new Date(0) } });
  await assert.rejects(service.startAiOcrBatch("root", "all", p.previewToken), /expired/);
  p = await service.previewAiOcrBatch("root"); await prisma.chartImage.update({ where: { id: "a" }, data: { ocrText: "new human text" } });
  await assert.rejects(service.startAiOcrBatch("root", "all", p.previewToken), /changed/);
  p = await service.previewAiOcrBatch("root"); await prisma.indexNode.update({ where: { id: "child" }, data: { parentId: "outside" } });
  await assert.rejects(service.startAiOcrBatch("root", "all", p.previewToken), /changed/);
  p = await service.previewAiOcrBatch("root"); const changed = structuredClone(config); changed.skills.ocrRefinement.prompt += "changed"; await saveConfig(changed);
  await assert.rejects(service.startAiOcrBatch("root", "all", p.previewToken), /changed/);
  assert.equal(requests, 0); assert.equal(currentHeavyTask(), null);
});

test("first result commits before next request, ordinary failure retains draft, retry only failed items", async () => {
  const second = deferred<Response>(); let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, "vision");
    assert.equal(body.messages[1].content[1].type, "image_url");
    calls++;
    if (calls === 1) return response("First saved", { prompt_tokens: 123, completion_tokens: 12 });
    if (calls === 2) return second.promise;
    return response("", undefined, "content_filter");
  };
  const p = await service.previewAiOcrBatch("root");
  const started = await service.startAiOcrBatch("root", "all", p.previewToken);
  assert.equal((await service.startAiOcrBatch("root", "all", p.previewToken)).id, started.id);
  await until(async () => calls === 2);
  assert.equal((await image("a")).ocrText, "First saved"); assert.equal((await job(started.id)).completedImages, 1);
  assert.equal((await image("b")).ocrStatus, "SKIPPED");
  second.resolve(response("Second saved")); await service.waitAiOcrBatch(started.id);
  const done = await job(started.id);
  assert.equal(done.status, "COMPLETED_WITH_ERRORS"); assert.equal(done.failedImages, 1);
  assert.equal((await image("c")).ocrText, "Original draft");
  assert.equal(done.reportedInputTokens, 123); assert.equal(done.inputReportedRequests, 1); assert.equal(done.requests, 3);
  assert.ok(done.estimatedInputTokens > 12000);
  const retry = await service.previewAiOcrBatch("root", done.id, "retry"); assert.equal(retry.modes.all.count, 1);
  const names: string[] = []; globalThis.fetch = async (_u, init) => { names.push(JSON.parse(String(init?.body)).messages[1].content[0].text); return response("Retried original"); };
  await service.controlAiOcrBatch(done.id, "retry", done.revision, retry.previewToken); await service.waitAiOcrBatch(done.id);
  assert.equal(names.length, 1); assert.match(names[0], /c.png/); assert.match(names[0], /Original draft/);
  assert.equal((await job(done.id)).completedImages, 3); assert.equal((await job(done.id)).requests, 4);
  assert.equal((await image("a")).ocrText, "First saved");
});

test("pause saves current image, releases lease, refresh never resumes and remaining work skips successes", async () => {
  const pending = deferred<Response>(); let calls = 0;
  globalThis.fetch = async () => { calls++; return pending.promise; };
  const started = await start("all"); await until(async () => calls === 1);
  const paused = await service.controlAiOcrBatch(started.id, "pause", (await job(started.id)).revision);
  assert.equal(paused.status, "PAUSING"); assert.equal((await image("a")).ocrText, null);
  pending.resolve(response("Saved before pause")); await service.waitAiOcrBatch(started.id);
  const snapshot = await job(started.id); assert.equal(snapshot.status, "PAUSED"); assert.equal(snapshot.completedImages, 1);
  assert.equal(currentHeavyTask(), null); await service.activeAiOcrBatch(); assert.equal(calls, 1);
  await assert.rejects(start("all"), /unfinished/);
  globalThis.fetch = async () => { calls++; return response("Remaining"); };
  await service.controlAiOcrBatch(started.id, "resume", snapshot.revision); await service.waitAiOcrBatch(started.id);
  assert.equal(calls, 3); assert.equal((await image("a")).ocrText, "Saved before pause");
});

test("cancel blocks late results and retains already committed images", async () => {
  const pending = deferred<Response>(); let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? response("Saved") : pending.promise; };
  const started = await start(); await until(async () => calls === 2);
  await service.controlAiOcrBatch(started.id, "cancel", (await job(started.id)).revision);
  pending.resolve(response("Late must not save", { prompt_tokens: 999, completion_tokens: 999 })); await service.waitAiOcrBatch(started.id);
  assert.equal((await job(started.id)).status, "CANCELLED"); assert.equal((await image("a")).ocrText, "Saved");
  assert.equal((await image("b")).ocrText, " \n\t "); assert.equal((await job(started.id)).reportedInputTokens, null);
});

test("post-request human changes and pre-request local OCR/deletion/moves are skipped", async () => {
  const pending = deferred<Response>(); let calls = 0;
  globalThis.fetch = async () => { calls++; return pending.promise; };
  const started = await start("all"); await until(async () => calls === 1);
  await prisma.chartImage.update({ where: { id: "a" }, data: { ocrText: "Human edit", ocrUpdatedAt: new Date() } });
  await prisma.chartImage.update({ where: { id: "b" }, data: { indexNodeId: "outside" } });
  await prisma.chartImage.update({ where: { id: "c" }, data: { ocrStatus: "RUNNING" } });
  pending.resolve(response("Old AI result")); await service.waitAiOcrBatch(started.id);
  assert.equal(calls, 1); assert.equal((await image("a")).ocrText, "Human edit");
  assert.equal((await job(started.id)).skippedImages, 3);
  await prisma.chartImage.updateMany({ data: { ocrText: null, ocrStatus: "SKIPPED" } });
  const block = deferred<Response>(); globalThis.fetch = async () => block.promise;
  const next = await start(); await until(async () => Boolean((await job(next.id)).currentImage));
  await prisma.chartImage.delete({ where: { id: "a" } }); block.resolve(response("Deleted")); await service.waitAiOcrBatch(next.id);
  assert.equal((await job(next.id)).skippedImages, 1);
});

test("global rate limit pauses with sanitized errors, configuration change requires renewed consent", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "secret-never-log data:image/jpeg;base64,private" } }, { status: 429 }); };
  const started = await start(); await service.waitAiOcrBatch(started.id);
  let snapshot = await job(started.id); assert.equal(snapshot.status, "PAUSED"); assert.equal(calls, 1);
  assert.match(snapshot.error!, /429/); assert.equal(JSON.stringify(snapshot).includes("secret-never-log"), false); assert.equal(JSON.stringify(snapshot).includes("base64"), false);
  const changed = structuredClone(config); changed.skills.ocrRefinement.prompt += "New rules"; await saveConfig(changed);
  await assert.rejects(service.controlAiOcrBatch(started.id, "resume", snapshot.revision), /Reconfirm/);
  const p = await service.previewAiOcrBatch("root", started.id, "resume"); assert.equal(p.modes.all.count, 1);
  globalThis.fetch = async () => response("Remaining");
  await service.controlAiOcrBatch(started.id, "resume", snapshot.revision, p.previewToken); await service.waitAiOcrBatch(started.id);
  snapshot = await job(started.id); assert.equal(snapshot.status, "COMPLETED_WITH_ERRORS");
  assert.equal(snapshot.requests, 2); assert.equal(snapshot.reportedInputTokens, null);
});

test("startup recovery pauses interrupted manifest and preserves attempts without remote requests", async () => {
  const block = deferred<Response>(); globalThis.fetch = async () => block.promise;
  const started = await start(); await until(async () => Boolean((await job(started.id)).currentImage));
  await service.recoverAiOcrBatches(); block.resolve(response("Pre-restart late result")); await service.waitAiOcrBatch(started.id);
  const snapshot = await job(started.id); assert.equal(snapshot.status, "PAUSED"); assert.equal(snapshot.completedImages, 0); assert.equal(snapshot.requests, 1);
  assert.equal(await prisma.aiOcrBatchItem.count({ where: { jobId: started.id, status: "RUNNING" } }), 0);
  let calls = 0; globalThis.fetch = async () => { calls++; return response("Resumed"); };
  await service.activeAiOcrBatch(); assert.equal(calls, 0);
  await service.controlAiOcrBatch(started.id, "resume", snapshot.revision); await service.waitAiOcrBatch(started.id);
  assert.equal(calls, 2); assert.equal((await job(started.id)).requests, 3);
});

test("strict HTTP inputs, stale revisions, heavy task conflicts and missing schema never request a model", async () => {
  const context = { params: Promise.resolve({ id: "root" }) };
  assert.equal((await batch.POST(new Request("http://atlas.test", { method: "POST", body: JSON.stringify({ mode: "all", previewToken: "invalid", extra: 1 }) }), context)).status, 400);
  assert.ok(acquireHeavyTask("thumbnails", "test")); await assert.rejects(start(), /后台重任务/); releaseHeavyTask("thumbnails", "test");
  const block = deferred<Response>(); globalThis.fetch = async () => block.promise;
  const started = await start();
  const actionContext = { params: Promise.resolve({ id: started.id }) };
  assert.equal((await actions.POST(new Request("http://atlas.test", { method: "POST", body: JSON.stringify({ action: "pause", revision: 100 }) }), actionContext)).status, 409);
  await service.controlAiOcrBatch(started.id, "cancel", (await job(started.id)).revision); block.resolve(response("late")); await service.waitAiOcrBatch(started.id);
  await prisma.$executeRawUnsafe('ALTER TABLE "AiOcrBatchPreview" RENAME TO "FixtureMissingPreview"');
  try { assert.equal((await batch.GET(new Request("http://atlas.test"), context)).status, 503); }
  finally { await prisma.$executeRawUnsafe('ALTER TABLE "FixtureMissingPreview" RENAME TO "AiOcrBatchPreview"'); }
});

test("empty and truncated results retain drafts while reported usage is recorded", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? response("", { prompt_tokens: 8, completion_tokens: 0 }) : response("Incomplete", { prompt_tokens: 9, completion_tokens: 4 }, "length"); };
  const started = await start("all"); await service.waitAiOcrBatch(started.id);
  const result = await job(started.id);
  assert.equal(result.failedImages, 3); assert.equal(result.completedImages, 0);
  assert.equal((await image("a")).ocrText, null); assert.equal((await image("c")).ocrText, "Original draft");
  assert.equal(result.reportedInputTokens, 26); assert.equal(result.inputReportedRequests, 3);
});

test("renewed retry previews still reject changed OCR and replayed confirmation is idempotent", async () => {
  globalThis.fetch = async () => response("", undefined, "length");
  const started = await start(); await service.waitAiOcrBatch(started.id);
  const snapshot = await job(started.id);
  const p = await service.previewAiOcrBatch("root", started.id, "retry");
  await prisma.chartImage.update({ where: { id: "a" }, data: { ocrText: "Human saved" } });
  await assert.rejects(service.controlAiOcrBatch(started.id, "retry", snapshot.revision, p.previewToken), /changed/);
  const renewed = await service.previewAiOcrBatch("root", started.id, "retry");
  let calls = 0; globalThis.fetch = async () => { calls++; return response("Retry original"); };
  await service.controlAiOcrBatch(started.id, "retry", snapshot.revision, renewed.previewToken);
  await service.controlAiOcrBatch(started.id, "retry", snapshot.revision, renewed.previewToken);
  await service.waitAiOcrBatch(started.id);
  assert.equal(calls, 1); assert.equal((await image("a")).ocrText, "Human saved"); assert.equal((await job(started.id)).skippedImages, 1);
});

test("draft merging updates saved OCR while preserving unsaved title and local OCR edits", () => {
  const base = { title: "Old", ocrText: "Old OCR", tagNames: ["A"] };
  const incoming = { title: "Old", ocrText: "Refined", tagNames: ["A"] };
  assert.deepEqual(mergeAiOcrDraft({ ...base, title: "Unsaved" }, base, incoming), { ...incoming, title: "Unsaved" });
  assert.equal(mergeAiOcrDraft({ ...base, ocrText: "Local OCR" }, base, incoming).ocrText, "Local OCR");
});
