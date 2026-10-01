import assert from "node:assert/strict";
import test from "node:test";

import {
  createSubtitleWindows,
  materializeChunk,
  mergeShortCueInputs,
  validateProcessedSegments,
} from "@/lib/knowledge-processing";
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

test("AI segments must cover every cue once, preserve order, and stay within length bounds", () => {
  const cues = parseSubtitle("alpha text\nbeta text", "notes.txt");
  const valid = validateProcessedSegments(cues, [{
    cueIds: [1, 2], cleanedText: "alpha text beta text", topic: "test", keywords: ["H1", "H1"],
  }]);
  assert.deepEqual(valid[0].keywords, ["H1"]);
  assert.throws(() => validateProcessedSegments(cues, [{ cueIds: [2, 1], cleanedText: "alpha text beta text", topic: "", keywords: [] }]), /order|unknown/i);
  assert.throws(() => validateProcessedSegments(cues, [{ cueIds: [1, 2], cleanedText: "x", topic: "", keywords: [] }]), /ratio/i);
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

test("embedding inputs stay within the provider-safe batch limit", () => {
  const batches = splitEmbeddingBatches(Array.from({ length: 45 }, (_, index) => `chunk-${index}`));
  assert.equal(EMBEDDING_BATCH_SIZE, 20);
  assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 5]);
});
