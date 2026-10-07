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
import type { SubtitleCue } from "@/lib/knowledge-types";

function subtitleTestConfig() {
  const config = defaultStoredAiConfig();
  config.endpoints = [{
    id: "test", name: "Test", provider: "deepseek", baseUrl: "https://subtitle.test",
    useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "", apiKey: "",
    models: ["primary"], defaultModel: "primary",
  }];
  config.activeEndpointId = "test";
  return config;
}

function windowCues(shortTexts: Record<number, string> = {}): SubtitleCue[] {
  return Array.from({ length: 59 }, (_, index) => {
    const id = index + 122;
    return {
      id, startMs: id * 1_000, endMs: id * 1_000 + 900,
      text: shortTexts[id] ?? `Subtitle ${id}: ${"x".repeat(130)}`,
    };
  });
}

const reversalGroup = {
  126: "Trying to reverse, look to buy.",
  127: "Trying to reverse, buy.",
  128: "Buy, buy.",
  129: "Trying to reverse, buy, buy.",
  130: "Buy again.",
};

function rangeOutput(ranges: Array<[number, number]>) {
  return JSON.stringify({ segments: ranges.map(([cueStart, cueEnd], index) => ({
    cueStart, cueEnd, topic: `Topic ${index + 1}`, keywords: ["Buy"],
  })) });
}

type SubtitleTestRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  temperature: number;
  response_format: { type: string };
  thinking: { type: string };
};

async function withSubtitleResponses(
  responses: Array<{ content: string; reasoningTokens?: number; outputTokens?: number }>,
  run: (requests: SubtitleTestRequest[]) => Promise<void>,
) {
  const requests: SubtitleTestRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const response = responses[Math.min(requests.length, responses.length - 1)];
    requests.push(JSON.parse(String(init?.body)) as SubtitleTestRequest);
    return Response.json({
      choices: [{ message: { content: response.content }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1_000, completion_tokens: response.outputTokens ?? 100,
        completion_tokens_details: { reasoning_tokens: response.reasoningTokens ?? 0 },
      },
    });
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

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

test("a truncated 126–130 input group is repaired without retry and retains source text and times", async () => {
  const cues = windowCues(reversalGroup);
  assert.ok(mergeShortCueInputs(cues).some((group) => group.cueIds.join(",") === "126,127,128,129,130"));
  await withSubtitleResponses([{ content: rangeOutput([[122, 126], [131, 180]]) }], async (requests) => {
    const result = await processSubtitleWindow(subtitleTestConfig(), cues);
    assert.equal(requests.length, 1);
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.segments.flatMap((segment) => segment.cueIds), cues.map((cue) => cue.id));
    assert.deepEqual(result.segments[0].cueIds, cues.slice(0, 9).map((cue) => cue.id));
    assert.equal(result.segments[0].topic, "Topic 1");
    assert.deepEqual(result.segments[0].keywords, ["Buy"]);
    assert.equal(result.segments[0].cleanedText, cues.slice(0, 9).map((cue) => cue.text).join(" "));
    const chunk = materializeChunk(cues, result.segments[0]);
    assert.equal(chunk.originalText, cues.slice(0, 9).map((cue) => cue.text).join("\n"));
    assert.equal(chunk.startMs, cues[0].startMs);
    assert.equal(chunk.endMs, cues[8].endMs);
  });
});

test("an omitted group prefix is restored to the segment already covering its suffix", async () => {
  const cues = windowCues(reversalGroup);
  await withSubtitleResponses([{ content: rangeOutput([[122, 125], [130, 180]]) }], async (requests) => {
    const result = await processSubtitleWindow(subtitleTestConfig(), cues);
    assert.equal(requests.length, 1);
    assert.equal(result.segments[1].cueIds[0], 126);
    assert.deepEqual(result.segments.flatMap((segment) => segment.cueIds), cues.map((cue) => cue.id));
  });
});

test("both window edges can be repaired inside one partially covered input group", async () => {
  const cues = windowCues(reversalGroup).filter((cue) => cue.id >= 126 && cue.id <= 130);
  await withSubtitleResponses([{ content: rangeOutput([[127, 129]]) }], async () => {
    const result = await processSubtitleWindow(subtitleTestConfig(), cues);
    assert.equal(result.segments.length, 1);
    assert.deepEqual(result.segments[0].cueIds, [126, 127, 128, 129, 130]);
    assert.equal(result.segments[0].topic, "Topic 1");
  });
});

test("group repair never steals cues from a neighboring segment", async () => {
  const cues = windowCues(reversalGroup);
  for (const nextStart of [127, 129]) {
    await withSubtitleResponses([{ content: rangeOutput([[122, 126], [nextStart, 180]]) }], async (requests) => {
      const result = await processSubtitleWindow(subtitleTestConfig(), cues);
      assert.equal(requests.length, 1);
      assert.equal(result.segments[0].cueIds.at(-1), 126);
      assert.equal(result.segments.at(-1)!.cueIds[0], nextStart);
      assert.deepEqual(result.segments.flatMap((segment) => segment.cueIds), cues.map((cue) => cue.id));
      if (nextStart === 129) {
        assert.deepEqual(result.segments[1].cueIds, [127, 128]);
        assert.equal(result.segments[1].topic, "");
      }
    });
  }
});

test("an entirely omitted 127–130 group triggers explicit feedback and the configured retry model", async () => {
  const cues = windowCues({ 127: "Buy.", 128: "Buy again.", 129: "Look to buy.", 130: "Buy, buy." });
  assert.ok(mergeShortCueInputs(cues).some((group) => group.cueIds.join(",") === "127,128,129,130"));
  const config = subtitleTestConfig();
  config.skills.subtitleKnowledge.retryModelOverride = "cheap-retry";
  await withSubtitleResponses([
    { content: rangeOutput([[122, 126], [131, 180]]) },
    { content: rangeOutput([[122, 130], [131, 180]]) },
  ], async (requests) => {
    const result = await processSubtitleWindow(config, cues);
    assert.equal(requests.length, 2);
    assert.equal(result.attempts, 2);
    assert.equal(requests[0].model, "primary");
    assert.equal(requests[1].model, "cheap-retry");
    assert.doesNotMatch(requests[0].messages[0].content, /校验反馈/);
    assert.match(requests[1].messages[0].content, /遗漏了字幕编号 127–130/);
    assert.match(requests[1].messages[0].content, /完整覆盖 122–180/);
    assert.equal(requests[1].messages[1].content, requests[0].messages[1].content);
    assert.deepEqual(result.segments.flatMap((segment) => segment.cueIds), cues.map((cue) => cue.id));
    for (const request of requests) {
      const estimate = Math.ceil(`${request.messages[0].content}\n${request.messages[1].content}`.length / 3);
      assert.equal(request.max_tokens, calculateSubtitleOutputTokenBudget(estimate, config.skills.subtitleKnowledge.maxOutputTokens));
      assert.equal(request.temperature, 0);
      assert.equal(request.response_format.type, "json_object");
      assert.equal(request.thinking.type, "disabled");
    }
  });
});

test("a retained retry model from another endpoint uses the current primary override", async () => {
  const config = subtitleTestConfig();
  config.endpoints[0].models.push("active-special");
  config.endpoints.push({ ...config.endpoints[0], id: "old", name: "Old endpoint", models: ["old-retry"], defaultModel: "old-retry" });
  config.skills.subtitleKnowledge.modelOverride = "active-special";
  config.skills.subtitleKnowledge.retryModelOverride = "old-retry";
  await withSubtitleResponses([
    { content: "invalid JSON" },
    { content: rangeOutput([[122, 180]]) },
  ], async (requests) => {
    const result = await processSubtitleWindow(config, windowCues());
    assert.equal(result.attempts, 2);
    assert.deepEqual(requests.map((request) => request.model), ["active-special", "active-special"]);
    assert.equal(config.skills.subtitleKnowledge.retryModelOverride, "old-retry");
  });
});

test("ordinary omissions retain the existing repair limit and report every missing interval", async () => {
  await withSubtitleResponses([{ content: rangeOutput([[122, 125], [130, 150], [155, 180]]) }], async (requests) => {
    await assert.rejects(processSubtitleWindow(subtitleTestConfig(), windowCues()), /omitted 8 cues, exceeding the repair limit 3/);
    assert.equal(requests.length, 2);
    assert.match(requests[1].messages[0].content, /126–129、151–154/);
  });
});

test("group-edge and ordinary gap repairs share a total limit", async () => {
  const cases = [
    { cues: windowCues({ 126: "Buy.", 127: "Buy.", 128: "Buy.", 129: "Buy.", 130: "Buy.", 131: "Buy.", 132: "Buy." }), ranges: [[122, 126], [133, 180]], omitted: "127–132" },
    { cues: windowCues(reversalGroup), ranges: [[122, 126], [131, 178]], omitted: "127–130、179–180" },
  ];
  for (const example of cases) {
    await withSubtitleResponses([{ content: rangeOutput(example.ranges as Array<[number, number]>) }], async (requests) => {
      await assert.rejects(processSubtitleWindow(subtitleTestConfig(), example.cues), /omitted 6 cues, exceeding the repair limit 5/);
      assert.equal(requests.length, 2);
      assert.ok(requests[1].messages[0].content.includes(example.omitted));
    });
  }
});

test("ordinary small gaps remain repairable alongside a bounded group-edge correction", async () => {
  const cues = windowCues(reversalGroup);
  await withSubtitleResponses([{ content: rangeOutput([[122, 126], [131, 179]]) }], async (requests) => {
    const result = await processSubtitleWindow(subtitleTestConfig(), cues);
    assert.equal(requests.length, 1);
    assert.deepEqual(result.segments.flatMap((segment) => segment.cueIds), cues.map((cue) => cue.id));
    assert.deepEqual(result.segments.at(-1)!.cueIds, [180]);
    assert.equal(result.segments.at(-1)!.topic, "");
  });
});

test("overlapping, reordered, out-of-window, and reversed ranges cannot be normalized into success", async () => {
  const cases: Array<{ ranges: Array<[number, number]>; error: RegExp; feedback: RegExp }> = [
    { ranges: [[122, 130], [130, 180]], error: /overlapping|reordered/, feedback: /重叠或倒序/ },
    { ranges: [[131, 180], [122, 130]], error: /overlapping|reordered/, feedback: /重叠或倒序/ },
    { ranges: [[121, 180]], error: /unknown|reversed/, feedback: /越界或首尾颠倒/ },
    { ranges: [[122, 181]], error: /unknown|reversed/, feedback: /越界或首尾颠倒/ },
    { ranges: [[130, 129]], error: /unknown|reversed/, feedback: /越界或首尾颠倒/ },
  ];
  for (const example of cases) {
    await withSubtitleResponses([{ content: rangeOutput(example.ranges) }], async (requests) => {
      await assert.rejects(processSubtitleWindow(subtitleTestConfig(), windowCues(reversalGroup)), example.error);
      assert.equal(requests.length, 2);
      assert.match(requests[1].messages[0].content, example.feedback);
    });
  }
});

test("invalid JSON gets program-owned format feedback without replaying arbitrary model text", async () => {
  await withSubtitleResponses([
    { content: "ARBITRARY_MODEL_INSTRUCTION" },
    { content: rangeOutput([[122, 180]]) },
  ], async (requests) => {
    const result = await processSubtitleWindow(subtitleTestConfig(), windowCues());
    assert.equal(result.attempts, 2);
    assert.match(requests[1].messages[0].content, /不是符合约定结构的 JSON/);
    assert.ok(!requests[1].messages[0].content.includes("ARBITRARY_MODEL_INSTRUCTION"));
  });
});

test("reasoning and output-ratio fuses still fail immediately without validation retries", async () => {
  const cases = [
    { response: { content: rangeOutput([[122, 126], [131, 180]]), reasoningTokens: 1 }, error: /reasoning/ },
    { response: { content: rangeOutput([[122, 126], [131, 180]]), outputTokens: 2_001 }, error: /safety ratio/ },
  ];
  for (const example of cases) {
    await withSubtitleResponses([example.response], async (requests) => {
      await assert.rejects(processSubtitleWindow(subtitleTestConfig(), windowCues(reversalGroup)), example.error);
      assert.equal(requests.length, 1);
    });
  }
});
