import type { TextKnowledgeLocator } from "@/lib/knowledge-types";

export const KNOWLEDGE_TEXT_RULE_VERSION = "text-v1-heading-lines";
export const KNOWLEDGE_TEXT_TARGET_CHARACTERS = 1_000;
export const KNOWLEDGE_TEXT_MAX_CHARACTERS = 1_600;

export type KnowledgeTextBlock = {
  text: string;
  lineStart: number;
  lineEnd: number;
  headingPath: string[];
};

export type KnowledgeTextChunk = {
  sourceCueStart: number;
  sourceCueEnd: number;
  startMs: null;
  endMs: null;
  originalText: string;
  cleanedText: string;
  topic: string;
  keywords: string[];
  locatorKind: "TEXT";
  locator: TextKnowledgeLocator;
};

export function decodeKnowledgeText(input: Buffer | string) {
  if (typeof input === "string") return input;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new Error("资料文件必须使用有效的 UTF-8 编码。");
  }
}

function normalizedSource(input: Buffer | string) {
  const text = decodeKnowledgeText(input).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new Error("资料文件为空。");
  return text;
}

function updateHeadingPath(path: string[], level: number, title: string) {
  const next = path.slice(0, level - 1);
  next[level - 1] = title.trim();
  return next.filter(Boolean);
}

export function parseKnowledgeText(input: Buffer | string, markdown: boolean): KnowledgeTextBlock[] {
  const lines = normalizedSource(input).split("\n");
  const blocks: KnowledgeTextBlock[] = [];
  let headingPath: string[] = [];
  let paragraph: string[] = [];
  let paragraphStart = 0;
  let inFence = false;

  const flush = (lineEnd: number) => {
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ text, lineStart: paragraphStart + 1, lineEnd, headingPath: [...headingPath] });
    paragraph = [];
    paragraphStart = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const fence = markdown && /^(```|~~~)/.test(trimmed);
    if (fence) {
      if (!paragraph.length) paragraphStart = index;
      paragraph.push(line);
      inFence = !inFence;
      continue;
    }
    if (markdown && !inFence) {
      const atx = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (atx) {
        flush(index);
        headingPath = updateHeadingPath(headingPath, atx[1].length, atx[2]);
        continue;
      }
      const setext = index + 1 < lines.length && trimmed
        ? lines[index + 1].trim().match(/^(=+|-+)$/)
        : null;
      if (setext) {
        flush(index);
        headingPath = updateHeadingPath(headingPath, setext[1].startsWith("=") ? 1 : 2, trimmed);
        index += 1;
        continue;
      }
    }
    if (!trimmed && !inFence) {
      flush(index);
      continue;
    }
    if (!paragraph.length) paragraphStart = index;
    paragraph.push(line);
  }
  flush(lines.length);
  if (!blocks.length) throw new Error("资料文件中没有可导入的正文。");
  return blocks;
}

function splitLongBlock(block: KnowledgeTextBlock) {
  const result: KnowledgeTextBlock[] = [];
  let rest = block.text;
  while (rest.length > KNOWLEDGE_TEXT_MAX_CHARACTERS) {
    const window = rest.slice(0, KNOWLEDGE_TEXT_MAX_CHARACTERS + 1);
    const sentenceBreaks = [...window.matchAll(/[。！？.!?]\s*/g)]
      .map((match) => (match.index ?? 0) + match[0].length)
      .filter((position) => position >= KNOWLEDGE_TEXT_TARGET_CHARACTERS);
    const whitespace = window.lastIndexOf(" ", KNOWLEDGE_TEXT_MAX_CHARACTERS);
    const boundary = sentenceBreaks.at(-1)
      ?? (whitespace >= KNOWLEDGE_TEXT_TARGET_CHARACTERS ? whitespace + 1 : KNOWLEDGE_TEXT_MAX_CHARACTERS);
    result.push({ ...block, text: rest.slice(0, boundary).trimEnd() });
    rest = rest.slice(boundary).trimStart();
  }
  if (rest) result.push({ ...block, text: rest });
  return result;
}

export function createKnowledgeTextChunks(blocks: KnowledgeTextBlock[]): KnowledgeTextChunk[] {
  const expanded = blocks.flatMap(splitLongBlock);
  const groups: KnowledgeTextBlock[][] = [];
  let current: KnowledgeTextBlock[] = [];
  let currentLength = 0;
  for (const block of expanded) {
    const headingChanged = current.length > 0
      && current[0].headingPath.join("\u0000") !== block.headingPath.join("\u0000");
    const separator = current.length ? 2 : 0;
    if (current.length && (headingChanged || currentLength + separator + block.text.length > KNOWLEDGE_TEXT_MAX_CHARACTERS)) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(block);
    currentLength += (current.length > 1 ? 2 : 0) + block.text.length;
    if (currentLength >= KNOWLEDGE_TEXT_TARGET_CHARACTERS) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
  }
  if (current.length) groups.push(current);

  return groups.map((group) => {
    const first = group[0];
    const last = group.at(-1)!;
    const text = group.map((block) => block.text).join("\n\n");
    const locator: TextKnowledgeLocator = {
      v: 1,
      kind: "text",
      lineStart: first.lineStart,
      lineEnd: last.lineEnd,
      headingPath: first.headingPath,
    };
    return {
      sourceCueStart: first.lineStart,
      sourceCueEnd: last.lineEnd,
      startMs: null,
      endMs: null,
      originalText: text,
      cleanedText: text,
      topic: first.headingPath.at(-1) ?? "",
      keywords: [],
      locatorKind: "TEXT",
      locator,
    };
  });
}
