import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CONFIG_VERSION,
  DEFAULT_OCR_REFINEMENT_PROMPT,
  defaultStoredAiConfig,
  mergeAiConfigSecrets,
  parseStoredAiConfig,
  resolveAiEndpointUrls,
  sanitizeAiConfig,
  type AiConfigInput,
  type StoredAiEndpoint,
} from "@/lib/ai-config";

function endpoint(overrides: Partial<StoredAiEndpoint> = {}): StoredAiEndpoint {
  return {
    id: "endpoint-1",
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1/",
    useCustomUrls: false,
    chatCompletionsUrl: "",
    modelsUrl: "",
    apiKey: "secret-key",
    models: ["model-b", "model-a"],
    defaultModel: "model-a",
    ...overrides,
  };
}

function input(overrides: Partial<AiConfigInput> = {}): AiConfigInput {
  return {
    version: AI_CONFIG_VERSION,
    endpoints: [
      {
        ...endpoint(),
        apiKey: undefined,
      },
    ],
    activeEndpointId: "endpoint-1",
    skills: {
      ocrRefinement: { prompt: DEFAULT_OCR_REFINEMENT_PROMPT, modelOverride: "" },
    },
    ...overrides,
  };
}

test("missing or invalid persisted AI config falls back to the built-in skill", () => {
  assert.deepEqual(parseStoredAiConfig(null), defaultStoredAiConfig());
  assert.deepEqual(parseStoredAiConfig("not-json"), defaultStoredAiConfig());
  assert.equal(
    parseStoredAiConfig("{}").skills.ocrRefinement.prompt,
    DEFAULT_OCR_REFINEMENT_PROMPT,
  );
});

test("saving retains, replaces, and explicitly clears endpoint secrets", () => {
  const current = { ...defaultStoredAiConfig(), endpoints: [endpoint()], activeEndpointId: "endpoint-1" };
  assert.equal(mergeAiConfigSecrets(input(), current).endpoints[0].apiKey, "secret-key");
  assert.equal(
    mergeAiConfigSecrets(
      input({ endpoints: [{ ...input().endpoints[0], apiKey: "replacement" }] }),
      current,
    ).endpoints[0].apiKey,
    "replacement",
  );
  assert.equal(
    mergeAiConfigSecrets(
      input({ endpoints: [{ ...input().endpoints[0], clearApiKey: true }] }),
      current,
    ).endpoints[0].apiKey,
    "",
  );
});

test("sanitized config never returns API key material and reports readiness", () => {
  const dto = sanitizeAiConfig({
    ...defaultStoredAiConfig(),
    endpoints: [endpoint()],
    activeEndpointId: "endpoint-1",
  });
  assert.equal(dto.ready, true);
  assert.equal(dto.endpoints[0].hasApiKey, true);
  assert.equal("apiKey" in dto.endpoints[0], false);
  assert.doesNotMatch(JSON.stringify(dto), /secret-key/);
});

test("active endpoint must exist and endpoint ids must be unique", () => {
  assert.throws(
    () => mergeAiConfigSecrets(input({ activeEndpointId: "missing" }), defaultStoredAiConfig()),
    /active AI endpoint/i,
  );
  assert.throws(
    () =>
      mergeAiConfigSecrets(
        input({ endpoints: [input().endpoints[0], input().endpoints[0]] }),
        defaultStoredAiConfig(),
      ),
    /unique/i,
  );
});

test("endpoint URL resolution supports base and full URL modes", () => {
  assert.deepEqual(resolveAiEndpointUrls(endpoint()), {
    chatCompletionsUrl: "https://api.openai.com/v1/chat/completions",
    modelsUrl: "https://api.openai.com/v1/models",
  });
  assert.deepEqual(
    resolveAiEndpointUrls(
      endpoint({
        useCustomUrls: true,
        chatCompletionsUrl: "http://localhost:11434/api/chat",
        modelsUrl: "http://localhost:11434/api/tags",
      }),
    ),
    {
      chatCompletionsUrl: "http://localhost:11434/api/chat",
      modelsUrl: "http://localhost:11434/api/tags",
    },
  );
  assert.throws(
    () => resolveAiEndpointUrls(endpoint({ baseUrl: "file:///tmp/model" })),
    /valid AI API base URL/i,
  );
});
