import { knowledgeDb, vectorBuffer } from "@/lib/knowledge-db";
import { prisma } from "@/lib/db";
import { parseKnowledgeLocator } from "@/lib/knowledge-source";
import type { KnowledgeSource } from "@/lib/knowledge-types";
import { isRelevantKnowledgeVector } from "@/lib/knowledge-relevance";

export const knowledgeJoins = `JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
  JOIN KnowledgeDocument d ON d.id = v.documentId AND d.enabled = 1
  JOIN KnowledgeDocumentBinding b ON b.documentId = d.id AND b.status = 'ACTIVE' AND b.indexNodeId IS NOT NULL`;

/** Resolve actual main-database nodes before applying channel limits. */
export async function validKnowledgeDocumentIds(db = knowledgeDb()) {
  const nodes = new Set((await prisma.indexNode.findMany({ select: { id: true } })).map((node) => node.id));
  const bindings = db.prepare(`SELECT d.id, b.indexNodeId FROM KnowledgeDocument d
    JOIN KnowledgeDocumentVersion v ON v.documentId=d.id AND v.status='ACTIVE'
    JOIN KnowledgeDocumentBinding b ON b.documentId=d.id AND b.status='ACTIVE'
    WHERE d.enabled=1 AND b.indexNodeId IS NOT NULL`).all() as { id: string; indexNodeId: string }[];
  return bindings.filter((row) => nodes.has(row.indexNodeId)).map((row) => row.id);
}

export function sourceFromRow(row: CandidateRow, current: ReadonlySet<string>, score = 0): KnowledgeSource {
  return {
    id: row.id, documentId: row.documentId, versionId: row.versionId, versionNumber: row.versionNumber,
    title: row.title, lessonCode: row.lessonCode, sourceType: row.sourceType, sourceFormat: row.sourceFormat,
    locator: parseKnowledgeLocator(row.locatorJson, { cueStart: row.sourceCueStart, cueEnd: row.sourceCueEnd, startMs: row.startMs, endMs: row.endMs }),
    indexNodeId: row.indexNodeId, indexPath: row.indexPathSnapshot, startMs: row.startMs, endMs: row.endMs,
    text: row.cleanedText, topic: row.topic, keywords: JSON.parse(row.keywordsJson),
    scope: current.has(row.documentId) ? "current" : "related", citation: "", score,
  };
}

export function rankKnowledgeCandidates(channels: Ranked[], current: ReadonlySet<string>, boost = 1.35) {
  const merged = new Map<string, { row: CandidateRow; score: number }>();
  for (const row of channels) {
    const entry = merged.get(row.id) ?? { row, score: 0 };
    entry.score += (current.has(row.documentId) ? boost : 1) / (60 + row.rank);
    merged.set(row.id, entry);
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
}

/** Literal fallback also handles short terms absent from the trigram FTS. */
export function literalCandidates(query: string, documentIds: string[], limit: number, db = knowledgeDb(), textLimit?: number): Ranked[] {
  return (db.prepare(`${baseSelect(textLimit)} FROM KnowledgeChunk c ${knowledgeJoins}
    WHERE d.id IN (SELECT value FROM json_each(?)) AND instr(lower(c.cleanedText),lower(?))>0
    ORDER BY c.id LIMIT ?`).all(JSON.stringify(documentIds), query, limit) as CandidateRow[])
    .map((row, index) => ({ ...row, rank: index + 1, channel: "literal" }));
}

export type CandidateRow = {
  id: string;
  documentId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  lessonCode: string | null;
  sourceType: KnowledgeSource["sourceType"];
  sourceFormat: KnowledgeSource["sourceFormat"];
  indexNodeId: string | null;
  indexPathSnapshot: string;
  startMs: number | null;
  endMs: number | null;
  cleanedText: string;
  topic: string;
  keywordsJson: string;
  locatorJson: string;
  sourceCueStart: number;
  sourceCueEnd: number;
  ordinal: number;
  totalCharacters: number;
};

export type Ranked = CandidateRow & { rank: number; channel: string; distance?: number };

export function buildKnowledgeFtsQuery(value: string) {
  const normalized = value.normalize("NFKC");
  const terms: string[] = [];
  for (const token of normalized.match(/[\p{Script=Han}]+|[A-Za-z0-9]{3,}/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length < 3) continue;
      for (let index = 0; index <= token.length - 3; index += 1) terms.push(token.slice(index, index + 3));
    } else {
      terms.push(token);
    }
    if (terms.length >= 18) break;
  }
  return [...new Set(terms.slice(0, 18))].map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

export function baseSelect(textLimit?: number) {
  const text = textLimit === undefined ? "c.cleanedText" : `substr(c.cleanedText, 1, ${Math.max(1, Math.floor(textLimit))})`;
  return `SELECT c.id, v.documentId, v.id AS versionId, v.versionNumber, d.title, d.lessonCode, d.sourceType,
    v.sourceFormat, b.indexNodeId, b.indexPathSnapshot, c.startMs, c.endMs, ${text} AS cleanedText, c.ordinal, length(c.cleanedText) AS totalCharacters,
    c.topic, c.keywordsJson, c.locatorJson, c.sourceCueStart, c.sourceCueEnd`;
}

export function ftsCandidates(query: string, documentIds: string[] | null, channel: string, limit = 30, db = knowledgeDb(), textLimit?: number): Ranked[] {
  const expression = buildKnowledgeFtsQuery(query);
  if (!expression) return [];
  const scope = documentIds ? ` AND d.id IN (SELECT value FROM json_each(?))` : "";
  const rows = db.prepare(`${baseSelect(textLimit)}, bm25(KnowledgeChunkFts) AS relevance
    FROM KnowledgeChunkFts
    JOIN KnowledgeChunk c ON c.id = KnowledgeChunkFts.chunkId
    JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
    JOIN KnowledgeDocument d ON d.id = v.documentId AND d.enabled = 1
    JOIN KnowledgeDocumentBinding b ON b.documentId = d.id AND b.status = 'ACTIVE' AND b.indexNodeId IS NOT NULL
    WHERE KnowledgeChunkFts MATCH ?${scope}
    ORDER BY relevance, c.id LIMIT ?`).all(expression, ...(documentIds === null ? [] : [JSON.stringify(documentIds)]), limit) as Array<CandidateRow & { relevance: number }>;
  return rows.map((row, index) => ({ ...row, rank: index + 1, channel }));
}

export function keywordCandidates(query: string, documentIds: string[] | null, channel: string, limit = 30, db = knowledgeDb(), textLimit?: number): Ranked[] {
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase();
  const scope = documentIds ? ` AND d.id IN (SELECT value FROM json_each(?))` : "";
  const rows = db.prepare(`${baseSelect(textLimit)}, k.normalizedKeyword
    FROM KnowledgeChunkKeyword k
    JOIN KnowledgeChunk c ON c.id = k.chunkId
    JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
    JOIN KnowledgeDocument d ON d.id = v.documentId AND d.enabled = 1
    JOIN KnowledgeDocumentBinding b ON b.documentId = d.id AND b.status = 'ACTIVE' AND b.indexNodeId IS NOT NULL
    WHERE instr(?, k.normalizedKeyword) > 0${scope}
    GROUP BY c.id ORDER BY length(k.normalizedKeyword) DESC, c.id LIMIT ?`)
    .all(normalizedQuery, ...(documentIds === null ? [] : [JSON.stringify(documentIds)]), limit) as CandidateRow[];
  return rows.map((row, index) => ({ ...row, rank: index + 1, channel }));
}

export function vectorCandidates(vector: number[], profileId: string, documentIds: string[] | null, channel: string, limit = 30, db = knowledgeDb(), textLimit?: number): Ranked[] {
  const scope = documentIds ? ` AND d.id IN (SELECT value FROM json_each(?))` : "";
  const rows = db.prepare(`${baseSelect(textLimit)}, vec_distance_cosine(e.embedding, ?) AS distance
    FROM KnowledgeChunkEmbedding e
    JOIN KnowledgeChunk c ON c.id = e.chunkId
    JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
    JOIN KnowledgeDocument d ON d.id = v.documentId AND d.enabled = 1
    JOIN KnowledgeDocumentBinding b ON b.documentId = d.id AND b.status = 'ACTIVE' AND b.indexNodeId IS NOT NULL
    WHERE e.profileId = ?${scope}
    ORDER BY distance, c.id LIMIT ?`).all(vectorBuffer(vector), profileId, ...(documentIds === null ? [] : [JSON.stringify(documentIds)]), limit) as Array<CandidateRow & { distance: number }>;
  return rows.filter((row) => isRelevantKnowledgeVector(row.distance))
    .map((row, index) => ({ ...row, rank: index + 1, channel }));
}

