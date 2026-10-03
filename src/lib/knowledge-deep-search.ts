import { setImmediate as yieldToLoop } from "node:timers/promises";
import { knowledgeDb, vectorBuffer } from "@/lib/knowledge-db";
import { activeEmbeddingProfile, embedTexts } from "@/lib/knowledge-embeddings";
import { buildKnowledgeFtsQuery } from "@/lib/knowledge-search";
import { parseKnowledgeLocator } from "@/lib/knowledge-source";
import type { KnowledgeSource } from "@/lib/knowledge-types";
import { isRelevantKnowledgeVector, knowledgeSubjectQuery } from "@/lib/knowledge-relevance";

export type KnowledgeDocumentDescriptor = {
  id: string;
  versionId: string;
  title: string;
  lessonCode: string | null;
  sourceType: KnowledgeSource["sourceType"];
  indexPath: string;
  chunkCount: number;
  headings: string[][];
};
export type KnowledgeScopeTarget = { documentId: string; headingPath: string[] };
export type DeepKnowledgeCandidate = KnowledgeSource & { queryIndexes: number[] };
type Row = {
  id: string; documentId: string; versionId: string; versionNumber: number; title: string; lessonCode: string | null;
  sourceType: KnowledgeSource["sourceType"]; sourceFormat: KnowledgeSource["sourceFormat"];
  indexNodeId: string; indexPath: string; startMs: number | null; endMs: number | null;
  cleanedText: string; topic: string; keywordsJson: string; locatorJson: string;
  sourceCueStart: number; sourceCueEnd: number;
};
const select = `SELECT c.id, d.id AS documentId, v.id AS versionId, v.versionNumber, d.title, d.lessonCode,
  d.sourceType, v.sourceFormat, b.indexNodeId, b.indexPathSnapshot AS indexPath,
  c.startMs, c.endMs, c.cleanedText, c.topic, c.keywordsJson, c.locatorJson, c.sourceCueStart, c.sourceCueEnd`;
const joins = `JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
  JOIN KnowledgeDocument d ON d.id = v.documentId AND d.enabled = 1
  JOIN KnowledgeDocumentBinding b ON b.documentId = d.id AND b.status = 'ACTIVE' AND b.indexNodeId IS NOT NULL`;

function toSource(row: Row, currentIds: Set<string>, score = 0): KnowledgeSource {
  return {
    id: row.id, documentId: row.documentId, versionId: row.versionId, versionNumber: row.versionNumber, title: row.title,
    lessonCode: row.lessonCode, sourceType: row.sourceType, sourceFormat: row.sourceFormat,
    locator: parseKnowledgeLocator(row.locatorJson, {
      cueStart: row.sourceCueStart, cueEnd: row.sourceCueEnd, startMs: row.startMs, endMs: row.endMs,
    }),
    indexNodeId: row.indexNodeId, indexPath: row.indexPath, startMs: row.startMs, endMs: row.endMs,
    text: row.cleanedText, topic: row.topic, keywords: JSON.parse(row.keywordsJson),
    scope: currentIds.has(row.documentId) ? "current" : "related", citation: "", score,
  };
}

export function listDeepKnowledgeDocuments(db = knowledgeDb()): KnowledgeDocumentDescriptor[] {
  const docs = db.prepare(`SELECT d.id, v.id AS versionId, d.title, d.lessonCode, d.sourceType,
    b.indexPathSnapshot AS indexPath, COUNT(c.id) AS chunkCount
    FROM KnowledgeDocument d
    JOIN KnowledgeDocumentVersion v ON v.documentId = d.id AND v.status = 'ACTIVE'
    JOIN KnowledgeDocumentBinding b ON b.documentId = d.id AND b.status = 'ACTIVE' AND b.indexNodeId IS NOT NULL
    JOIN KnowledgeChunk c ON c.versionId = v.id WHERE d.enabled = 1
    GROUP BY d.id ORDER BY b.indexPathSnapshot, d.title`).all() as Omit<KnowledgeDocumentDescriptor, "headings">[];
  const headings = db.prepare(`SELECT DISTINCT v.documentId, json_extract(c.locatorJson, '$.headingPath') AS path
    FROM KnowledgeChunk c ${joins}
    WHERE json_valid(c.locatorJson) AND json_extract(c.locatorJson, '$.kind') = 'text'`).all() as Array<{ documentId: string; path: string | null }>;
  const byDocument = new Map<string, string[][]>();
  for (const heading of headings) {
    const parsed = heading.path ? JSON.parse(heading.path) : [];
    if (Array.isArray(parsed) && parsed.length) {
      const paths = byDocument.get(heading.documentId) ?? [];
      paths.push(parsed);
      byDocument.set(heading.documentId, paths);
    }
  }
  return docs.map((doc) => ({ ...doc, headings: byDocument.get(doc.id) ?? [] }));
}

export async function retrieveDeepKnowledgeCandidates(options: {
  queries: string[]; currentIds: string[]; targets: KnowledgeScopeTarget[]; signal: AbortSignal;
  onQuery?: (completed: number, total: number) => void;
  db?: ReturnType<typeof knowledgeDb>;
}): Promise<{ candidates: DeepKnowledgeCandidate[]; semanticSearchUsed: boolean }> {
  const db = options.db ?? knowledgeDb();
  const currentIds = new Set(options.currentIds);
  const targetIds = [...new Set(options.targets.map((target) => target.documentId))];
  const otherCurrentIds = options.currentIds.filter((id) => !targetIds.includes(id));
  const queries = options.queries.map(knowledgeSubjectQuery);
  const semanticQueryIndexes = queries.flatMap((query, index) => query ? [index] : []);
  const profile = activeEmbeddingProfile(db);
  const vectors: number[][] = [];
  if (profile && semanticQueryIndexes.length) {
    try {
      const result = await embedTexts(semanticQueryIndexes.map((index) => queries[index]), { signal: options.signal });
      if (result.endpointId === profile.endpointId && result.model === profile.model
        && result.vectors.every((vector) => vector.length === profile.dimensions)) {
        result.vectors.forEach((vector, index) => { vectors[semanticQueryIndexes[index]] = vector; });
      }
    } catch { options.signal.throwIfAborted(); }
  }
  const merged = new Map<string, DeepKnowledgeCandidate>();
  for (const [queryIndex, query] of queries.entries()) {
    options.signal.throwIfAborted();
    if (!query) { options.onQuery?.(queryIndex + 1, queries.length); continue; }
    const scopes: Array<string[] | null> = [
      ...targetIds.map((id) => [id]), ...(otherCurrentIds.length ? [otherCurrentIds] : []), null,
    ];
    for (const [scopeIndex, ids] of scopes.entries()) {
      // Divide each channel's 50 slots between named materials, the current scope,
      // and the whole library. This keeps coverage without multiplying the recall cap.
      const limit = Math.floor(50 / scopes.length) + (scopeIndex < 50 % scopes.length ? 1 : 0);
      const scope = ids ? ` AND d.id IN (${ids.map(() => "?").join(",")})` : "";
      const add = (rows: Row[]) => rows.forEach((row, rank) => {
        const candidate = merged.get(row.id) ?? { ...toSource(row, currentIds), queryIndexes: [] };
        candidate.score += (currentIds.has(row.documentId) ? 1.15 : 1) / (61 + rank);
        if (!candidate.queryIndexes.includes(queryIndex)) candidate.queryIndexes.push(queryIndex);
        merged.set(row.id, candidate);
      });
      const expression = buildKnowledgeFtsQuery(query);
      if (expression) add(db.prepare(`${select} FROM KnowledgeChunkFts f
        JOIN KnowledgeChunk c ON c.id = f.chunkId ${joins}
        WHERE KnowledgeChunkFts MATCH ?${scope} ORDER BY bm25(KnowledgeChunkFts), c.id LIMIT ?`)
        .all(expression, ...(ids ?? []), limit) as Row[]);
      add(db.prepare(`${select} FROM KnowledgeChunkKeyword k JOIN KnowledgeChunk c ON c.id = k.chunkId ${joins}
        WHERE instr(?, k.normalizedKeyword) > 0${scope}
        GROUP BY c.id ORDER BY MAX(length(k.normalizedKeyword)) DESC, c.id LIMIT ?`)
        .all(query.normalize("NFKC").toLowerCase(), ...(ids ?? []), limit) as Row[]);
      if (vectors[queryIndex] && profile) add((db.prepare(`${select}, vec_distance_cosine(e.embedding, ?) AS distance FROM KnowledgeChunkEmbedding e
        JOIN KnowledgeChunk c ON c.id = e.chunkId ${joins}
        WHERE e.profileId = ?${scope} ORDER BY distance, c.id LIMIT ?`)
        .all(vectorBuffer(vectors[queryIndex]), profile.id, ...(ids ?? []), limit) as Array<Row & { distance: number }>)
        .filter((row) => isRelevantKnowledgeVector(row.distance)));
      await yieldToLoop();
      options.signal.throwIfAborted();
    }
    options.onQuery?.(queryIndex + 1, options.queries.length);
  }
  return { candidates: [...merged.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)), semanticSearchUsed: vectors.length > 0 };
}

function scopeFilter(targets: KnowledgeScopeTarget[]) {
  const values: string[] = [];
  const conditions = targets.map((target) => {
    values.push(target.documentId);
    const headings = target.headingPath.map((heading, index) => {
      values.push(heading);
      return `json_extract(c.locatorJson, '$.headingPath[${index}]') = ? COLLATE NOCASE`;
    });
    return `(d.id = ?${headings.length ? ` AND json_valid(c.locatorJson) AND ${headings.join(" AND ")}` : ""})`;
  });
  return { expression: conditions.length ? conditions.join(" OR ") : "0", values };
}

export function countKnowledgeScope(targets: KnowledgeScopeTarget[], db = knowledgeDb()) {
  const scope = scopeFilter(targets);
  return db.prepare(`SELECT d.id AS documentId, v.id AS versionId, d.title, COUNT(c.id) AS availableChunks
    FROM KnowledgeChunk c ${joins} WHERE ${scope.expression} GROUP BY d.id, v.id ORDER BY d.id`)
    .all(...scope.values) as Array<{ documentId: string; versionId: string; title: string; availableChunks: number }>;
}

export async function* readKnowledgeScope(targets: KnowledgeScopeTarget[], currentIds: string[], signal: AbortSignal, db = knowledgeDb()) {
  const scope = scopeFilter(targets);
  const statement = db.prepare(`${select} FROM KnowledgeChunk c ${joins}
    WHERE ${scope.expression} ORDER BY c.ordinal, d.id, c.id LIMIT 100 OFFSET ?`);
  const current = new Set(currentIds);
  for (let offset = 0; ; offset += 100) {
    signal.throwIfAborted();
    const rows = statement.all(...scope.values, offset) as Row[];
    for (const row of rows) {
      signal.throwIfAborted();
      yield toSource(row, current);
    }
    if (rows.length < 100) return;
    await yieldToLoop();
  }
}
