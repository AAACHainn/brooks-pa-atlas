import "server-only";
import { createKnowledgeToolSession } from "@/lib/ai-knowledge-tools";
import { createHash } from "node:crypto";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { knowledgeDb } from "@/lib/knowledge-db";
import { listDeepKnowledgeDocuments } from "@/lib/knowledge-deep-search";
import { currentDocumentIds } from "@/lib/knowledge-search";
import { knowledgeLocatorLabel, parseKnowledgeLocator } from "@/lib/knowledge-source";
import { loadReadingImageContext } from "@/lib/ai-reading-context";
import { AiToolError, AiToolRegistry, defineAiTool } from "@/lib/ai-tool-registry";
import type { TaskScope, TaskSource } from "@/lib/ai-robot-task-types";

type Unit = { kind: "index" | "image" | "knowledge"; id: string; stamp: string; title: string; version?: string; location?: string; offset: number; length: number; citation: string };
export type TaskManifest = { scopeLabel: string; scope: TaskScope; units: Unit[]; batches: number[][] };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
async function indexText(id: string) {
  const node = await prisma.indexNode.findUnique({ where: { id }, select: { id: true, name: true, path: true, parentId: true, depth: true, sortOrder: true, navigatorOptions: { select: { option: { select: { name: true, category: { select: { name: true } } } } } } } });
  if (!node) throw new Error("source_changed");
  return JSON.stringify(node);
}
async function imageText(id: string) {
  const image = await loadReadingImageContext(id);
  if (!image) throw new Error("source_changed");
  return JSON.stringify(image.snapshot);
}
function chunk(id: string) {
  return knowledgeDb().prepare(`SELECT c.id,c.cleanedText,c.locatorJson,c.sourceCueStart,c.sourceCueEnd,c.startMs,c.endMs,
    v.id AS versionId,v.versionNumber,d.title,b.indexNodeId,b.appliesToDescendants FROM KnowledgeChunk c
    JOIN KnowledgeDocumentVersion v ON v.id=c.versionId AND v.status='ACTIVE'
    JOIN KnowledgeDocument d ON d.id=v.documentId AND d.enabled=1
    JOIN KnowledgeDocumentBinding b ON b.documentId=d.id AND b.status='ACTIVE' AND b.indexNodeId IS NOT NULL
    WHERE c.id=?`).get(id) as { id: string; cleanedText: string; locatorJson: string; sourceCueStart: number; sourceCueEnd: number; startMs: number | null; endMs: number | null; versionId: string; versionNumber: number; title: string; indexNodeId: string; appliesToDescendants: number } | undefined;
}
async function taskDocuments() {
  const bindings = knowledgeDb().prepare("SELECT documentId,indexNodeId FROM KnowledgeDocumentBinding WHERE status='ACTIVE' AND indexNodeId IS NOT NULL").all() as { documentId: string; indexNodeId: string }[];
  const nodes = new Set((await prisma.indexNode.findMany({ select: { id: true } })).map((node) => node.id));
  const valid = new Set(bindings.filter((binding) => nodes.has(binding.indexNodeId)).map((binding) => binding.documentId));
  return listDeepKnowledgeDocuments().filter((doc) => valid.has(doc.id));
}
async function scopeIds(scope: TaskScope, selection: { imageId?: string | null; indexNodeId?: string | null }) {
  const nodes = await prisma.indexNode.findMany({ select: { id: true, parentId: true, path: true } });
  const docs = await taskDocuments();
  let indexes: string[] | null = null, images: string[] | null = null, documents: string[] | null = null;
  if (scope.kind === "current") {
    if (selection.indexNodeId) indexes = [selection.indexNodeId];
    else if (selection.imageId) images = [selection.imageId];
  } else if (scope.kind === "indexes") indexes = scope.ids;
  else if (scope.kind === "images") images = scope.ids;
  else if (scope.kind === "documents") { documents = scope.ids; images = []; }
  if (scope.kind !== "current" && scope.kind !== "library" && !scope.ids.length) throw new Error("invalid_scope");
  if (indexes) {
    if (indexes.some((id) => !nodes.some((node) => node.id === id))) throw new Error("source_changed");
    const chosen = new Set(indexes);
    let changed = true;
    while (changed) { changed = false; for (const node of nodes) if (node.parentId && chosen.has(node.parentId) && !chosen.has(node.id)) { chosen.add(node.id); changed = true; } }
    indexes = [...chosen];
    documents = [...new Set((await Promise.all(indexes.map(currentDocumentIds))).flat())];
  } else if (images?.length) {
    const rows = await prisma.chartImage.findMany({ where: { id: { in: images } }, select: { id: true, indexNodeId: true } });
    if (rows.length !== new Set(images).size) throw new Error("source_changed");
    documents = [...new Set((await Promise.all(rows.map((row) => currentDocumentIds(row.indexNodeId)))).flat())];
  }
  if (scope.kind === "documents" && documents?.some((id) => !docs.some((doc) => doc.id === id))) throw new Error("source_changed");
  if (documents) documents = documents.filter((id) => docs.some((doc) => doc.id === id));
  const label = scope.kind === "library" || (!indexes && images === null && documents === null) ? "全部图库与有效知识资料"
    : indexes ? nodes.filter((node) => scope.ids.includes(node.id) || node.id === selection.indexNodeId).map((node) => node.path).join("；")
    : documents && scope.kind === "documents" ? docs.filter((doc) => documents.includes(doc.id)).map((doc) => doc.title).join("；") : `图片 ${images?.join("、")} 及关联知识资料`;
  return { indexes, images, documents, label };
}
export async function buildTaskManifest(scope: TaskScope, selection: { imageId?: string | null; indexNodeId?: string | null }, inputBudget: number, signal: AbortSignal): Promise<TaskManifest> {
  const ids = await scopeIds(scope, selection), units: Unit[] = [];
  // Store identities and content fingerprints, not the entire corpus. Read one source at a time.
  const images = await prisma.chartImage.findMany({ where: { ...(ids.images ? { id: { in: ids.images } } : {}), ...(ids.indexes ? { indexNodeId: { in: ids.indexes } } : {}) }, select: { id: true, title: true, originalName: true, indexNodeId: true }, orderBy: { id: "asc" } });
  const pageLength = Math.max(100, Math.min(4_000, Math.floor(inputBudget * 0.25)));
  function add(base: Omit<Unit, "offset" | "length" | "citation">, text: string) {
    const size = Array.from(text).length;
    for (let offset = 0; offset < size; offset += pageLength) units.push({ ...base, offset, length: Math.min(pageLength, size - offset), citation: `T${units.length + 1}` });
  }
  const relatedNodes = new Set(images.flatMap((image) => image.indexNodeId ? [image.indexNodeId] : []));
  if (scope.kind === "documents") {
    const bindings = knowledgeDb().prepare("SELECT indexNodeId FROM KnowledgeDocumentBinding WHERE documentId IN (SELECT value FROM json_each(?))").all(JSON.stringify(ids.documents)) as { indexNodeId: string | null }[];
    bindings.forEach((binding) => { if (binding.indexNodeId) relatedNodes.add(binding.indexNodeId); });
  }
  const nodes = await prisma.indexNode.findMany({ where: ids.indexes ? { id: { in: ids.indexes } } : ids.images !== null ? { id: { in: [...relatedNodes] } } : {}, select: { id: true, path: true }, orderBy: [{ path: "asc" }, { id: "asc" }] });
  for (const node of nodes) { signal.throwIfAborted(); const text = await indexText(node.id); add({ kind: "index", id: node.id, title: node.path, stamp: digest(text) }, text); }
  for (const image of images) { signal.throwIfAborted(); const text = await imageText(image.id); add({ kind: "image", id: image.id, title: image.title ?? image.originalName, stamp: digest(text) }, text); }
  const docs = (await taskDocuments()).filter((doc) => !ids.documents || ids.documents.includes(doc.id));
  for (const doc of docs) {
    signal.throwIfAborted();
    const rows = knowledgeDb().prepare("SELECT id FROM KnowledgeChunk WHERE versionId=? ORDER BY ordinal,id").all(doc.versionId) as { id: string }[];
    for (const row of rows) {
      await yieldToLoop(); signal.throwIfAborted(); const item = chunk(row.id); if (!item) throw new Error("source_changed");
      add({ kind: "knowledge", id: row.id, title: item.title, version: item.versionId, stamp: digest(JSON.stringify(item)), location: knowledgeLocatorLabel(parseKnowledgeLocator(item.locatorJson, { cueStart: item.sourceCueStart, cueEnd: item.sourceCueEnd, startMs: item.startMs, endMs: item.endMs })) }, item.cleanedText);
    }
  }
  return { scope, scopeLabel: `${ids.label}（${nodes.length} 个索引、${images.length} 张图片、${docs.length} 份知识资料）`, units, batches: units.map((_, index) => [index]) };
}
export async function readTaskUnit(unit: Unit, signal: AbortSignal): Promise<TaskSource> {
  signal.throwIfAborted(); let text: string;
  if (unit.kind === "index") { text = await indexText(unit.id); if (digest(text) !== unit.stamp) throw new Error("source_changed"); }
  else if (unit.kind === "image") { text = await imageText(unit.id); if (digest(text) !== unit.stamp) throw new Error("source_changed"); }
  else { const item = chunk(unit.id); if (!item || digest(JSON.stringify(item)) !== unit.stamp || !await prisma.indexNode.findUnique({ where: { id: item.indexNodeId }, select: { id: true } })) throw new Error("source_changed"); text = item.cleanedText; }
  signal.throwIfAborted();
  return { citation: unit.citation, kind: unit.kind, id: unit.id, title: unit.title, version: unit.version, location: unit.location, text: Array.from(text).slice(unit.offset, unit.offset + unit.length).join("") };
}
/** Recheck even completed sources on resume and before committing the final answer. */
export async function validateTaskManifest(manifest: TaskManifest, signal: AbortSignal) {
  const checked = new Set<string>();
  for (const unit of manifest.units) {
    const key = `${unit.kind}:${unit.id}`;
    if (checked.has(key)) continue;
    await readTaskUnit(unit, signal);
    checked.add(key);
  }
}
/** Task-only discovery tools. A frozen manifest limits execution reads to confirmed resources. */
export function createRobotTaskRegistry(manifest?: TaskManifest, options: Parameters<typeof createKnowledgeToolSession>[0] = {}) {
  const knowledge = createKnowledgeToolSession({ ...options, citations: false, allowedVersionIds: manifest ? [...new Set(manifest.units.filter((unit) => unit.kind === "knowledge").flatMap((unit) => unit.version ? [unit.version] : []))] : undefined });
  const page = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) };
  const listImages = defineAiTool({ name: "list_images", effect: "read", description: "List a bounded page of image IDs and names. Query is literal. No pixels or file paths.",
    parameters: z.strictObject({ query: z.string().max(200).default(""), ...page }),
    async execute(input, context) {
      context.signal.throwIfAborted();
      const allowed = manifest ? new Set(manifest.units.filter((unit) => unit.kind === "image").map((unit) => unit.id)) : null;
      const rows = await prisma.chartImage.findMany({ where: allowed ? { id: { in: [...allowed] } } : {}, select: { id: true, title: true, originalName: true, indexNodeId: true }, orderBy: { id: "asc" } });
      const filtered = rows.filter((row) => `${row.title ?? ""} ${row.originalName}`.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()));
      return { images: filtered.slice(input.offset, input.offset + input.limit), total: filtered.length, nextOffset: input.offset + input.limit < filtered.length ? input.offset + input.limit : null };
    }, summarize: (_input, output) => ({ itemCount: output.images.length, resourceIds: output.images.map((row) => row.id) }) });
  const read = defineAiTool({ name: "read_task_source", effect: "read", description: "Read one confirmed source page by its citation ID. Only available after the plan is confirmed.",
    parameters: z.strictObject({ citation: z.string().min(1).max(200) }),
    async execute(input, context) { const unit = manifest?.units.find((unit) => unit.citation === input.citation); if (!unit) throw new AiToolError("forbidden_resource", "Source is outside the confirmed task scope."); return readTaskUnit(unit, context.signal); }, summarize: (_input, output) => ({ itemCount: 1, resourceIds: [output.id] }) });
  return new AiToolRegistry([listImages, knowledge.registry.get("list_knowledge_documents")!, knowledge.registry.get("search_knowledge")!, read]);
}
