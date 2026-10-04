import { createHash } from "node:crypto";

import { z } from "zod";

import {
  SUBTITLE_KNOWLEDGE_SKILL_KEY,
  type StoredAiConfig,
} from "@/lib/ai-config";
import { createAiChatCompletion, type AiChatUsage } from "@/lib/ai-client";
import { subtitleLocator } from "@/lib/knowledge-source";
import type { KnowledgeProcessedSegment, SubtitleCue } from "@/lib/knowledge-types";

export const KNOWLEDGE_PROCESSING_RULE_VERSION = "subtitle-v3-bounded-metadata-only";
export const SUBTITLE_WINDOW_MAX_CHARACTERS = 6_000;
export const SUBTITLE_OUTPUT_TOKEN_RATIO = 2;
export const SUBTITLE_OUTPUT_TOKEN_HARD_LIMIT = 3_000;
const SUBTITLE_GROUP_BOUNDARY_REPAIR_MINIMUM = 5;
const SUBTITLE_AI_VALIDATION_RULE_VERSION = "group-boundaries-v1-feedback";

const metadataSegmentSchema = z.object({
  cueStart: z.number().int().positive(),
  cueEnd: z.number().int().positive(),
  topic: z.string().trim().max(300).default(""),
  keywords: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
});
const legacySegmentSchema = z.object({
  cueIds: z.array(z.number().int().positive()).min(1),
  cleanedText: z.string().optional(),
  topic: z.string().trim().max(300).default(""),
  keywords: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
});
const outputSchema = z.object({
  segments: z.array(z.union([metadataSegmentSchema, legacySegmentSchema])).min(1),
});

class AiSubtitleOutputFuseError extends Error {}

class AiSubtitleValidationError extends Error {
  constructor(message: string, readonly retryFeedback: string) {
    super(message);
  }
}

type CueRange = { cueStart: number; cueEnd: number };

function compactText(value: string) {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function compactComparable(value: string) {
  return compactText(value).replace(/\s+/g, " ").toLocaleLowerCase();
}

function closeInTime(previous: SubtitleCue, current: SubtitleCue, maximumGapMs = 5_000) {
  return previous.endMs === null || current.startMs === null || current.startMs - previous.endMs <= maximumGapMs;
}

function longestWordOverlap(left: string, right: string) {
  const leftWords = left.split(/\s+/).filter(Boolean);
  const rightWords = right.split(/\s+/).filter(Boolean);
  const maximum = Math.min(leftWords.length, rightWords.length, 20);
  for (let length = maximum; length >= 2; length -= 1) {
    if (leftWords.slice(-length).join(" ") === rightWords.slice(0, length).join(" ")) return length;
  }
  return 0;
}

export function collapseRollingSubtitleCues(cues: SubtitleCue[]) {
  const result: SubtitleCue[] = [];
  for (const source of cues) {
    const cue = { ...source, text: compactText(source.text) };
    const previous = result.at(-1);
    if (!previous || !closeInTime(previous, cue)) {
      result.push(cue);
      continue;
    }
    const previousComparable = compactComparable(previous.text);
    const currentComparable = compactComparable(cue.text);
    if (currentComparable.startsWith(previousComparable) && currentComparable.length > previousComparable.length) {
      previous.text = cue.text;
      previous.endMs = cue.endMs ?? previous.endMs;
      continue;
    }
    if (previousComparable.startsWith(currentComparable)) {
      previous.endMs = cue.endMs ?? previous.endMs;
      continue;
    }
    const overlap = longestWordOverlap(previousComparable, currentComparable);
    if (overlap > 0) {
      const words = cue.text.split(/\s+/).filter(Boolean);
      const remainder = words.slice(overlap).join(" ").trim();
      if (!remainder) {
        previous.endMs = cue.endMs ?? previous.endMs;
        continue;
      }
      cue.text = remainder;
    }
    result.push(cue);
  }
  return result.map((cue, index) => ({ ...cue, id: index + 1 }));
}

export function createSubtitleWindows(cues: SubtitleCue[], maxCharacters = SUBTITLE_WINDOW_MAX_CHARACTERS) {
  const windows: SubtitleCue[][] = [];
  let current: SubtitleCue[] = [];
  let length = 0;
  for (const cue of cues) {
    const cost = cue.text.length + 48;
    if (current.length > 0 && length + cost > maxCharacters) {
      windows.push(current);
      current = [];
      length = 0;
    }
    current.push(cue);
    length += cost;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

export function mergeShortCueInputs(cues: SubtitleCue[]) {
  const groups: Array<{ cueIds: number[]; text: string }> = [];
  let previousCue: SubtitleCue | undefined;
  for (const cue of cues) {
    const previous = groups.at(-1);
    const nearby = !previousCue || closeInTime(previousCue, cue, 2_000);
    if (previous && previous.text.length <= 120 && cue.text.length <= 32 && nearby) {
      previous.cueIds.push(cue.id);
      previous.text = compactText(`${previous.text} ${cue.text}`);
    } else {
      groups.push({ cueIds: [cue.id], text: cue.text });
    }
    previousCue = cue;
  }
  return groups;
}

function joinedCueText(cues: SubtitleCue[]) {
  return compactText(cues.map((cue) => cue.text).join(" "));
}

export function createDeterministicSegments(
  cues: SubtitleCue[],
  options: { maxCharacters?: number; targetDurationMs?: number; maxDurationMs?: number; gapBreakMs?: number } = {},
) {
  const maxCharacters = options.maxCharacters ?? 1_200;
  const targetDurationMs = options.targetDurationMs ?? 60_000;
  const maxDurationMs = options.maxDurationMs ?? 90_000;
  const gapBreakMs = options.gapBreakMs ?? 6_000;
  const groups: SubtitleCue[][] = [];
  let current: SubtitleCue[] = [];
  for (const cue of cues) {
    const first = current[0];
    const previous = current.at(-1);
    const candidateLength = joinedCueText([...current, cue]).length;
    const duration = first?.startMs !== null && first?.startMs !== undefined && cue.endMs !== null
      ? cue.endMs - first.startMs
      : 0;
    const gap = previous?.endMs !== null && previous?.endMs !== undefined && cue.startMs !== null
      ? cue.startMs - previous.endMs
      : 0;
    const sentenceBoundary = previous ? /[.!?。！？]$/.test(previous.text.trim()) : false;
    const shouldBreak = current.length > 0 && (
      candidateLength > maxCharacters
      || duration > maxDurationMs
      || gap > gapBreakMs
      || (duration >= targetDurationMs && candidateLength >= 400 && sentenceBoundary)
    );
    if (shouldBreak) {
      groups.push(current);
      current = [];
    }
    current.push(cue);
  }
  if (current.length) groups.push(current);
  return groups.map((group) => ({
    cueIds: group.map((cue) => cue.id),
    cleanedText: joinedCueText(group),
    topic: "",
    keywords: [],
  } satisfies KnowledgeProcessedSegment));
}

function jsonCandidates(raw: string) {
  const trimmed = raw.trim().replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)?.[1];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const object = firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : "";
  return [...new Set([fenced, trimmed, object].filter(Boolean) as string[])]
    .flatMap((value) => [value, value.replace(/,\s*([}\]])/g, "$1")]);
}

function parseJsonResponse(raw: string) {
  let lastError: unknown;
  for (const candidate of jsonCandidates(raw)) {
    try {
      return outputSchema.parse(JSON.parse(candidate) as unknown).segments;
    } catch (error) {
      lastError = error;
    }
  }
  throw new AiSubtitleValidationError(
    lastError instanceof Error ? lastError.message : "AI returned invalid JSON.",
    "上次输出不是符合约定结构的 JSON。请重新返回完整的 segments JSON，每项仅包含 cueStart、cueEnd、topic、keywords。",
  );
}

export function validateProcessedSegments(cues: SubtitleCue[], segments: KnowledgeProcessedSegment[]) {
  const expectedIds = cues.map((cue) => cue.id);
  const actualIds = segments.flatMap((segment) => segment.cueIds);
  if (actualIds.length !== expectedIds.length) throw new Error("AI output did not cover every subtitle cue exactly once.");
  actualIds.forEach((id, index) => {
    if (id !== expectedIds[index]) throw new Error("AI output changed cue order or referenced an unknown cue.");
  });
  return segments.map((segment) => ({
    ...segment,
    keywords: [...new Set(segment.keywords.map((value) => value.trim()).filter(Boolean))],
  }));
}

function missingCueRanges(firstId: number, lastId: number, ranges: CueRange[]) {
  const missing: CueRange[] = [];
  let cursor = firstId;
  for (const range of ranges) {
    if (range.cueStart > cursor) missing.push({ cueStart: cursor, cueEnd: range.cueStart - 1 });
    cursor = range.cueEnd + 1;
  }
  if (cursor <= lastId) missing.push({ cueStart: cursor, cueEnd: lastId });
  return missing;
}

function countRangeCues(ranges: CueRange[]) {
  return ranges.reduce((count, range) => count + range.cueEnd - range.cueStart + 1, 0);
}

function formatCueRanges(ranges: CueRange[]) {
  return ranges.slice(0, 12).map((range) => range.cueStart === range.cueEnd
    ? String(range.cueStart)
    : `${range.cueStart}–${range.cueEnd}`).join("、") + (ranges.length > 12 ? "等" : "");
}

function metadataToSegments(
  cues: SubtitleCue[],
  rawSegments: z.infer<typeof outputSchema>["segments"],
  inputGroups: ReturnType<typeof mergeShortCueInputs>,
) {
  const firstId = cues[0].id;
  const lastId = cues.at(-1)!.id;
  const coverageFeedback = `当前窗口必须完整覆盖 ${firstId}–${lastId}，每个编号恰好一次。请重新返回完整的 segments JSON；首段从 ${firstId} 开始，末段到 ${lastId} 结束，相邻段连续、按原顺序且无重叠。输入字幕组的 cueStart–cueEnd 包含首尾，必须完整归入一个片段。`;
  const ranges = rawSegments.map((segment) => {
    const cueStart = "cueStart" in segment ? segment.cueStart : segment.cueIds[0];
    const cueEnd = "cueEnd" in segment ? segment.cueEnd : segment.cueIds.at(-1)!;
    return { cueStart, cueEnd, topic: segment.topic, keywords: segment.keywords };
  });
  for (const [index, range] of ranges.entries()) {
    if (range.cueStart < firstId || range.cueEnd > lastId || range.cueEnd < range.cueStart) {
      throw new AiSubtitleValidationError(
        "AI output referenced an unknown or reversed cue range.",
        `上次输出的第 ${index + 1} 段范围 ${range.cueStart}–${range.cueEnd} 越界或首尾颠倒。${coverageFeedback}`,
      );
    }
    const previous = ranges[index - 1];
    if (previous && range.cueStart <= previous.cueEnd) {
      throw new AiSubtitleValidationError(
        "AI output contains overlapping or reordered cue ranges.",
        `上次输出的第 ${index}、${index + 1} 段重叠或倒序（${previous.cueStart}–${previous.cueEnd}、${range.cueStart}–${range.cueEnd}）。${coverageFeedback}`,
      );
    }
  }
  const originalGaps = missingCueRanges(firstId, lastId, ranges);
  const originalMissing = countRangeCues(originalGaps);
  const groupByCueId = new Map<number, CueRange>();
  for (const group of inputGroups) {
    const bounds = { cueStart: group.cueIds[0], cueEnd: group.cueIds.at(-1)! };
    for (const id of group.cueIds) groupByCueId.set(id, bounds);
  }
  // Extend only uncovered edges of a group already touched by this range.
  // An entirely omitted group or an edge owned by another segment is never absorbed.
  for (const [index, range] of ranges.entries()) {
    const startGroup = groupByCueId.get(range.cueStart)!;
    const previous = ranges[index - 1];
    if (startGroup.cueStart < range.cueStart && (!previous || previous.cueEnd < startGroup.cueStart)) {
      range.cueStart = startGroup.cueStart;
    }
    const endGroup = groupByCueId.get(range.cueEnd)!;
    const next = ranges[index + 1];
    if (endGroup.cueEnd > range.cueEnd && (!next || next.cueStart > endGroup.cueEnd)) {
      range.cueEnd = endGroup.cueEnd;
    }
  }
  const remainingMissing = countRangeCues(missingCueRanges(firstId, lastId, ranges));
  const repairLimit = Math.max(3, Math.ceil(cues.length * 0.05));
  // Group-edge repairs share a bounded total budget with ordinary gap repairs.
  const totalRepairLimit = originalMissing > remainingMissing
    ? Math.max(SUBTITLE_GROUP_BOUNDARY_REPAIR_MINIMUM, repairLimit)
    : repairLimit;
  if (remainingMissing > repairLimit || originalMissing > totalRepairLimit) {
    const limit = remainingMissing > repairLimit ? repairLimit : totalRepairLimit;
    const omitted = formatCueRanges(originalGaps);
    throw new AiSubtitleValidationError(
      `AI output omitted ${originalMissing} cues, exceeding the repair limit ${limit}. Missing cue ranges: ${omitted}.`,
      `上次输出遗漏了字幕编号 ${omitted}（共 ${originalMissing} 条）。${coverageFeedback}`,
    );
  }
  let cursor = firstId;
  const repaired: Array<z.infer<typeof metadataSegmentSchema>> = [];
  for (const range of ranges) {
    if (range.cueStart > cursor) {
      repaired.push({ cueStart: cursor, cueEnd: range.cueStart - 1, topic: "", keywords: [] });
    }
    repaired.push(range);
    cursor = range.cueEnd + 1;
  }
  if (cursor <= lastId) {
    repaired.push({ cueStart: cursor, cueEnd: lastId, topic: "", keywords: [] });
  }
  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  return validateProcessedSegments(cues, repaired.map((range) => {
    const selected: SubtitleCue[] = [];
    for (let id = range.cueStart; id <= range.cueEnd; id += 1) selected.push(cueById.get(id)!);
    return {
      cueIds: selected.map((cue) => cue.id),
      cleanedText: joinedCueText(selected),
      topic: range.topic,
      keywords: range.keywords,
    };
  }));
}

export function subtitlePromptHash(
  prompt: string,
  options: { retryModelOverride?: string; disableReasoning?: boolean; maxOutputTokens?: number } = {},
) {
  return createHash("sha256").update(JSON.stringify({
    rule: KNOWLEDGE_PROCESSING_RULE_VERSION,
    validationRule: SUBTITLE_AI_VALIDATION_RULE_VERSION,
    prompt,
    retryModelOverride: options.retryModelOverride ?? "",
    disableReasoning: true,
    maxOutputTokens: Math.min(options.maxOutputTokens ?? 3_000, SUBTITLE_OUTPUT_TOKEN_HARD_LIMIT),
  })).digest("hex");
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 3));
}

export function calculateSubtitleOutputTokenBudget(inputTokens: number, configuredLimit: number) {
  const normalizedInput = Math.max(1, Math.floor(inputTokens));
  const normalizedConfiguredLimit = Math.max(1, Math.floor(configuredLimit));
  return Math.max(1, Math.min(
    normalizedConfiguredLimit,
    SUBTITLE_OUTPUT_TOKEN_HARD_LIMIT,
    Math.floor(normalizedInput * SUBTITLE_OUTPUT_TOKEN_RATIO),
  ));
}

export async function processSubtitleWindow(
  config: StoredAiConfig,
  cues: SubtitleCue[],
  options: {
    onAttempt?: (attempt: number, maxAttempts: number) => void | Promise<void>;
    onResponse?: (response: { raw: string; inputTokens: number; outputTokens: number }) => void | Promise<void>;
  } = {},
) {
  const endpoint = config.endpoints.find((item) => item.id === config.activeEndpointId);
  const skill = config.skills[SUBTITLE_KNOWLEDGE_SKILL_KEY];
  const primaryModel = skill.modelOverride || endpoint?.defaultModel || "";
  if (!endpoint || !primaryModel) throw new Error("字幕知识整理技能尚未配置可用的聊天模型。");
  const inputGroups = mergeShortCueInputs(cues);
  const input = JSON.stringify({
    cues: inputGroups.map((group) => ({
      cueStart: group.cueIds[0],
      cueEnd: group.cueIds.at(-1),
      text: group.text,
    })),
  });
  const contract = "硬性输出约束：只返回 segments；每项仅允许 cueStart、cueEnd、topic、keywords。禁止输出 cleanedText、字幕正文、解释、Markdown 或思考过程。";
  const systemPrompt = `${skill.prompt}\n\n${contract}`;
  let lastError: unknown;
  let retryFeedback: string | null = null;
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const model = attempt === 1 && skill.retryModelOverride ? skill.retryModelOverride : primaryModel;
    const attemptPrompt = retryFeedback ? `${systemPrompt}\n\n校验反馈：${retryFeedback}` : systemPrompt;
    const estimatedInputTokens = estimateTokens(`${attemptPrompt}\n${input}`);
    const maxOutputTokens = calculateSubtitleOutputTokenBudget(estimatedInputTokens, skill.maxOutputTokens);
    let finishReason: string | null = null;
    let reasoningDetected = false;
    try {
      await options.onAttempt?.(attempt + 1, maxAttempts);
      let usage: AiChatUsage = { inputTokens: null, outputTokens: null, reasoningTokens: null };
      const raw = await createAiChatCompletion(endpoint, model, [
        { role: "system", content: attemptPrompt },
        { role: "user", content: input },
      ], {
        temperature: 0,
        maxOutputTokens,
        jsonMode: true,
        disableReasoning: true,
        onUsage: (next) => { usage = next; },
        onFinishReason: (next) => { finishReason = next; },
        onReasoningDetected: (detected) => { reasoningDetected = detected; },
      });
      const inputTokens = usage.inputTokens ?? estimatedInputTokens;
      const outputTokens = usage.outputTokens ?? estimateTokens(raw);
      await options.onResponse?.({ raw, inputTokens, outputTokens });
      if (reasoningDetected || (usage.reasoningTokens ?? 0) > 0) {
        throw new AiSubtitleOutputFuseError(
          "AI provider returned reasoning content or reasoning tokens even though subtitle reasoning was disabled.",
        );
      }
      if (finishReason === "length") {
        throw new AiSubtitleOutputFuseError(
          `AI output reached the ${maxOutputTokens}-token request limit and was truncated.`,
        );
      }
      if (outputTokens > inputTokens * SUBTITLE_OUTPUT_TOKEN_RATIO) {
        throw new AiSubtitleOutputFuseError(`AI output token count ${outputTokens} exceeded the safety ratio for ${inputTokens} input tokens.`);
      }
      return {
        raw,
        segments: metadataToSegments(cues, parseJsonResponse(raw), inputGroups),
        endpointId: endpoint.id,
        model,
        promptHash: subtitlePromptHash(skill.prompt, skill),
        attempts: attempt + 1,
        inputTokens,
        outputTokens,
      };
    } catch (error) {
      lastError = error;
      if (reasoningDetected) {
        throw new AiSubtitleOutputFuseError(
          "AI provider returned reasoning content even though subtitle reasoning was disabled.",
        );
      }
      if (finishReason === "length") {
        throw new AiSubtitleOutputFuseError(
          `AI output reached the ${maxOutputTokens}-token request limit and was truncated.`,
        );
      }
      if (error instanceof AiSubtitleOutputFuseError) throw error;
      retryFeedback = error instanceof AiSubtitleValidationError ? error.retryFeedback : null;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI subtitle processing failed.");
}

export function materializeChunk(cues: SubtitleCue[], segment: KnowledgeProcessedSegment) {
  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const selected = segment.cueIds.map((id) => cueById.get(id)).filter((cue): cue is SubtitleCue => Boolean(cue));
  if (!selected.length) throw new Error("Knowledge segment does not contain any valid subtitle cues.");
  const startMs = selected.find((cue) => cue.startMs !== null)?.startMs ?? null;
  const endMs = [...selected].reverse().find((cue) => cue.endMs !== null)?.endMs ?? null;
  return {
    sourceCueStart: selected[0].id,
    sourceCueEnd: selected[selected.length - 1].id,
    startMs,
    endMs,
    originalText: selected.map((cue) => cue.text).join("\n"),
    cleanedText: segment.cleanedText || joinedCueText(selected),
    topic: segment.topic,
    keywords: segment.keywords,
    locatorKind: "SUBTITLE" as const,
    locator: subtitleLocator({
      cueStart: selected[0].id,
      cueEnd: selected[selected.length - 1].id,
      startMs,
      endMs,
    }),
  };
}
