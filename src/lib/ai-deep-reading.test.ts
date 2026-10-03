import assert from "node:assert/strict";
import test from "node:test";
import { defaultStoredAiConfig } from "@/lib/ai-config";
import {
  DeepReadingBudget, balanceDeepCandidates, deduplicateDeepCandidates, estimateDeepMessageTokens,
  prepareDeepReading, validateDeepCitations, validateDeepResearchPlan, type DeepReadingOptions,
} from "@/lib/ai-deep-reading";
import type { DeepKnowledgeCandidate, KnowledgeDocumentDescriptor } from "@/lib/knowledge-deep-search";

const skill = defaultStoredAiConfig().skills.readingCompanion;
const endpoint = { id: "e", name: "test", provider: "custom" as const, baseUrl: "https://example.test/v1", apiKey: "", useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "", models: ["vision"], defaultModel: "vision" };
const doc = (id: string): KnowledgeDocumentDescriptor => ({ id, versionId: `v-${id}`, title: id, lessonCode: id, sourceType: "SUBTITLE", indexPath: id, chunkCount: 10, headings: [] });
const source = (id: string, documentId = "19A", text = "支撑与阻力突破后回调"): DeepKnowledgeCandidate => ({
  id, documentId, versionId: `v-${documentId}`, title: documentId, lessonCode: documentId, sourceType: "SUBTITLE", sourceFormat: "SRT",
  locator: { v: 1, kind: "subtitle", cueStart: 1, cueEnd: 2, startMs: 0, endMs: 1_000 },
  indexNodeId: "node", indexPath: documentId, startMs: 0, endMs: 1_000, text, topic: "突破", keywords: [], scope: "current", citation: "", score: 1, queryIndexes: [0],
});
function options(overrides: Partial<DeepReadingOptions> = {}): DeepReadingOptions {
  const query = overrides.query ?? "比较支撑与阻力";
  return {
    endpoint, model: "vision", skill, query, indexNodeId: "node",
    history: [{ role: "USER", content: query, chartImageId: null, imageContextJson: null }],
    imageDataUrls: new Map(), signal: new AbortController().signal, onProgress: () => {},
    dependencies: {
      catalog: () => [doc("19A"), doc("20A")], currentIds: async () => ["19A"],
      retrieve: async () => ({ candidates: [source("one"), source("two", "20A", "课程20A的阻力测量")], semanticSearchUsed: true }),
      countScope: () => [], readScope: async function* () {},
      complete: async (messages) => messages[0].content.toString().includes("按问题相关性排序")
        ? JSON.stringify({ ids: ["two", "one"] })
        : JSON.stringify({ intent: "comparison", queries: ["支撑与阻力", "测量移动"], targets: [{ documentId: "19A", headingPath: [] }, { documentId: "20A", headingPath: [] }] }),
    }, ...overrides,
  };
}

test("budget reserves final synthesis and charges failed attempts", () => {
  const budget = new DeepReadingBudget({ deepInputTokenBudget: 1_000, deepTotalInputTokenBudget: 1_000, deepMaxOutputTokens: 100 }, 500);
  const messages = [{ role: "user" as const, content: "x".repeat(100) }];
  while (budget.canCall(messages)) budget.charge(messages);
  assert.equal(budget.canCall(messages), false);
  assert.equal(budget.canCall(messages, true), true);
  assert.ok(budget.estimatedInputTokens + 500 <= 1_000);
  budget.charge(messages, true);
  assert.ok(budget.modelCalls <= 10);
});

test("the ten-call ceiling always leaves the last call for synthesis", () => {
  const budget = new DeepReadingBudget({ deepInputTokenBudget: 1_000, deepTotalInputTokenBudget: 100_000, deepMaxOutputTokens: 100 }, 500);
  const messages = [{ role: "user" as const, content: "question" }];
  for (let i = 0; i < 9; i++) budget.charge(messages);
  assert.equal(budget.canCall(messages), false);
  budget.charge(messages, true);
  assert.equal(budget.modelCalls, 10);
  assert.equal(budget.canCall(messages, true), false);
});

test("deduplication merges subqueries and coverage balances named courses", () => {
  const duplicated = { ...source("duplicate"), queryIndexes: [1] };
  const candidates = deduplicateDeepCandidates([source("one"), duplicated, source("two", "20A")]);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0].queryIndexes, [0, 1]);
  const balanced = balanceDeepCandidates([...Array.from({ length: 20 }, (_, i) => source(`a${i}`, "19A", `正文${i}`)), source("other", "20A")], [{ documentId: "20A", headingPath: [] }], 6);
  assert.ok(balanced.some((candidate) => candidate.documentId === "20A"));
});

test("plan validation rejects fabricated documents and chapter paths", () => {
  const plan = { intent: "summary", queries: ["章"], targets: [{ documentId: "missing", headingPath: [] }] };
  assert.throws(() => validateDeepResearchPlan(plan, [doc("19A")]));
  assert.throws(() => validateDeepResearchPlan({ ...plan, targets: [{ documentId: "19A", headingPath: ["不存在的章"] }] }, [doc("19A")]));
});

test("deep synthesis includes both courses and snapshots the configured budgets", async () => {
  const customSkill = { ...skill, deepInputTokenBudget: 24_000, deepTotalInputTokenBudget: 180_000, deepMaxOutputTokens: 8_000 };
  const result = await prepareDeepReading(options({ skill: customSkill }));
  assert.equal(result.context.sources.length, 2);
  assert.equal(result.context.research?.budget.deepMaxOutputTokens, 8_000);
  assert.equal(result.context.research?.modelCalls, 3);
  assert.ok(JSON.stringify(result.messages).includes("[K1]"));
  assert.ok(JSON.stringify(result.messages).includes("[K2]"));
  assert.ok(estimateDeepMessageTokens(result.messages) <= 24_000 * 0.9);
});

test("chapter summaries batch all ordered evidence instead of truncating at eight chunks", async () => {
  const chunks = Array.from({ length: 20 }, (_, i) => source(`chunk${i}`, "19A", `第${i}段正文。${"支撑与阻力".repeat(160)}`));
  const opts = options({ query: "总结整门课程", skill: { ...skill, deepInputTokenBudget: 9_000, deepTotalInputTokenBudget: 100_000 } });
  opts.dependencies = { ...opts.dependencies,
    complete: async (messages) => {
      const instruction = messages[0].content.toString();
      if (instruction.includes("按问题相关性排序")) return JSON.stringify({ ids: ["one", "two"] });
      if (instruction.includes("最多8条")) {
        const markers = [...JSON.stringify(messages[1].content).matchAll(/\[(K\d+)\]/g)].map((match) => match[1]);
        return JSON.stringify({ notes: [{ text: "资料讲解支撑与阻力。", citations: [...new Set(markers)] }] });
      }
      return JSON.stringify({ intent: "summary", queries: ["支撑与阻力"], targets: [{ documentId: "19A", headingPath: [] }] });
    },
    countScope: () => [{ documentId: "19A", versionId: "v-19A", title: "19A", availableChunks: chunks.length }],
    readScope: async function* () { yield* chunks; },
  };
  const result = await prepareDeepReading(opts);
  assert.ok(result.context.sources.length > 8, JSON.stringify(result.context.research));
  assert.equal(result.context.research?.coverage.complete, true);
  assert.equal(result.context.research?.coverage.readChunks, 20);
  assert.ok(result.context.research!.readingBatches > 0 && result.context.research!.readingBatches <= 6);
  assert.ok(result.context.research!.modelCalls <= 10);
  assert.ok(result.context.research!.estimatedInputTokens <= 100_000);
  const finalText = JSON.stringify(result.messages);
  for (const item of result.context.sources) assert.ok(finalText.includes(item.citation));
});

test("insufficient total budget preserves a final answer and reports partial coverage", async () => {
  const opts = options({ skill: { ...skill, deepTotalInputTokenBudget: 16_000 } });
  opts.dependencies = { ...opts.dependencies, retrieve: async () => ({ candidates: Array.from({ length: 100 }, (_, i) => source(`large${i}`, "19A", `段落${i}${"长正文".repeat(500)}`)), semanticSearchUsed: false }) };
  const result = await prepareDeepReading(opts);
  assert.equal(result.context.research?.coverage.complete, false);
  assert.ok(result.context.research!.estimatedInputTokens <= 16_000);
  assert.ok(result.context.research!.warnings.length > 0);
});

test("six reading batches stop an oversized chapter with truthful coverage", async () => {
  const chunks = Array.from({ length: 100 }, (_, i) => source(`chapter${i}`, "19A", `第${i}段正文。${"支撑与阻力".repeat(160)}`));
  const opts = options({ query: "总结整门课程", skill: { ...skill, deepInputTokenBudget: 9_000, deepTotalInputTokenBudget: 200_000 } });
  opts.dependencies = { ...opts.dependencies,
    complete: async (messages) => {
      const instruction = messages[0].content.toString();
      if (instruction.includes("按问题相关性排序")) return JSON.stringify({ ids: ["one", "two"] });
      if (instruction.includes("最多8条")) return JSON.stringify({ notes: [{ text: "本批相关事实", citations: [...new Set([...JSON.stringify(messages[1].content).matchAll(/\[(K\d+)\]/g)].map((match) => match[1]))] }] });
      return JSON.stringify({ intent: "summary", queries: ["支撑与阻力"], targets: [{ documentId: "19A", headingPath: [] }] });
    },
    countScope: () => [{ documentId: "19A", versionId: "v-19A", title: "19A", availableChunks: chunks.length }],
    readScope: async function* () { yield* chunks; },
  };
  const result = await prepareDeepReading(opts);
  assert.equal(result.context.research?.readingBatches, 6);
  assert.equal(result.context.research?.coverage.complete, false);
  assert.ok(result.context.research!.coverage.readChunks < 100);
  assert.ok(result.context.research!.modelCalls <= 10);
  assert.ok(JSON.stringify(result.messages).includes("资料覆盖不完整"));
});

test("book and subtitle synthesis retains original locator and version metadata", async () => {
  const book = { ...source("book-chunk", "book", "书中关于支撑与阻力的解释"), sourceType: "BOOK" as const,
    sourceFormat: "MARKDOWN" as const, locator: { v: 1 as const, kind: "text" as const, lineStart: 12, lineEnd: 24, headingPath: ["第二章", "支撑"] } };
  const opts = options({ query: "综合书籍和字幕中的支撑原理" });
  opts.dependencies = { ...opts.dependencies,
    catalog: () => [doc("19A"), { ...doc("book"), sourceType: "BOOK", headings: [["第二章", "支撑"]] }],
    retrieve: async () => ({ candidates: [source("subtitle"), book], semanticSearchUsed: true }),
    complete: async (messages) => messages[0].content.toString().includes("按问题相关性排序") ? JSON.stringify({ ids: ["book-chunk", "subtitle"] })
      : JSON.stringify({ intent: "synthesis", queries: ["支撑"], targets: [{ documentId: "book", headingPath: ["第二章"] }, { documentId: "19A", headingPath: [] }] }),
  };
  const result = await prepareDeepReading(opts);
  assert.deepEqual(result.context.sources.map((item) => item.sourceType).sort(), ["BOOK", "SUBTITLE"]);
  assert.ok(JSON.stringify(result.messages).includes("第二章"));
  assert.equal(result.context.sources.find((item) => item.id === "book-chunk")?.versionId, "v-book");
});

test("an oversized current question is rejected without silently truncating it", async () => {
  let called = false;
  const opts = options({ query: "问题".repeat(8_000) });
  opts.dependencies = { ...opts.dependencies, complete: async () => { called = true; return "{}"; } };
  await assert.rejects(prepareDeepReading(opts), /当前问题.*超过/);
  assert.equal(called, false);
});

test("changing the input budget changes evidence packing and the reading-batch count", async () => {
  const candidates = Array.from({ length: 12 }, (_, i) => source(`long${i}`, "19A", `第${i}段${"支撑与阻力".repeat(160)}`));
  const run = (input: number) => {
    const opts = options({ skill: { ...skill, deepInputTokenBudget: input, deepTotalInputTokenBudget: 200_000 } });
    opts.dependencies = { ...opts.dependencies,
      retrieve: async () => ({ candidates, semanticSearchUsed: true }),
      complete: async (messages) => {
        const instruction = messages[0].content.toString();
        if (instruction.includes("按问题相关性排序")) return JSON.stringify({ ids: candidates.map((item) => item.id) });
        if (instruction.includes("最多8条")) return JSON.stringify({ notes: [{ text: "相关事实", citations: [...new Set([...JSON.stringify(messages[1].content).matchAll(/\[(K\d+)\]/g)].map((match) => match[1]))] }] });
        return JSON.stringify({ intent: "synthesis", queries: ["支撑与阻力"], targets: [{ documentId: "19A", headingPath: [] }] });
      },
    };
    return prepareDeepReading(opts);
  };
  const small = await run(9_000), large = await run(32_000);
  assert.ok(small.context.research!.readingBatches > 0);
  assert.equal(large.context.research!.readingBatches, 0);
  assert.ok(estimateDeepMessageTokens(small.messages) <= 8_100);
  assert.ok(estimateDeepMessageTokens(large.messages) <= 28_800);
});

test("failed reranking keeps fused evidence and missing target materials remain uncovered", async () => {
  const opts = options();
  opts.dependencies = { ...opts.dependencies,
    retrieve: async () => ({ candidates: [source("one")], semanticSearchUsed: false }),
    complete: async (messages) => messages[0].content.toString().includes("按问题相关性排序")
      ? JSON.stringify({ ids: ["fabricated"] })
      : JSON.stringify({ intent: "comparison", queries: ["支撑"], targets: [{ documentId: "19A", headingPath: [] }, { documentId: "20A", headingPath: [] }] }),
  };
  const result = await prepareDeepReading(opts);
  assert.equal(result.context.sources[0].id, "one");
  assert.equal(result.context.research?.coverage.complete, false);
  assert.ok(result.context.research?.warnings.some((warning) => warning.includes("二次排序失败")));
  assert.ok(result.context.research?.warnings.some((warning) => warning.includes("20A")));
});

test("ambiguity asks for clarification without consuming another model call", async () => {
  const opts = options();
  opts.dependencies = { ...opts.dependencies, complete: async () => JSON.stringify({ intent: "summary", queries: ["章节"], targets: [], clarification: "请提供章节名称。" }) };
  const result = await prepareDeepReading(opts);
  assert.equal(result.clarification, "请提供章节名称。");
  assert.equal(result.context.research?.modelCalls, 1);
});

test("cancelled research cannot fall back to a successful answer", async () => {
  const controller = new AbortController();
  const opts = options({ signal: controller.signal });
  opts.dependencies = { ...opts.dependencies, complete: async () => { controller.abort(); throw new Error("cancelled"); } };
  await assert.rejects(prepareDeepReading(opts), { name: "AbortError" });
});

test("unknown citations are marked and retained snapshots remain independent", () => {
  const saved = [{ ...source("one"), citation: "K1" }];
  const result = validateDeepCitations("事实 [K1]，不存在 [K99]", saved);
  assert.equal(result.invalid, true);
  assert.equal(result.text, "事实 [K1]，不存在 （未验证引用）");
  assert.equal(JSON.parse(JSON.stringify(saved))[0].text, saved[0].text);
  assert.equal(validateDeepCitations("[K1, K99](https://wrong.example) [K1-K2]", saved).text, "[K1] （未验证引用） [K1] （未验证引用）");
});
