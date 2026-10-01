import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readStoredAiConfig } from "@/lib/ai-settings";
import { acquireHeavyTaskOrThrow, releaseHeavyTask } from "@/lib/background-task-coordinator";
import { knowledgeDb, getKnowledgeSourceRoot } from "@/lib/knowledge-db";
import { embedTexts, ensureEmbeddingProfile, storeChunkEmbeddings } from "@/lib/knowledge-embeddings";
import { expandKnowledgeKeywords, normalizeKnowledgeKeyword } from "@/lib/knowledge-keywords";
import {
  createSubtitleWindows,
  materializeChunk,
  processSubtitleWindow,
} from "@/lib/knowledge-processing";
import type { KnowledgeImportJobSnapshot, KnowledgeProcessedSegment } from "@/lib/knowledge-types";
import { parseSubtitle } from "@/lib/subtitle-parser";

const runningJobs = new Map<string, Promise<void>>();
const supportedExtensions = new Set([".srt", ".vtt", ".ass", ".txt"]);

type ImportSource = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  targetIndexNodeId: string;
  targetIndexPath: string;
};

type ItemRow = {
  id: string;
  jobId: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceSizeBytes: number;
  sourceHash: string;
  sourcePath: string;
  targetIndexNodeId: string;
  targetIndexPath: string;
  documentId: string | null;
  versionId: string | null;
  status: string;
  phase: string;
  retryCount: number;
  error: string | null;
};

function nowSql() {
  return new Date().toISOString();
}

function lessonCodeFromFile(fileName: string) {
  const stem = path.basename(fileName, path.extname(fileName)).normalize("NFKC").trim();
  return stem.match(/(?:^|[^a-z0-9])([0-9]{1,3}[a-z]?)(?:[^a-z0-9]|$)/i)?.[1]?.toUpperCase() ?? stem;
}

export function assertKnowledgeImportLimits(sources: ImportSource[]) {
  if (sources.length < 1 || sources.length > 200) throw new Error("每批必须包含 1–200 个字幕文件。");
  let total = 0;
  for (const source of sources) {
    if (!supportedExtensions.has(path.extname(source.fileName).toLowerCase())) {
      throw new Error(`不支持的字幕格式：${source.fileName}`);
    }
    if (source.buffer.length > 10 * 1024 * 1024) throw new Error(`${source.fileName} 超过 10 MiB。`);
    total += source.buffer.length;
  }
  if (total > 100 * 1024 * 1024) throw new Error("本批字幕总大小超过 100 MiB。");
}

async function saveSource(source: ImportSource) {
  const hash = createHash("sha256").update(source.buffer).digest("hex");
  const extension = path.extname(source.fileName).toLowerCase() || ".txt";
  await mkdir(getKnowledgeSourceRoot(), { recursive: true });
  const fullPath = path.join(/* turbopackIgnore: true */ getKnowledgeSourceRoot(), `${hash}${extension}`);
  try {
    await writeFile(fullPath, source.buffer, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  return { hash, sourcePath: path.relative(process.cwd(), fullPath).replace(/\\/g, "/") };
}

export async function createKnowledgeImportJob(sources: ImportSource[], manualReview: boolean) {
  assertKnowledgeImportLimits(sources);
  const db = knowledgeDb();
  const active = db.prepare("SELECT id FROM KnowledgeImportJob WHERE activeKey = 'GLOBAL' LIMIT 1").get();
  if (active) throw new Error("已有知识导入任务正在运行，请等待完成。");
  if (db.prepare("SELECT id FROM KnowledgeMaintenanceJob WHERE activeKey = 'GLOBAL' LIMIT 1").get()) {
    throw new Error("知识库正在维护，请等待完成后再导入。");
  }
  const jobId = randomUUID();
  acquireHeavyTaskOrThrow("knowledge-import", jobId);
  try {
    const prepared: Array<{ source: ImportSource; hash: string; sourcePath: string }> = [];
    for (const source of sources) prepared.push({ source, ...await saveSource(source) });
    db.transaction(() => {
      db.prepare(`INSERT INTO KnowledgeImportJob
        (id, activeKey, status, phase, manualReview, totalItems)
        VALUES (?, 'GLOBAL', 'RUNNING', 'QUEUED', ?, ?)`)
        .run(jobId, manualReview ? 1 : 0, prepared.length);
      const insert = db.prepare(`INSERT INTO KnowledgeImportItem
        (id, jobId, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath,
         targetIndexNodeId, targetIndexPath)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const entry of prepared) {
        insert.run(
          randomUUID(), jobId, entry.source.fileName, entry.source.mimeType || "text/plain",
          entry.source.buffer.length, entry.hash, entry.sourcePath,
          entry.source.targetIndexNodeId, entry.source.targetIndexPath,
        );
      }
    })();
  } catch (error) {
    releaseHeavyTask("knowledge-import", jobId);
    throw error;
  }
  startKnowledgeImportJob(jobId);
  return knowledgeImportJobSnapshot(jobId);
}

function resolveSourcePath(sourcePath: string) {
  const full = path.resolve(/* turbopackIgnore: true */ process.cwd(), sourcePath);
  const root = path.resolve(getKnowledgeSourceRoot());
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("字幕源文件路径越界。");
  return full;
}

function prepareDocumentAndVersion(item: ItemRow, rawText: string, manualReview: boolean) {
  const db = knowledgeDb();
  return db.transaction(() => {
    let document = db.prepare("SELECT id FROM KnowledgeDocument WHERE indexNodeId = ? LIMIT 1")
      .get(item.targetIndexNodeId) as { id: string } | undefined;
    if (!document) {
      document = { id: randomUUID() };
      const lessonCode = lessonCodeFromFile(item.sourceFileName);
      db.prepare(`INSERT INTO KnowledgeDocument
        (id, title, lessonCode, normalizedLessonCode, indexNodeId, indexPathSnapshot)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(document.id, path.basename(item.sourceFileName, path.extname(item.sourceFileName)), lessonCode,
          normalizeKnowledgeKeyword(lessonCode), item.targetIndexNodeId, item.targetIndexPath);
    } else {
      db.prepare("UPDATE KnowledgeDocument SET indexPathSnapshot = ?, bindingStatus = 'ACTIVE', updatedAt = ? WHERE id = ?")
        .run(item.targetIndexPath, nowSql(), document.id);
    }
    const row = db.prepare("SELECT COALESCE(MAX(versionNumber), 0) + 1 AS nextVersion FROM KnowledgeDocumentVersion WHERE documentId = ?")
      .get(document.id) as { nextVersion: number };
    const versionId = randomUUID();
    db.prepare(`INSERT INTO KnowledgeDocumentVersion
      (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash,
       sourcePath, rawText, status, approvalMode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?)`)
      .run(versionId, document.id, row.nextVersion, item.sourceFileName, item.sourceMimeType,
        item.sourceSizeBytes, item.sourceHash, item.sourcePath, rawText, manualReview ? "MANUAL" : "AUTO");
    db.prepare("UPDATE KnowledgeImportItem SET documentId = ?, versionId = ?, phase = 'PARSED', updatedAt = ? WHERE id = ?")
      .run(document.id, versionId, nowSql(), item.id);
    return { documentId: document.id, versionId };
  })();
}

function persistWindows(itemId: string, windows: ReturnType<typeof createSubtitleWindows>) {
  const db = knowledgeDb();
  const insert = db.prepare(`INSERT OR IGNORE INTO KnowledgeProcessingWindow
    (id, itemId, ordinal, cueStart, cueEnd, inputJson)
    VALUES (?, ?, ?, ?, ?, ?)`);
  db.transaction(() => windows.forEach((window, ordinal) => insert.run(
    randomUUID(), itemId, ordinal, window[0].id, window.at(-1)!.id, JSON.stringify(window),
  )))();
}

async function processWindows(item: ItemRow, windows: ReturnType<typeof createSubtitleWindows>) {
  const db = knowledgeDb();
  const config = await readStoredAiConfig();
  for (let ordinal = 0; ordinal < windows.length; ordinal += 1) {
    const stored = db.prepare("SELECT status FROM KnowledgeProcessingWindow WHERE itemId = ? AND ordinal = ?")
      .get(item.id, ordinal) as { status: string };
    if (stored.status === "COMPLETED") continue;
    try {
      const result = await processSubtitleWindow(config, windows[ordinal]);
      db.prepare(`UPDATE KnowledgeProcessingWindow
        SET outputJson = ?, status = 'COMPLETED', retryCount = ?, error = NULL, updatedAt = ?
        WHERE itemId = ? AND ordinal = ?`)
        .run(JSON.stringify(result.segments), result.attempts - 1, nowSql(), item.id, ordinal);
      db.prepare(`UPDATE KnowledgeDocumentVersion SET processorEndpointId = ?, processorModel = ?,
        processorPromptHash = ?, updatedAt = ? WHERE id = ?`)
        .run(result.endpointId, result.model, result.promptHash, nowSql(), item.versionId);
    } catch (error) {
      db.prepare(`UPDATE KnowledgeProcessingWindow SET status = 'FAILED', retryCount = 1, error = ?, updatedAt = ?
        WHERE itemId = ? AND ordinal = ?`)
        .run(error instanceof Error ? error.message : String(error), nowSql(), item.id, ordinal);
      throw error;
    }
  }
}

function insertChunks(item: ItemRow, cues: ReturnType<typeof parseSubtitle>) {
  const db = knowledgeDb();
  const outputs = db.prepare(`SELECT outputJson FROM KnowledgeProcessingWindow
    WHERE itemId = ? ORDER BY ordinal`).all(item.id) as Array<{ outputJson: string }>;
  const segments = outputs.flatMap((row) => JSON.parse(row.outputJson) as KnowledgeProcessedSegment[]);
  const chunks = segments.map((segment) => materializeChunk(cues, segment));
  db.transaction(() => {
    db.prepare("DELETE FROM KnowledgeChunk WHERE versionId = ?").run(item.versionId);
    const insertChunk = db.prepare(`INSERT INTO KnowledgeChunk
      (id, versionId, ordinal, sourceCueStart, sourceCueEnd, startMs, endMs, originalText, cleanedText, topic, keywordsJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertKeyword = db.prepare(`INSERT OR IGNORE INTO KnowledgeChunkKeyword
      (chunkId, keyword, normalizedKeyword) VALUES (?, ?, ?)`);
    chunks.forEach((chunk, ordinal) => {
      const chunkId = randomUUID();
      insertChunk.run(chunkId, item.versionId, ordinal, chunk.sourceCueStart, chunk.sourceCueEnd,
        chunk.startMs, chunk.endMs, chunk.originalText, chunk.cleanedText, chunk.topic,
        JSON.stringify(chunk.keywords));
      const exactTerms = new Set(chunk.keywords);
      for (const match of chunk.cleanedText.matchAll(/\b[A-Za-z][A-Za-z0-9]{0,9}\b/g)) {
        if (match[0].length <= 5) exactTerms.add(match[0]);
      }
      for (const keyword of expandKnowledgeKeywords(exactTerms)) {
        insertKeyword.run(chunkId, keyword.keyword, keyword.normalizedKeyword);
      }
    });
  })();
  return chunks.length;
}

async function createVectorsAndIndex(item: ItemRow) {
  const db = knowledgeDb();
  const chunks = db.prepare(`SELECT id, cleanedText FROM KnowledgeChunk WHERE versionId = ? ORDER BY ordinal`)
    .all(item.versionId) as Array<{ id: string; cleanedText: string }>;
  const embedded = await embedTexts(chunks.map((chunk) => chunk.cleanedText));
  const profile = ensureEmbeddingProfile(embedded.endpointId, embedded.model, embedded.vectors[0]?.length ?? 0);
  storeChunkEmbeddings(chunks.map((chunk, index) => ({ chunkId: chunk.id, vector: embedded.vectors[index] })), profile.id);
  const version = db.prepare(`SELECT v.documentId, d.title, d.lessonCode FROM KnowledgeDocumentVersion v
    JOIN KnowledgeDocument d ON d.id = v.documentId WHERE v.id = ?`).get(item.versionId) as {
      documentId: string; title: string; lessonCode: string | null;
    };
  const rows = db.prepare(`SELECT id, topic, keywordsJson, cleanedText FROM KnowledgeChunk
    WHERE versionId = ? ORDER BY ordinal`).all(item.versionId) as Array<Record<string, string>>;
  db.transaction(() => {
    db.prepare("DELETE FROM KnowledgeChunkFts WHERE versionId = ?").run(item.versionId);
    const insert = db.prepare(`INSERT INTO KnowledgeChunkFts
      (chunkId, documentId, versionId, title, lessonCode, topic, keywords, cleanedText)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of rows) insert.run(row.id, version.documentId, item.versionId, version.title,
      version.lessonCode ?? "", row.topic, (JSON.parse(row.keywordsJson) as string[]).join(" "), row.cleanedText);
  })();
}

function activateVersion(versionId: string) {
  const db = knowledgeDb();
  db.transaction(() => {
    const row = db.prepare("SELECT documentId FROM KnowledgeDocumentVersion WHERE id = ?").get(versionId) as { documentId: string } | undefined;
    if (!row) throw new Error("Knowledge version not found.");
    db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'INACTIVE', updatedAt = ? WHERE documentId = ? AND status = 'ACTIVE'")
      .run(nowSql(), row.documentId);
    db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'ACTIVE', error = NULL, activatedAt = ?, updatedAt = ? WHERE id = ?")
      .run(nowSql(), nowSql(), versionId);
  })();
}

async function processItem(itemId: string, manualReview: boolean) {
  const db = knowledgeDb();
  let item = db.prepare("SELECT * FROM KnowledgeImportItem WHERE id = ?").get(itemId) as ItemRow;
  db.prepare("UPDATE KnowledgeImportItem SET status = 'RUNNING', phase = 'READING_SOURCE', error = NULL, updatedAt = ? WHERE id = ?")
    .run(nowSql(), itemId);
  const buffer = await readFile(resolveSourcePath(item.sourcePath));
  const rawText = buffer.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cues = parseSubtitle(buffer, item.sourceFileName);
  if (!item.versionId) prepareDocumentAndVersion(item, rawText, manualReview);
  item = db.prepare("SELECT * FROM KnowledgeImportItem WHERE id = ?").get(itemId) as ItemRow;
  const windows = createSubtitleWindows(cues);
  persistWindows(item.id, windows);
  db.prepare("UPDATE KnowledgeImportItem SET phase = 'AI_PROCESSING', updatedAt = ? WHERE id = ?").run(nowSql(), item.id);
  await processWindows(item, windows);
  db.prepare("UPDATE KnowledgeImportItem SET phase = 'INDEXING', updatedAt = ? WHERE id = ?").run(nowSql(), item.id);
  insertChunks(item, cues);
  await createVectorsAndIndex(item);
  if (manualReview) {
    db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'AWAITING_REVIEW', updatedAt = ? WHERE id = ?")
      .run(nowSql(), item.versionId);
    db.prepare("UPDATE KnowledgeImportItem SET status = 'AWAITING_REVIEW', phase = 'AWAITING_REVIEW', updatedAt = ? WHERE id = ?")
      .run(nowSql(), item.id);
  } else {
    activateVersion(item.versionId!);
    db.prepare("UPDATE KnowledgeImportItem SET status = 'COMPLETED', phase = 'COMPLETED', updatedAt = ? WHERE id = ?")
      .run(nowSql(), item.id);
  }
}

async function runKnowledgeImportJob(jobId: string) {
  const db = knowledgeDb();
  const job = db.prepare("SELECT manualReview FROM KnowledgeImportJob WHERE id = ?").get(jobId) as { manualReview: number } | undefined;
  if (!job) return;
  const items = db.prepare(`SELECT id FROM KnowledgeImportItem WHERE jobId = ?
    AND status IN ('PENDING', 'RUNNING') ORDER BY createdAt`).all(jobId) as Array<{ id: string }>;
  for (const { id } of items) {
    try {
      await processItem(id, Boolean(job.manualReview));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const item = db.prepare("SELECT versionId FROM KnowledgeImportItem WHERE id = ?").get(id) as { versionId: string | null };
      db.transaction(() => {
        db.prepare("UPDATE KnowledgeImportItem SET status = 'FAILED', phase = 'FAILED', error = ?, updatedAt = ? WHERE id = ?")
          .run(message, nowSql(), id);
        if (item.versionId) db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'FAILED', error = ?, updatedAt = ? WHERE id = ?")
          .run(message, nowSql(), item.versionId);
      })();
    }
    updateJobCounts(jobId);
  }
  finishJob(jobId);
}

function updateJobCounts(jobId: string) {
  const db = knowledgeDb();
  const counts = db.prepare(`SELECT
    SUM(CASE WHEN status NOT IN ('PENDING', 'RUNNING') THEN 1 ELSE 0 END) AS processed,
    SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
    FROM KnowledgeImportItem WHERE jobId = ?`).get(jobId) as Record<string, number | null>;
  db.prepare(`UPDATE KnowledgeImportJob SET processedItems = ?, completedItems = ?, failedItems = ?, updatedAt = ? WHERE id = ?`)
    .run(counts.processed ?? 0, counts.completed ?? 0, counts.failed ?? 0, nowSql(), jobId);
}

function finishJob(jobId: string) {
  const db = knowledgeDb();
  updateJobCounts(jobId);
  const states = db.prepare("SELECT status FROM KnowledgeImportItem WHERE jobId = ?").all(jobId) as Array<{ status: string }>;
  const awaiting = states.some((row) => row.status === "AWAITING_REVIEW");
  const failed = states.some((row) => row.status === "FAILED");
  const status = awaiting ? "AWAITING_REVIEW" : failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  db.prepare(`UPDATE KnowledgeImportJob SET activeKey = NULL, status = ?, phase = ?, finishedAt = ?, updatedAt = ? WHERE id = ?`)
    .run(status, status, nowSql(), nowSql(), jobId);
}

export function startKnowledgeImportJob(jobId: string) {
  if (runningJobs.has(jobId)) return;
  acquireHeavyTaskOrThrow("knowledge-import", jobId);
  const promise = runKnowledgeImportJob(jobId).finally(() => {
    runningJobs.delete(jobId);
    releaseHeavyTask("knowledge-import", jobId);
  });
  runningJobs.set(jobId, promise);
}

export function knowledgeImportJobSnapshot(jobId: string): KnowledgeImportJobSnapshot | null {
  const db = knowledgeDb();
  const job = db.prepare("SELECT * FROM KnowledgeImportJob WHERE id = ?").get(jobId) as Record<string, unknown> | undefined;
  if (!job) return null;
  const items = db.prepare("SELECT * FROM KnowledgeImportItem WHERE jobId = ? ORDER BY createdAt")
    .all(jobId) as ItemRow[];
  return {
    id: String(job.id), status: String(job.status), phase: String(job.phase),
    manualReview: Boolean(job.manualReview), totalItems: Number(job.totalItems),
    processedItems: Number(job.processedItems), completedItems: Number(job.completedItems),
    failedItems: Number(job.failedItems), error: job.error ? String(job.error) : null,
    items: items.map((item) => ({
      id: item.id, sourceFileName: item.sourceFileName,
      targetIndexNodeId: item.targetIndexNodeId, targetIndexPath: item.targetIndexPath,
      documentId: item.documentId, versionId: item.versionId, status: item.status,
      phase: item.phase, retryCount: item.retryCount, error: item.error,
    })),
  };
}

export function decideKnowledgeImportItem(itemId: string, decision: "approve" | "reject" | "retry") {
  const db = knowledgeDb();
  const item = db.prepare("SELECT * FROM KnowledgeImportItem WHERE id = ?").get(itemId) as ItemRow | undefined;
  if (!item) throw new Error("Knowledge import item not found.");
  if (decision === "approve") {
    if (item.status !== "AWAITING_REVIEW" || !item.versionId) throw new Error("This item is not awaiting review.");
    activateVersion(item.versionId);
    db.prepare("UPDATE KnowledgeImportItem SET status = 'COMPLETED', phase = 'COMPLETED', updatedAt = ? WHERE id = ?")
      .run(nowSql(), item.id);
  } else if (decision === "reject") {
    if (item.status !== "AWAITING_REVIEW" || !item.versionId) throw new Error("This item is not awaiting review.");
    db.transaction(() => {
      db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'REJECTED', updatedAt = ? WHERE id = ?").run(nowSql(), item.versionId);
      db.prepare("UPDATE KnowledgeImportItem SET status = 'REJECTED', phase = 'REJECTED', updatedAt = ? WHERE id = ?")
        .run(nowSql(), item.id);
    })();
  } else {
    if (item.status !== "FAILED") throw new Error("Only failed items can be retried.");
    acquireHeavyTaskOrThrow("knowledge-import", item.jobId);
    try {
      db.prepare(`UPDATE KnowledgeImportItem SET status = 'PENDING', phase = 'QUEUED', retryCount = retryCount + 1,
        error = NULL, updatedAt = ? WHERE id = ?`).run(nowSql(), item.id);
      db.prepare("UPDATE KnowledgeImportJob SET activeKey = 'GLOBAL', status = 'RUNNING', phase = 'QUEUED', finishedAt = NULL, updatedAt = ? WHERE id = ?")
        .run(nowSql(), item.jobId);
      startKnowledgeImportJob(item.jobId);
    } catch (error) {
      releaseHeavyTask("knowledge-import", item.jobId);
      throw error;
    }
  }
  updateJobCounts(item.jobId);
  if (decision !== "retry") finishJob(item.jobId);
  return knowledgeImportJobSnapshot(item.jobId);
}

export function resumeInterruptedKnowledgeImports() {
  const rows = knowledgeDb().prepare("SELECT id FROM KnowledgeImportJob WHERE activeKey = 'GLOBAL'").all() as Array<{ id: string }>;
  for (const row of rows) {
    try { startKnowledgeImportJob(row.id); } catch { break; }
  }
}
