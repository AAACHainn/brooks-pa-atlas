import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CONFIG_VERSION, DEFAULT_OCR_REFINEMENT_PROMPT, DEFAULT_READING_COMPANION_PROMPT,
  DEFAULT_SUBTITLE_KNOWLEDGE_PROMPT, defaultStoredAiConfig, mergeAiConfigSecrets,
  parseStoredAiConfig, resolveAiEndpointUrls, resolveEmbeddingEndpointUrls, sanitizeAiConfig,
  type AiConfigInput, type StoredAiEndpoint, type StoredEmbeddingEndpoint, aiConfigInputSchema, readingCompanionSkillSchema,
} from "@/lib/ai-config";

function chatEndpoint(overrides: Partial<StoredAiEndpoint> = {}): StoredAiEndpoint {
  return { id: "chat-1", name: "DeepSeek", provider: "deepseek", baseUrl: "https://api.deepseek.com",
    useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "", apiKey: "chat-secret",
    models: ["deepseek-chat"], defaultModel: "deepseek-chat", ...overrides };
}
function embeddingEndpoint(overrides: Partial<StoredEmbeddingEndpoint> = {}): StoredEmbeddingEndpoint {
  return { id: "embedding-1", name: "OpenAI Embeddings", provider: "openai", baseUrl: "https://api.openai.com/v1",
    useCustomUrls: false, embeddingsUrl: "", modelsUrl: "", apiKey: "embedding-secret",
    models: ["text-embedding-3-small"], embeddingModel: "text-embedding-3-small", ...overrides };
}
function input(overrides: Partial<AiConfigInput> = {}): AiConfigInput {
  return { version: AI_CONFIG_VERSION, endpoints: [{ ...chatEndpoint(), apiKey: undefined }],
    embeddingEndpoints: [{ ...embeddingEndpoint(), apiKey: undefined }], activeEndpointId: "chat-1",
    activeEmbeddingEndpointId: "embedding-1",
    skills: { ocrRefinement: { prompt: DEFAULT_OCR_REFINEMENT_PROMPT, modelOverride: "" },
      readingCompanion: defaultStoredAiConfig().skills.readingCompanion,
      subtitleKnowledge: { prompt: DEFAULT_SUBTITLE_KNOWLEDGE_PROMPT, modelOverride: "", retryModelOverride: "", disableReasoning: true, maxOutputTokens: 3000 } }, ...overrides };
}

test("missing or invalid persisted AI config falls back to v4 defaults", () => {
  assert.deepEqual(parseStoredAiConfig(null), defaultStoredAiConfig());
  assert.deepEqual(parseStoredAiConfig("not-json"), defaultStoredAiConfig());
  assert.equal(parseStoredAiConfig("{}").version, 4);
});

test("legacy reading skills gain deep budgets without losing endpoints or prompts", () => {
  const config = input();
  const old = { ...config, skills: { ...config.skills, readingCompanion: { prompt: "custom reading", modelOverride: "vision" } } };
  const parsed = parseStoredAiConfig(JSON.stringify(old));
  assert.equal(parsed.skills.readingCompanion.prompt, "custom reading");
  assert.equal(parsed.skills.readingCompanion.deepInputTokenBudget, 16_000);
  assert.equal(parsed.skills.readingCompanion.deepTotalInputTokenBudget, 100_000);
  assert.equal(parsed.skills.readingCompanion.deepMaxOutputTokens, 4_096);
  assert.equal(parsed.activeEndpointId, "chat-1");
});

test("deep skill budgets round trip through secret merging and sanitized DTOs", () => {
  const draft = input();
  Object.assign(draft.skills.readingCompanion, { deepInputTokenBudget: 32_000, deepTotalInputTokenBudget: 240_000, deepMaxOutputTokens: 8_192 });
  const saved = mergeAiConfigSecrets(aiConfigInputSchema.parse(draft), defaultStoredAiConfig());
  const reread = parseStoredAiConfig(JSON.stringify(saved));
  assert.deepEqual(sanitizeAiConfig(reread).skills.readingCompanion, draft.skills.readingCompanion);
});

test("deep budgets reject non-positive, fractional and inconsistent values", () => {
  const skill = defaultStoredAiConfig().skills.readingCompanion;
  for (const value of [0, -1, 1.5, Infinity]) {
    assert.equal(readingCompanionSkillSchema.safeParse({ ...skill, deepInputTokenBudget: value }).success, false);
  }
  assert.equal(readingCompanionSkillSchema.safeParse({ ...skill, deepTotalInputTokenBudget: 10_000 }).success, false);
});

test("v3 gains bounded metadata-only subtitle processing options", () => {
  const parsed = parseStoredAiConfig(JSON.stringify({
    ...defaultStoredAiConfig(),
    version: 3,
    skills: {
      ...defaultStoredAiConfig().skills,
      subtitleKnowledge: { prompt: DEFAULT_SUBTITLE_KNOWLEDGE_PROMPT, modelOverride: "cheap-chat" },
    },
  }));
  assert.equal(parsed.version, 4);
  assert.equal(parsed.skills.subtitleKnowledge.modelOverride, "cheap-chat");
  assert.equal(parsed.skills.subtitleKnowledge.disableReasoning, true);
  assert.equal(parsed.skills.subtitleKnowledge.maxOutputTokens, 3000);
});

test("v2 migrates chat and embedding providers into separate collections without losing secrets", () => {
  const legacy = { version: 2, endpoints: [{ ...chatEndpoint({ id: "shared" }), embeddingsUrl: "https://embed.example/v1/embeddings", embeddingModel: "embed-v2" }],
    activeEndpointId: "shared", embeddingEndpointId: "shared",
    skills: { ocrRefinement: { prompt: "legacy", modelOverride: "" }, readingCompanion: { prompt: "read", modelOverride: "" }, subtitleKnowledge: { prompt: "subtitle", modelOverride: "" } } };
  const parsed = parseStoredAiConfig(JSON.stringify(legacy));
  assert.equal(parsed.version, 4);
  assert.equal(parsed.endpoints[0].id, "shared");
  assert.equal(parsed.embeddingEndpoints[0].id, "shared");
  assert.equal(parsed.embeddingEndpoints[0].embeddingModel, "embed-v2");
  assert.equal(parsed.endpoints[0].apiKey, "chat-secret");
  assert.equal(parsed.embeddingEndpoints[0].apiKey, "chat-secret");
});

test("v1 gains all skills and does not invent an embedding endpoint", () => {
  const parsed = parseStoredAiConfig(JSON.stringify({ version: 1, endpoints: [chatEndpoint()], activeEndpointId: "chat-1",
    skills: { ocrRefinement: { prompt: "legacy", modelOverride: "" } } }));
  assert.equal(parsed.skills.ocrRefinement.prompt, "legacy");
  assert.equal(parsed.skills.readingCompanion.prompt, DEFAULT_READING_COMPANION_PROMPT);
  assert.equal(parsed.embeddingEndpoints.length, 0);
});

test("chat and embedding secrets are retained, replaced, and cleared independently", () => {
  const current = { ...defaultStoredAiConfig(), endpoints: [chatEndpoint()], embeddingEndpoints: [embeddingEndpoint()],
    activeEndpointId: "chat-1", activeEmbeddingEndpointId: "embedding-1" };
  assert.equal(mergeAiConfigSecrets(input(), current).endpoints[0].apiKey, "chat-secret");
  assert.equal(mergeAiConfigSecrets(input(), current).embeddingEndpoints[0].apiKey, "embedding-secret");
  const changed = mergeAiConfigSecrets(input({ embeddingEndpoints: [{ ...input().embeddingEndpoints[0], apiKey: "new-embedding" }] }), current);
  assert.equal(changed.embeddingEndpoints[0].apiKey, "new-embedding");
  const cleared = mergeAiConfigSecrets(input({ endpoints: [{ ...input().endpoints[0], clearApiKey: true }] }), current);
  assert.equal(cleared.endpoints[0].apiKey, "");
  assert.equal(cleared.embeddingEndpoints[0].apiKey, "embedding-secret");
});

test("subtitle imports cannot re-enable reasoning or raise the hard output limit", () => {
  const current = { ...defaultStoredAiConfig(), endpoints: [chatEndpoint()], embeddingEndpoints: [embeddingEndpoint()],
    activeEndpointId: "chat-1", activeEmbeddingEndpointId: "embedding-1" };
  const unsafe = input({
    skills: {
      ...input().skills,
      subtitleKnowledge: {
        ...input().skills.subtitleKnowledge,
        disableReasoning: false,
        maxOutputTokens: 8_192,
      },
    },
  });
  const merged = mergeAiConfigSecrets(unsafe, current);
  assert.equal(merged.skills.subtitleKnowledge.disableReasoning, true);
  assert.equal(merged.skills.subtitleKnowledge.maxOutputTokens, 3_000);
});

test("sanitized config reports separate readiness without exposing either key", () => {
  const dto = sanitizeAiConfig({ ...defaultStoredAiConfig(), endpoints: [chatEndpoint()], embeddingEndpoints: [embeddingEndpoint()],
    activeEndpointId: "chat-1", activeEmbeddingEndpointId: "embedding-1" });
  assert.equal(dto.ready, true); assert.equal(dto.embeddingReady, true);
  assert.equal(dto.endpoints[0].hasApiKey, true); assert.equal(dto.embeddingEndpoints[0].hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(dto), /chat-secret|embedding-secret/);
});

test("active ids must exist within their own endpoint type", () => {
  assert.throws(() => mergeAiConfigSecrets(input({ activeEndpointId: "missing" }), defaultStoredAiConfig()), /active AI endpoint/i);
  assert.throws(() => mergeAiConfigSecrets(input({ activeEmbeddingEndpointId: "missing" }), defaultStoredAiConfig()), /active embedding endpoint/i);
});

test("chat and embedding URL resolution are independent", () => {
  assert.deepEqual(resolveAiEndpointUrls(chatEndpoint()), { chatCompletionsUrl: "https://api.deepseek.com/chat/completions", modelsUrl: "https://api.deepseek.com/models" });
  assert.deepEqual(resolveEmbeddingEndpointUrls(embeddingEndpoint()), { embeddingsUrl: "https://api.openai.com/v1/embeddings", modelsUrl: "https://api.openai.com/v1/models" });
  assert.deepEqual(resolveEmbeddingEndpointUrls(embeddingEndpoint({ useCustomUrls: true, embeddingsUrl: "http://localhost:11434/api/embed", modelsUrl: "" })), { embeddingsUrl: "http://localhost:11434/api/embed", modelsUrl: "" });
});
