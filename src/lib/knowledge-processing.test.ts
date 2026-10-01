import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSubtitleOutputTokenBudget,
  collapseRollingSubtitleCues,
  createDeterministicSegments,
  createSubtitleWindows,
  materializeChunk,
  mergeShortCueInputs,
  processSubtitleWindow,
  validateProcessedSegments,
} from "@/lib/knowledge-processing";
import { defaultStoredAiConfig } from "@/lib/ai-config";
import { EMBEDDING_BATCH_SIZE, splitEmbeddingBatches } from "@/lib/knowledge-embeddings";
import { parseSubtitle } from "@/lib/subtitle-parser";

test("SRT and VTT retain program-owned time ranges and remove exact consecutive duplicates", () => {
  const srt = parseSubtitle(`1\n00:00:01,000 --> 00:00:02,500\nFirst line\n\n2\n00:00:02,500 --> 00:00:03,500\nFirst line\n\n3\n00:00:04,000 --> 00:00:05,000\nSecond`, "40A.srt");
  assert.equal(srt.length, 2);
  assert.deepEqual(srt[0], { id: 1, startMs: 1000, endMs: 3500, text: "First line" });

  const vtt = parseSubtitle(`WEBVTT\n\n00:01.000 --> 00:02.250 align:start\n你好\n\n00:02.250 --> 00:03.000\n世界`, "40A.vtt");
  assert.deepEqual(vtt.map((cue) => [cue.startMs, cue.endMs]), [[1000, 2250], [2250, 3000]]);
});

test("ASS centisecond timestamps and TXT paragraphs are supported", () => {
  const ass = parseSubtitle(`[Script Info]\nTitle: demo\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.25,0:00:03.50,Default,{\\b1}H1 breakout\\Nfollow-through`, "40A.ass");
  assert.equal(ass[0].startMs, 1250);
  assert.equal(ass[0].endMs, 3500);
  assert.equal(ass[0].text, "H1 breakout\nfollow-through");
  assert.equal(parseSubtitle("第一段\n第二段", "notes.txt").length, 2);
});

test("processed segments must cover every cue once and preserve order", () => {
  const cues = parseSubtitle("alpha text\nbeta text", "notes.txt");
  const valid = validateProcessedSegments(cues, [{
    cueIds: [1, 2], cleanedText: "alpha text beta text", topic: "test", keywords: ["H1", "H1"],
  }]);
  assert.deepEqual(valid[0].keywords, ["H1"]);
  assert.throws(() => validateProcessedSegments(cues, [{ cueIds: [2, 1], cleanedText: "alpha text beta text", topic: "", keywords: [] }]), /order|unknown/i);
});

test("subtitle windows respect the character budget and chunk times come only from cues", () => {
  const cues = [
    { id: 1, startMs: 100, endMs: 200, text: "a".repeat(40) },
    { id: 2, startMs: 200, endMs: 300, text: "b".repeat(40) },
  ];
  assert.equal(createSubtitleWindows(cues, 60).length, 2);
  const chunk = materializeChunk(cues, { cueIds: [1, 2], cleanedText: "clean", topic: "topic", keywords: [] });
  assert.equal(chunk.startMs, 100);
  assert.equal(chunk.endMs, 300);
  assert.deepEqual(mergeShortCueInputs([
    { id: 1, startMs: 0, endMs: 500, text: "short" },
    { id: 2, startMs: 600, endMs: 900, text: "sentence" },
  ]), [{ cueIds: [1, 2], text: "short sentence" }]);
});

test("rolling captions are collapsed before chunking", () => {
  const cues = collapseRollingSubtitleCues([
    { id: 1, startMs: 0, endMs: 1_000, text: "This is" },
    { id: 2, startMs: 900, endMs: 2_000, text: "This is a breakout" },
    { id: 3, startMs: 1_900, endMs: 3_000, text: "This is a breakout above resistance" },
  ]);
  assert.deepEqual(cues, [{ id: 1, startMs: 0, endMs: 3_000, text: "This is a breakout above resistance" }]);
});

test("quick import creates deterministic chunks without AI-cleaned text", () => {
  const cues = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    startMs: index * 30_000,
    endMs: (index + 1) * 30_000,
    text: `Sentence ${index + 1}.`,
  }));
  const segments = createDeterministicSegments(cues, { maxCharacters: 40, maxDurationMs: 70_000 });
  assert.deepEqual(segments.flatMap((segment) => segment.cueIds), [1, 2, 3, 4, 5]);
  assert.ok(segments.every((segment) => segment.cleanedText.includes("Sentence")));
});

test("embedding inputs stay within the provider-safe batch limit", () => {
  const batches = splitEmbeddingBatches(Array.from({ length: 45 }, (_, index) => `chunk-${index}`));
  assert.equal(EMBEDDING_BATCH_SIZE, 20);
  assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 5]);
});

test("AI subtitle output budget is bounded by ratio, configured limit, and hard limit", () => {
  assert.equal(calculateSubtitleOutputTokenBudget(1_000, 3_000), 2_000);
  assert.equal(calculateSubtitleOutputTokenBudget(2_000, 2_500), 2_500);
  assert.equal(calculateSubtitleOutputTokenBudget(2_000, 8_192), 3_000);
});

test("a provider length limit fails the AI window without retrying or falling back", async () => {
  const config = defaultStoredAiConfig();
  config.endpoints = [{
    id: "deepseek", name: "DeepSeek", provider: "deepseek", baseUrl: "https://api.deepseek.com",
    useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "", apiKey: "test",
    models: ["deepseek-chat"], defaultModel: "deepseek-chat",
  }];
  config.activeEndpointId = "deepseek";
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({
      choices: [{
        message: { content: '{"segments":[{"cueStart":1,"cueEnd":1,"topic":"test","keywords":[]}]}' },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    });
  };
  try {
    await assert.rejects(
      processSubtitleWindow(config, [{ id: 1, startMs: 0, endMs: 1_000, text: "test" }]),
      /request limit|truncated/i,
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
