import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readStoredAiConfig } from "@/lib/ai-settings";
import { acquireHeavyTaskOrThrow, releaseHeavyTask } from "@/lib/background-task-coordinator";
import { knowledgeDb, getKnowledgeSourceRoot } from "@/lib/knowledge-db";
import {
  EMBEDDING_BATCH_SIZE,
  activeEmbeddingProfile,
  embedTexts,
  ensureEmbeddingProfile,
  storeChunkEmbeddings,
} from "@/lib/knowledge-embeddings";
import { expandKnowledgeKeywords, normalizeKnowledgeKeyword } from "@/lib/knowledge-keywords";
import {
  knowledgeTextForIndex,
  parseKnowledgeLocator,
  serializeKnowledgeLocator,
  sourceFormatForFileName,
} from "@/lib/knowledge-source";
import {
  createKnowledgeTextChunks,
  decodeKnowledgeText,
  KNOWLEDGE_TEXT_RULE_VERSION,
  parseKnowledgeText,
} from "@/lib/knowledge-text";
import {
  KNOWLEDGE_PROCESSING_RULE_VERSION,
  collapseRollingSubtitleCues,
  createDeterministicSegments,
  createSubtitleWindows,
  materializeChunk,
  processSubtitleWindow,
  subtitlePromptHash,
} from "@/lib/knowledge-processing";
import type {
  KnowledgeImportJobSnapshot,
  KnowledgeImportProcessingMode,
  KnowledgeProcessedSegment,
  KnowledgeSourceType,
} from "@/lib/knowledge-types";
import { parseSubtitle } from "@/lib/subtitle-parser";

const globalForKnowledgeImportJobs = globalThis as typeof globalThis & {
  brooksKnowledgeImportJobs?: Map<string, Promise<void>>;
};
const runningJobs = globalForKnowledgeImportJobs.brooksKnowledgeImportJobs ?? new Map<string, Promise<void>>();
globalForKnowledgeImportJobs.brooksKnowledgeImportJobs = runningJobs;
const supportedExtensions = new Set([".srt", ".vtt", ".ass", ".txt", ".md", ".markdown"]);
const subtitleExtensions = new Set([".srt", ".vtt", ".ass"]);

type ImportSource = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  sourceType: KnowledgeSourceType;
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
  sourceType: KnowledgeSourceType;
  targetIndexNodeId: string;
  targetIndexPath: string;
  documentId: string | null;
  versionId: string | null;
  status: string;
  phase: string;
  retryCount: number;
  error: string | null;
  errorPhase: string | null;
  progressCompleted: number;
  progressTotal: number;
  progressUnit: string | null;
  stageStartedAt: string | null;
  lastProgressAt: string | null;
  cacheHit: number;
};

type ProcessingIdentity = {
  mode: KnowledgeImportProcessingMode;
  ruleVersion: string;
  endpointId: string | null;
  model: string | null;
  promptHash: string | null;
};

export class KnowledgeSourceTypeConflictError extends Error {}

function nowSql() {
  return new Date().toISOString();
}

function setItemStage(
  itemId: string,
  phase: string,
  progressCompleted: number,
  progressTotal: number,
  progressUnit: string | null,
) {
  const db = knowledgeDb();
  const now = nowSql();
  db.transaction(() => {
    db.prepare(`UPDATE KnowledgeImportItem SET phase = ?, progressCompleted = ?, progressTotal = ?,
      progressUnit = ?, stageStartedAt = ?, lastProgressAt = ?, updatedAt = ? WHERE id = ?`)
      .run(phase, progressCompleted, progressTotal, progressUnit, now, now, now, itemId);
    db.prepare(`UPDATE KnowledgeImportJob SET phase = ?, updatedAt = ?
      WHERE id = (SELECT jobId FROM KnowledgeImportItem WHERE id = ?)`)
      .run(phase, now, itemId);
  })();
}

function updateItemProgress(itemId: string, completed: number, total: number) {
  const now = nowSql();
  knowledgeDb().prepare(`UPDATE KnowledgeImportItem SET progressCompleted = ?, progressTotal = ?,
    lastProgressAt = ?, updatedAt = ? WHERE id = ?`).run(completed, total, now, now, itemId);
}

function lessonCodeFromFile(fileName: string) {
  const stem = path.basename(fileName, path.extname(fileName)).normalize("NFKC").trim();
  return stem.match(/(?:^|[^a-z0-9])([0-9]{1,3}[a-z]?)(?:[^a-z0-9]|$)/i)?.[1]?.toUpperCase() ?? stem;
}

async function processingIdentity(mode: KnowledgeImportProcessingMode): Promise<ProcessingIdentity> {
  if (mode === "QUICK") return { mode, ruleVersion: KNOWLEDGE_PROCESSING_RULE_VERSION, endpointId: null, model: null, promptHash: null };
  const config = await readStoredAiConfig();
  const endpoint = config.endpoints.find((item) => item.id === config.activeEndpointId);
  const skill = config.skills.subtitleKnowledge;
  const model = skill.modelOverride || endpoint?.defaultModel || "";
  if (!endpoint || !model) throw new Error("AI 深度整理尚未配置可用的聊天模型，请改用快速导入或先完成大模型配置。");
  return { mode, ruleVersion: KNOWLEDGE_PROCESSING_RULE_VERSION, endpointId: endpoint.id, model, promptHash: subtitlePromptHash(skill.prompt, skill) };
}

export function assertKnowledgeImportLimits(sources: ImportSource[]) {
  if (sources.length < 1 || sources.length > 200) throw new Error("每批必须包含 1–200 个资料文件。");
  let total = 0;
  for (const source of sources) {
    if (!supportedExtensions.has(path.extname(source.fileName).toLowerCase())) {
      throw new Error(`不支持的资料格式：${source.fileName}`);
    }
    const extension = path.extname(source.fileName).toLowerCase();
    if (subtitleExtensions.has(extension) && source.sourceType !== "SUBTITLE") {
      throw new Error(`${source.fileName} 必须作为字幕资料导入。`);
    }
    if ([".md", ".markdown"].includes(extension) && source.sourceType === "SUBTITLE") {
      throw new Error(`${source.fileName} 不能作为字幕资料导入。`);
    }
    if (source.buffer.length > 10 * 1024 * 1024) throw new Error(`${source.fileName} 超过 10 MiB。`);
    total += source.buffer.length;
  }
  if (total > 100 * 1024 * 1024) throw new Error("本批资料总大小超过 100 MiB。");
}

export function assertKnowledgeImportMode(
  sources: Array<{ sourceType: KnowledgeSourceType }>,
  processingMode: KnowledgeImportProcessingMode,
) {
  if (processingMode !== "QUICK" && processingMode !== "AI") throw new Error("无效的字幕处理模式。");
  if (processingMode === "AI" && sources.some((source) => source.sourceType !== "SUBTITLE")) {
    throw new Error("AI 深度整理只适用于全部由字幕组成的导入批次。");
  }
}

async function saveSource(source: ImportSource) {
  const hash = createHash("sha256").update(source.buffer).digest("hex");
  const extension = path.extname(source.fileName).toLowerCase() || ".txt";
  await mkdir(/* turbopackIgnore: true */ getKnowledgeSourceRoot(), { recursive: true });
  const fullPath = path.join(/* turbopackIgnore: true */ getKnowledgeSourceRoot(), `${hash}${extension}`);
  try {
    await writeFile(/* turbopackIgnore: true */ fullPath, source.buffer, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  return { hash, sourcePath: path.relative(process.cwd(), fullPath).replace(/\\/g, "/") };
}

export async function createKnowledgeImportJob(
  sources: ImportSource[],
  manualReview: boolean,
  processingMode: KnowledgeImportProcessingMode = "QUICK",
) {
  assertKnowledgeImportLimits(sources);
  assertKnowledgeImportMode(sources, processingMode);
  if (processingMode === "AI") await processingIdentity(processingMode);
  const db = knowledgeDb();
  const active = db.prepare("SELECT id FROM KnowledgeImportJob WHERE activeKey = 'GLOBAL' LIMIT 1").get();
  if (active) throw new Error("已有知识导入任务正在运行，请等待完成。");
  if (db.prepare("SELECT id FROM KnowledgeMaintenanceJob WHERE activeKey = 'GLOBAL' LIMIT 1").get()) {
    throw new Error("知识库正在维护，请等待完成后再导入。");
  }
  const typeByTargetNode = new Map<string, KnowledgeSourceType>();
  for (const source of sources) {
    const batchType = typeByTargetNode.get(source.targetIndexNodeId);
    if (batchType && batchType !== source.sourceType) {
      throw new KnowledgeSourceTypeConflictError("同一导入批次不能向同一索引节点导入不同类型的资料。");
    }
    typeByTargetNode.set(source.targetIndexNodeId, source.sourceType);
    const occupied = db.prepare(`SELECT d.sourceType FROM KnowledgeDocumentBinding b
      JOIN KnowledgeDocument d ON d.id = b.documentId WHERE b.indexNodeId = ? LIMIT 1`)
      .get(source.targetIndexNodeId) as { sourceType: KnowledgeSourceType } | undefined;
    if (occupied && occupied.sourceType !== source.sourceType) {
      throw new KnowledgeSourceTypeConflictError(
        `目标索引已关联 ${occupied.sourceType} 资料，不能导入 ${source.sourceType}。`,
      );
    }
  }
  const jobId = randomUUID();
  acquireHeavyTaskOrThrow("knowledge-import", jobId);
  try {
    const prepared: Array<{ source: ImportSource; hash: string; sourcePath: string }> = [];
    for (const source of sources) prepared.push({ source, ...await saveSource(source) });
    db.transaction(() => {
      db.prepare(`INSERT INTO KnowledgeImportJob
        (id, activeKey, status, phase, manualReview, processingMode, totalItems)
        VALUES (?, 'GLOBAL', 'RUNNING', 'QUEUED', ?, ?, ?)`)
        .run(jobId, manualReview ? 1 : 0, processingMode, prepared.length);
      const insert = db.prepare(`INSERT INTO KnowledgeImportItem
        (id, jobId, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath,
         sourceType, targetIndexNodeId, targetIndexPath)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const entry of prepared) {
        insert.run(
          randomUUID(), jobId, entry.source.fileName, entry.source.mimeType || "text/plain",
          entry.source.buffer.length, entry.hash, entry.sourcePath,
          entry.source.sourceType, entry.source.targetIndexNodeId, entry.source.targetIndexPath,
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
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("资料源文件路径越界。");
  return full;
}

function prepareDocumentAndVersion(
  item: ItemRow,
  rawText: string,
  manualReview: boolean,
  identity: ProcessingIdentity,
) {
  const db = knowledgeDb();
  return db.transaction(() => {
    let document = db.prepare(`SELECT d.id, d.sourceType
      FROM KnowledgeDocumentBinding b
      JOIN KnowledgeDocument d ON d.id = b.documentId
      WHERE b.indexNodeId = ? LIMIT 1`)
      .get(item.targetIndexNodeId) as { id: string; sourceType: KnowledgeSourceType } | undefined;
    if (document && document.sourceType !== item.sourceType) {
      throw new KnowledgeSourceTypeConflictError(
        `目标索引已关联 ${document.sourceType} 资料，不能导入 ${item.sourceType}。`,
      );
    }
    if (!document) {
      document = { id: randomUUID(), sourceType: item.sourceType };
      const lessonCode = item.sourceType === "SUBTITLE" ? lessonCodeFromFile(item.sourceFileName) : null;
      db.prepare(`INSERT INTO KnowledgeDocument
        (id, title, lessonCode, normalizedLessonCode, sourceType, enabled)
        VALUES (?, ?, ?, ?, ?, 1)`)
        .run(document.id, path.basename(item.sourceFileName, path.extname(item.sourceFileName)), lessonCode,
          lessonCode ? normalizeKnowledgeKeyword(lessonCode) : null, item.sourceType);
      db.prepare(`INSERT INTO KnowledgeDocumentBinding
        (id, documentId, indexNodeId, indexPathSnapshot, appliesToDescendants, status)
        VALUES (?, ?, ?, ?, 1, 'ACTIVE')`)
        .run(randomUUID(), document.id, item.targetIndexNodeId, item.targetIndexPath);
    } else {
      db.prepare(`UPDATE KnowledgeDocumentBinding SET indexPathSnapshot = ?, status = 'ACTIVE', updatedAt = ?
        WHERE documentId = ?`).run(item.targetIndexPath, nowSql(), document.id);
    }
    const row = db.prepare("SELECT COALESCE(MAX(versionNumber), 0) + 1 AS nextVersion FROM KnowledgeDocumentVersion WHERE documentId = ?")
      .get(document.id) as { nextVersion: number };
    const versionId = randomUUID();
    db.prepare(`INSERT INTO KnowledgeDocumentVersion
      (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash,
       sourcePath, rawText, status, approvalMode, processingMode, processingRuleVersion, sourceFormat,
       processorEndpointId, processorModel, processorPromptHash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?, ?, ?, ?, ?, ?)`)
      .run(versionId, document.id, row.nextVersion, item.sourceFileName, item.sourceMimeType,
        item.sourceSizeBytes, item.sourceHash, item.sourcePath, rawText, manualReview ? "MANUAL" : "AUTO",
        identity.mode, identity.ruleVersion, sourceFormatForFileName(item.sourceFileName),
        identity.endpointId, identity.model, identity.promptHash);
    db.prepare("UPDATE KnowledgeImportItem SET documentId = ?, versionId = ?, phase = 'PARSED', updatedAt = ? WHERE id = ?")
      .run(document.id, versionId, nowSql(), item.id);
    return { documentId: document.id, versionId };
  })();
}

function reuseProcessedVersion(item: ItemRow, identity: ProcessingIdentity) {
  if (!item.versionId) return false;
  const db = knowledgeDb();
  const cached = db.prepare(`SELECT v.id FROM KnowledgeDocumentVersion v
    WHERE v.id <> ? AND v.sourceHash = ? AND v.processingMode = ? AND v.processingRuleVersion = ?
      AND COALESCE(v.processorModel, '') = COALESCE(?, '')
      AND COALESCE(v.processorPromptHash, '') = COALESCE(?, '')
      AND v.status IN ('ACTIVE', 'INACTIVE', 'AWAITING_REVIEW')
      AND EXISTS (SELECT 1 FROM KnowledgeChunk c WHERE c.versionId = v.id)
    ORDER BY v.createdAt DESC LIMIT 1`).get(
    item.versionId,
    item.sourceHash,
    identity.mode,
    identity.ruleVersion,
    identity.model,
    identity.promptHash,
  ) as { id: string } | undefined;
  if (!cached) return false;
  const chunks = db.prepare(`SELECT id, ordinal, sourceCueStart, sourceCueEnd, startMs, endMs,
    originalText, cleanedText, topic, keywordsJson, locatorKind, locatorJson FROM KnowledgeChunk
    WHERE versionId = ? ORDER BY ordinal`).all(cached.id) as Array<Record<string, unknown>>;
  const insertChunk = db.prepare(`INSERT INTO KnowledgeChunk
    (id, versionId, ordinal, sourceCueStart, sourceCueEnd, startMs, endMs, originalText, cleanedText,
     topic, keywordsJson, locatorKind, locatorJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertKeyword = db.prepare(`INSERT OR IGNORE INTO KnowledgeChunkKeyword
    (chunkId, keyword, normalizedKeyword) VALUES (?, ?, ?)`);
  const insertEmbedding = db.prepare(`INSERT OR REPLACE INTO KnowledgeChunkEmbedding
    (chunkId, profileId, embedding) VALUES (?, ?, ?)`);
  db.transaction(() => {
    db.prepare("DELETE FROM KnowledgeChunk WHERE versionId = ?").run(item.versionId);
    for (const chunk of chunks) {
      const chunkId = randomUUID();
      insertChunk.run(chunkId, item.versionId, chunk.ordinal, chunk.sourceCueStart, chunk.sourceCueEnd,
        chunk.startMs, chunk.endMs, chunk.originalText, chunk.cleanedText, chunk.topic, chunk.keywordsJson,
        chunk.locatorKind, chunk.locatorJson);
      const keywords = db.prepare("SELECT keyword, normalizedKeyword FROM KnowledgeChunkKeyword WHERE chunkId = ?")
        .all(chunk.id) as Array<{ keyword: string; normalizedKeyword: string }>;
      for (const keyword of keywords) insertKeyword.run(chunkId, keyword.keyword, keyword.normalizedKeyword);
      const embeddings = db.prepare("SELECT profileId, embedding FROM KnowledgeChunkEmbedding WHERE chunkId = ?")
        .all(chunk.id) as Array<{ profileId: string; embedding: Buffer }>;
      for (const embedding of embeddings) insertEmbedding.run(chunkId, embedding.profileId, embedding.embedding);
    }
    db.prepare(`UPDATE KnowledgeDocumentVersion SET cacheSourceVersionId = ?, updatedAt = ? WHERE id = ?`)
      .run(cached.id, nowSql(), item.versionId);
    db.prepare("UPDATE KnowledgeImportItem SET cacheHit = 1, updatedAt = ? WHERE id = ?")
      .run(nowSql(), item.id);
  })();
  return true;
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
      const startedAt = nowSql();
      db.prepare(`UPDATE KnowledgeProcessingWindow SET status = 'RUNNING', error = NULL, retryCount = 0,
        startedAt = ?, finishedAt = NULL, updatedAt = ? WHERE itemId = ? AND ordinal = ?`)
        .run(startedAt, startedAt, item.id, ordinal);
      const result = await processSubtitleWindow(config, windows[ordinal], {
        onAttempt: (attempt) => {
          const now = nowSql();
          db.transaction(() => {
            db.prepare(`UPDATE KnowledgeProcessingWindow SET status = 'RUNNING', retryCount = ?,
              startedAt = ?, updatedAt = ? WHERE itemId = ? AND ordinal = ?`)
              .run(attempt - 1, now, now, item.id, ordinal);
            db.prepare(`UPDATE KnowledgeImportItem SET lastProgressAt = ?, updatedAt = ? WHERE id = ?`)
              .run(now, now, item.id);
          })();
        },
        onResponse: ({ raw, inputTokens, outputTokens }) => {
          const now = nowSql();
          db.prepare(`UPDATE KnowledgeProcessingWindow SET responsePreview = ?, inputTokens = ?, outputTokens = ?,
            updatedAt = ? WHERE itemId = ? AND ordinal = ?`)
            .run(raw.slice(0, 32_000), inputTokens, outputTokens, now, item.id, ordinal);
        },
      });
      const finishedAt = nowSql();
      db.prepare(`UPDATE KnowledgeProcessingWindow
        SET outputJson = ?, status = 'COMPLETED', retryCount = ?, inputTokens = ?, outputTokens = ?,
          error = NULL, finishedAt = ?, updatedAt = ?
        WHERE itemId = ? AND ordinal = ?`)
        .run(JSON.stringify(result.segments), result.attempts - 1, result.inputTokens, result.outputTokens,
          finishedAt, finishedAt, item.id, ordinal);
      db.prepare(`UPDATE KnowledgeDocumentVersion SET processorEndpointId = ?,
        processorPromptHash = ?, updatedAt = ? WHERE id = ?`)
        .run(result.endpointId, result.promptHash, finishedAt, item.versionId);
      const completed = db.prepare(`SELECT COUNT(*) AS count FROM KnowledgeProcessingWindow
        WHERE itemId = ? AND status = 'COMPLETED'`).get(item.id) as { count: number };
      updateItemProgress(item.id, completed.count, windows.length);
    } catch (error) {
      const failedAt = nowSql();
      db.prepare(`UPDATE KnowledgeProcessingWindow SET status = 'FAILED', error = ?,
        finishedAt = ?, updatedAt = ?
        WHERE itemId = ? AND ordinal = ?`)
        .run(error instanceof Error ? error.message : String(error), failedAt, failedAt, item.id, ordinal);
      db.prepare("UPDATE KnowledgeImportItem SET lastProgressAt = ?, updatedAt = ? WHERE id = ?")
        .run(failedAt, failedAt, item.id);
      throw error;
    }
  }
}

function persistChunks(
  item: ItemRow,
  chunks: Array<{
    sourceCueStart: number; sourceCueEnd: number; startMs: number | null; endMs: number | null;
    originalText: string; cleanedText: string; topic: string; keywords: string[];
    locatorKind: "SUBTITLE" | "TEXT"; locator: Parameters<typeof serializeKnowledgeLocator>[0];
  }>,
) {
  const db = knowledgeDb();
  db.transaction(() => {
    db.prepare("DELETE FROM KnowledgeChunk WHERE versionId = ?").run(item.versionId);
    const insertChunk = db.prepare(`INSERT INTO KnowledgeChunk
      (id, versionId, ordinal, sourceCueStart, sourceCueEnd, startMs, endMs, originalText, cleanedText,
       topic, keywordsJson, locatorKind, locatorJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertKeyword = db.prepare(`INSERT OR IGNORE INTO KnowledgeChunkKeyword
      (chunkId, keyword, normalizedKeyword) VALUES (?, ?, ?)`);
    chunks.forEach((chunk, ordinal) => {
      const chunkId = randomUUID();
      insertChunk.run(chunkId, item.versionId, ordinal, chunk.sourceCueStart, chunk.sourceCueEnd,
        chunk.startMs, chunk.endMs, chunk.originalText, chunk.cleanedText, chunk.topic,
        JSON.stringify(chunk.keywords), chunk.locatorKind, serializeKnowledgeLocator(chunk.locator));
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

function insertSubtitleChunks(
  item: ItemRow,
  cues: ReturnType<typeof parseSubtitle>,
  preparedSegments?: KnowledgeProcessedSegment[],
) {
  const db = knowledgeDb();
  const outputs = preparedSegments ? [] : db.prepare(`SELECT outputJson FROM KnowledgeProcessingWindow
    WHERE itemId = ? ORDER BY ordinal`).all(item.id) as Array<{ outputJson: string }>;
  const segments = preparedSegments
    ?? outputs.flatMap((row) => JSON.parse(row.outputJson) as KnowledgeProcessedSegment[]);
  const chunks = segments.map((segment) => materializeChunk(cues, segment));
  return persistChunks(item, chunks);
}

async function createVectorsAndIndex(item: ItemRow) {
  const db = knowledgeDb();
  const chunks = db.prepare(`SELECT id, cleanedText, locatorJson, sourceCueStart, sourceCueEnd, startMs, endMs
    FROM KnowledgeChunk WHERE versionId = ? ORDER BY ordinal`)
    .all(item.versionId) as Array<{
      id: string; cleanedText: string; locatorJson: string; sourceCueStart: number; sourceCueEnd: number;
      startMs: number | null; endMs: number | null;
    }>;
  const indexedTexts = chunks.map((chunk) => knowledgeTextForIndex(parseKnowledgeLocator(chunk.locatorJson, {
    cueStart: chunk.sourceCueStart, cueEnd: chunk.sourceCueEnd, startMs: chunk.startMs, endMs: chunk.endMs,
  }), chunk.cleanedText));
  const config = await readStoredAiConfig();
  const configuredEmbedding = config.embeddingEndpoints.find((endpoint) => endpoint.id === config.activeEmbeddingEndpointId);
  const profile = activeEmbeddingProfile();
  const reusableVectorCount = profile && configuredEmbedding
    && profile.endpointId === configuredEmbedding.id && profile.model === configuredEmbedding.embeddingModel
    ? (db.prepare(`SELECT COUNT(*) AS count FROM KnowledgeChunkEmbedding e
        JOIN KnowledgeChunk c ON c.id = e.chunkId WHERE c.versionId = ? AND e.profileId = ?`)
        .get(item.versionId, profile.id) as { count: number }).count
    : 0;
  if (reusableVectorCount === chunks.length && chunks.length > 0) {
    setItemStage(item.id, "EMBEDDING", 1, 1, "cached");
  } else {
    const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);
    setItemStage(item.id, "EMBEDDING", 0, totalBatches, "batches");
    const embedded = await embedTexts(indexedTexts, {
      onBatchCompleted: (completed, total) => updateItemProgress(item.id, completed, total),
    });
    const targetProfile = ensureEmbeddingProfile(embedded.endpointId, embedded.model, embedded.vectors[0]?.length ?? 0);
    storeChunkEmbeddings(chunks.map((chunk, index) => ({ chunkId: chunk.id, vector: embedded.vectors[index] })), targetProfile.id);
  }
  const version = db.prepare(`SELECT v.documentId, d.title, d.lessonCode FROM KnowledgeDocumentVersion v
    JOIN KnowledgeDocument d ON d.id = v.documentId WHERE v.id = ?`).get(item.versionId) as {
      documentId: string; title: string; lessonCode: string | null;
    };
  const rows = db.prepare(`SELECT id, topic, keywordsJson, cleanedText, locatorJson,
    sourceCueStart, sourceCueEnd, startMs, endMs FROM KnowledgeChunk
    WHERE versionId = ? ORDER BY ordinal`).all(item.versionId) as Array<Record<string, string | number | null>>;
  setItemStage(item.id, "FTS_INDEXING", 0, 1, "steps");
  db.transaction(() => {
    db.prepare("DELETE FROM KnowledgeChunkFts WHERE versionId = ?").run(item.versionId);
    const insert = db.prepare(`INSERT INTO KnowledgeChunkFts
      (chunkId, documentId, versionId, title, lessonCode, topic, keywords, cleanedText)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of rows) {
      const locator = parseKnowledgeLocator(String(row.locatorJson), {
        cueStart: Number(row.sourceCueStart), cueEnd: Number(row.sourceCueEnd),
        startMs: row.startMs === null ? null : Number(row.startMs), endMs: row.endMs === null ? null : Number(row.endMs),
      });
      insert.run(row.id, version.documentId, item.versionId, version.title,
        version.lessonCode ?? "", row.topic, (JSON.parse(String(row.keywordsJson)) as string[]).join(" "),
        knowledgeTextForIndex(locator, String(row.cleanedText)));
    }
  })();
  updateItemProgress(item.id, 1, 1);
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

async function processItem(
  itemId: string,
  manualReview: boolean,
  processingMode: KnowledgeImportProcessingMode,
) {
  const db = knowledgeDb();
  let item = db.prepare("SELECT * FROM KnowledgeImportItem WHERE id = ?").get(itemId) as ItemRow;
  db.prepare("UPDATE KnowledgeImportItem SET status = 'RUNNING', error = NULL, errorPhase = NULL, updatedAt = ? WHERE id = ?")
    .run(nowSql(), itemId);
  if (item.versionId) {
    db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'PROCESSING', error = NULL, updatedAt = ? WHERE id = ?")
      .run(nowSql(), item.versionId);
  }
  setItemStage(itemId, "READING_SOURCE", 0, 1, "steps");
  const buffer = await readFile(/* turbopackIgnore: true */ resolveSourcePath(item.sourcePath));
  const isSubtitle = item.sourceType === "SUBTITLE";
  const sourceFormat = sourceFormatForFileName(item.sourceFileName);
  const rawText = (isSubtitle ? buffer.toString("utf8") : decodeKnowledgeText(buffer))
    .replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cues = isSubtitle ? collapseRollingSubtitleCues(parseSubtitle(buffer, item.sourceFileName)) : null;
  updateItemProgress(itemId, 1, 1);
  const identity = isSubtitle
    ? await processingIdentity(processingMode)
    : { mode: "QUICK" as const, ruleVersion: `${KNOWLEDGE_TEXT_RULE_VERSION}:${sourceFormat}`, endpointId: null, model: null, promptHash: null };
  if (!item.versionId) prepareDocumentAndVersion(item, rawText, manualReview, identity);
  item = db.prepare("SELECT * FROM KnowledgeImportItem WHERE id = ?").get(itemId) as ItemRow;
  const cacheHit = reuseProcessedVersion(item, identity);
  if (!cacheHit) {
    if (isSubtitle && processingMode === "AI") {
      if (!cues) throw new Error("字幕解析结果不存在。");
      const windows = createSubtitleWindows(cues);
      persistWindows(item.id, windows);
      const completedWindows = db.prepare(`SELECT COUNT(*) AS count FROM KnowledgeProcessingWindow
        WHERE itemId = ? AND status = 'COMPLETED'`).get(item.id) as { count: number };
      setItemStage(item.id, "AI_PROCESSING", completedWindows.count, windows.length, "windows");
      await processWindows(item, windows);
      setItemStage(item.id, "CHUNKING", 0, 1, "steps");
      insertSubtitleChunks(item, cues);
    } else if (isSubtitle) {
      if (!cues) throw new Error("字幕解析结果不存在。");
      setItemStage(item.id, "DETERMINISTIC_CHUNKING", 0, 1, "steps");
      insertSubtitleChunks(item, cues, createDeterministicSegments(cues));
    } else {
      setItemStage(item.id, "DETERMINISTIC_CHUNKING", 0, 1, "steps");
      persistChunks(item, createKnowledgeTextChunks(parseKnowledgeText(buffer, sourceFormat === "MARKDOWN")));
    }
    updateItemProgress(item.id, 1, 1);
  } else {
    setItemStage(item.id, "CACHE_REUSE", 1, 1, "steps");
  }
  await createVectorsAndIndex(item);
  if (manualReview) {
    setItemStage(item.id, "AWAITING_REVIEW", 1, 1, "steps");
    db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'AWAITING_REVIEW', updatedAt = ? WHERE id = ?")
      .run(nowSql(), item.versionId);
    db.prepare(`UPDATE KnowledgeImportItem SET status = 'AWAITING_REVIEW', phase = 'AWAITING_REVIEW',
      error = NULL, errorPhase = NULL, updatedAt = ? WHERE id = ?`)
      .run(nowSql(), item.id);
  } else {
    setItemStage(item.id, "ACTIVATING", 0, 1, "steps");
    activateVersion(item.versionId!);
    const completedAt = nowSql();
    db.prepare(`UPDATE KnowledgeImportItem SET status = 'COMPLETED', phase = 'COMPLETED',
      error = NULL, errorPhase = NULL, progressCompleted = 1, progressTotal = 1,
      progressUnit = 'steps', lastProgressAt = ?, updatedAt = ? WHERE id = ?`)
      .run(completedAt, completedAt, item.id);
  }
}

async function runKnowledgeImportJob(jobId: string) {
  const db = knowledgeDb();
  const job = db.prepare("SELECT manualReview, processingMode FROM KnowledgeImportJob WHERE id = ?").get(jobId) as {
    manualReview: number;
    processingMode: KnowledgeImportProcessingMode;
  } | undefined;
  if (!job) return;
  const items = db.prepare(`SELECT id FROM KnowledgeImportItem WHERE jobId = ?
    AND status IN ('PENDING', 'RUNNING') ORDER BY createdAt`).all(jobId) as Array<{ id: string }>;
  for (const { id } of items) {
    try {
      await processItem(id, Boolean(job.manualReview), job.processingMode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const item = db.prepare("SELECT versionId, phase FROM KnowledgeImportItem WHERE id = ?").get(id) as { versionId: string | null; phase: string };
      db.transaction(() => {
        db.prepare("UPDATE KnowledgeImportItem SET status = 'FAILED', phase = 'FAILED', error = ?, errorPhase = ?, updatedAt = ? WHERE id = ?")
          .run(message, item.phase, nowSql(), id);
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
  const items = db.prepare("SELECT * FROM KnowledgeImportItem WHERE jobId = ? ORDER BY sourceFileName, id")
    .all(jobId) as ItemRow[];
  const windows = db.prepare(`SELECT w.itemId, w.ordinal, w.status, w.retryCount, w.inputTokens, w.outputTokens,
    w.inputJson, w.responsePreview, w.startedAt, w.finishedAt, w.updatedAt
    FROM KnowledgeProcessingWindow w JOIN KnowledgeImportItem i ON i.id = w.itemId
    WHERE i.jobId = ? ORDER BY w.itemId, w.ordinal`).all(jobId) as Array<{
      itemId: string;
      ordinal: number;
      status: string;
      retryCount: number;
      inputTokens: number;
      outputTokens: number;
      inputJson: string;
      responsePreview: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      updatedAt: string;
    }>;
  const windowsByItem = new Map<string, typeof windows>();
  for (const window of windows) {
    const list = windowsByItem.get(window.itemId) ?? [];
    list.push(window);
    windowsByItem.set(window.itemId, list);
  }
  return {
    id: String(job.id), status: String(job.status), phase: String(job.phase),
    manualReview: Boolean(job.manualReview), processingMode: String(job.processingMode) as KnowledgeImportProcessingMode,
    totalItems: Number(job.totalItems),
    processedItems: Number(job.processedItems), completedItems: Number(job.completedItems),
    failedItems: Number(job.failedItems), error: job.error ? String(job.error) : null,
    items: items.map((item) => {
      const itemWindows = windowsByItem.get(item.id) ?? [];
      const currentWindow = itemWindows.find((window) => window.status === "RUNNING")
        ?? (item.phase === "AI_PROCESSING"
          ? itemWindows.find((window) => window.status !== "COMPLETED")
          : undefined);
      const diagnosticWindow = currentWindow
        ?? [...itemWindows].reverse().find((window) => window.status === "FAILED");
      const inputTokens = itemWindows.reduce((sum, window) => sum + Number(window.inputTokens || 0), 0);
      const outputTokens = itemWindows.reduce((sum, window) => sum + Number(window.outputTokens || 0), 0);
      return {
        id: item.id, sourceFileName: item.sourceFileName, sourceType: item.sourceType,
        targetIndexNodeId: item.targetIndexNodeId, targetIndexPath: item.targetIndexPath,
        documentId: item.documentId, versionId: item.versionId, status: item.status,
        phase: item.phase, retryCount: item.retryCount, error: item.error,
        errorPhase: item.errorPhase,
        progressCompleted: item.progressCompleted, progressTotal: item.progressTotal,
        progressUnit: item.progressUnit, stageStartedAt: item.stageStartedAt,
        lastProgressAt: item.lastProgressAt,
        currentWindow: currentWindow ? currentWindow.ordinal + 1 : null,
        currentAttempt: diagnosticWindow ? diagnosticWindow.retryCount + 1 : null,
        maxAttempts: diagnosticWindow ? 2 : null,
        inputTokens,
        outputTokens,
        cacheHit: Boolean(item.cacheHit),
        diagnosticInput: diagnosticWindow?.inputJson ?? null,
        diagnosticOutput: diagnosticWindow?.responsePreview ?? null,
      };
    }),
  };
}

export function decideKnowledgeImportItem(itemId: string, decision: "approve" | "reject" | "retry") {
  const db = knowledgeDb();
  const item = db.prepare("SELECT * FROM KnowledgeImportItem WHERE id = ?").get(itemId) as ItemRow | undefined;
  if (!item) throw new Error("Knowledge import item not found.");
  if (decision === "approve") {
    if (item.status !== "AWAITING_REVIEW" || !item.versionId) throw new Error("This item is not awaiting review.");
    activateVersion(item.versionId);
    const completedAt = nowSql();
    db.prepare(`UPDATE KnowledgeImportItem SET status = 'COMPLETED', phase = 'COMPLETED',
      error = NULL, errorPhase = NULL, progressCompleted = 1, progressTotal = 1,
      progressUnit = 'steps', lastProgressAt = ?, updatedAt = ? WHERE id = ?`)
      .run(completedAt, completedAt, item.id);
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
        error = NULL, errorPhase = NULL, progressCompleted = 0, progressTotal = 0, progressUnit = NULL,
        stageStartedAt = NULL, cacheHit = 0, lastProgressAt = ?, updatedAt = ? WHERE id = ?`).run(nowSql(), nowSql(), item.id);
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
