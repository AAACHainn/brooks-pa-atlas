import { createHash } from "node:crypto";

import { z } from "zod";

import {
  SUBTITLE_KNOWLEDGE_SKILL_KEY,
  type StoredAiConfig,
} from "@/lib/ai-config";
import { createAiChatCompletion } from "@/lib/ai-client";
import type { KnowledgeProcessedSegment, SubtitleCue } from "@/lib/knowledge-types";

const outputSchema = z.object({
  segments: z.array(z.object({
    cueIds: z.array(z.number().int().positive()).min(1),
    cleanedText: z.string().trim().min(1),
    topic: z.string().trim().max(300).default(""),
    keywords: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  })).min(1),
});

export function createSubtitleWindows(cues: SubtitleCue[], maxCharacters = 6_000) {
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
    const closeInTime = !previousCue || previousCue.endMs === null || cue.startMs === null
      || cue.startMs - previousCue.endMs <= 2_000;
    if (previous && previous.text.length <= 120 && cue.text.length <= 32 && closeInTime) {
      previous.cueIds.push(cue.id);
      previous.text = `${previous.text} ${cue.text}`.replace(/\s+/g, " ").trim();
    } else {
      groups.push({ cueIds: [cue.id], text: cue.text });
    }
    previousCue = cue;
  }
  return groups;
}

function parseJsonResponse(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const parsed = JSON.parse(fenced?.[1] ?? trimmed) as unknown;
  return outputSchema.parse(parsed).segments;
}

export function validateProcessedSegments(
  cues: SubtitleCue[],
  segments: KnowledgeProcessedSegment[],
) {
  const expectedIds = cues.map((cue) => cue.id);
  const actualIds = segments.flatMap((segment) => segment.cueIds);
  if (actualIds.length !== expectedIds.length) {
    throw new Error("AI output did not cover every subtitle cue exactly once.");
  }
  actualIds.forEach((id, index) => {
    if (id !== expectedIds[index]) {
      throw new Error("AI output changed cue order or referenced an unknown cue.");
    }
  });
  const originalLength = cues.map((cue) => cue.text).join("\n").replace(/\s/g, "").length;
  const cleanedLength = segments.map((segment) => segment.cleanedText).join("\n").replace(/\s/g, "").length;
  const ratio = originalLength === 0 ? 1 : cleanedLength / originalLength;
  if (ratio < 0.6 || ratio > 1.4) {
    throw new Error(`AI-cleaned text length ratio ${ratio.toFixed(2)} is outside 0.60–1.40.`);
  }
  return segments.map((segment) => ({
    ...segment,
    keywords: [...new Set(segment.keywords.map((value) => value.trim()).filter(Boolean))],
  }));
}

export function subtitlePromptHash(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex");
}

export async function processSubtitleWindow(
  config: StoredAiConfig,
  cues: SubtitleCue[],
) {
  const endpoint = config.endpoints.find((item) => item.id === config.activeEndpointId);
  const skill = config.skills[SUBTITLE_KNOWLEDGE_SKILL_KEY];
  const model = skill.modelOverride || endpoint?.defaultModel || "";
  if (!endpoint || !model) throw new Error("字幕知识整理技能尚未配置可用的聊天模型。");
  const input = JSON.stringify({
    cues: mergeShortCueInputs(cues),
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await createAiChatCompletion(endpoint, model, [
        { role: "system", content: skill.prompt },
        { role: "user", content: input },
      ]);
      return {
        raw,
        segments: validateProcessedSegments(cues, parseJsonResponse(raw)),
        endpointId: endpoint.id,
        model,
        promptHash: subtitlePromptHash(skill.prompt),
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI subtitle processing failed.");
}

export function materializeChunk(
  cues: SubtitleCue[],
  segment: KnowledgeProcessedSegment,
) {
  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const selected = segment.cueIds.map((id) => cueById.get(id)).filter((cue): cue is SubtitleCue => Boolean(cue));
  return {
    sourceCueStart: selected[0].id,
    sourceCueEnd: selected[selected.length - 1].id,
    startMs: selected.find((cue) => cue.startMs !== null)?.startMs ?? null,
    endMs: [...selected].reverse().find((cue) => cue.endMs !== null)?.endMs ?? null,
    originalText: selected.map((cue) => cue.text).join("\n"),
    cleanedText: segment.cleanedText,
    topic: segment.topic,
    keywords: segment.keywords,
  };
}
