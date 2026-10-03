import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReadingCompanionMessages,
  parseReadingMessageBefore,
  readingConversationTitle,
  readingImageLimit,
  selectRecentReadingImageIds,
  selectRecentReadingMessages,
  serializeReadingMessage,
  type ReadingHistoryMessage,
  type ReadingImageSnapshot,
} from "@/lib/ai-reading-companion";

test("message history pagination leaves a missing cursor unbounded", () => {
  assert.equal(parseReadingMessageBefore(null), null);
  assert.equal(parseReadingMessageBefore(""), null);
  assert.equal(parseReadingMessageBefore("not-a-number"), null);
  assert.equal(parseReadingMessageBefore("0"), 0);
  assert.equal(parseReadingMessageBefore("50"), 50);
});

function snapshot(name: string): ReadingImageSnapshot {
  return {
    title: "Chart title",
    originalName: name,
    tags: ["breakout"],
    notes: "user note",
    ocr: { status: "COMPLETED", text: "OCR text", updatedAt: null },
    annotations: [{
      text: "measured move",
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      fontSize: 18,
      color: "#111827",
      backgroundColor: null,
      sortOrder: 0,
    }],
    index: {
      name: "Chapter",
      path: "Book / Chapter",
      navigatorAttributes: [{ category: "Market", values: ["Trend"] }],
    },
    technical: {
      mimeType: "image/png",
      sizeBytes: 100,
      width: 1200,
      height: 800,
      hash: "a".repeat(64),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  };
}

test("conversation titles normalize whitespace and stop at 40 characters", () => {
  assert.equal(readingConversationTitle("  explain\n this chart  "), "explain this chart");
  assert.equal([...readingConversationTitle("图".repeat(50))].length, 40);
});

test("serialized assistant messages retain visible reasoning and duration", () => {
  const serialized = serializeReadingMessage({
    id: "assistant-1",
    role: "ASSISTANT",
    sequence: 1,
    content: "Answer",
    reasoningContent: "Visible provider reasoning",
    reasoningDurationMs: 1250,
    imageContextJson: null,
    createdAt: new Date("2026-09-29T00:00:00.000Z"),
    chartImage: null,
  });
  assert.equal(serialized.reasoningContent, "Visible provider reasoning");
  assert.equal(serialized.reasoningDurationMs, 1250);
  assert.equal(serialized.answerMode, "quick");
});

test("reading messages include untrusted context and multimodal image data", () => {
  const context = snapshot("chart.png");
  const history: ReadingHistoryMessage[] = [{
    role: "USER",
    content: "Translate this",
    chartImageId: "image-1",
    imageContextJson: JSON.stringify(context),
  }];
  const messages = buildReadingCompanionMessages({
    prompt: "Read charts",
    history,
    imageDataUrls: new Map([["image-1", "data:image/jpeg;base64,AA=="]]),
  });
  assert.match(String(messages[0].content), /不可信/);
  assert.ok(Array.isArray(messages[1].content));
  const text = JSON.stringify(messages[1].content);
  assert.match(text, /measured move/);
  assert.match(text, /Book \/ Chapter/);
  assert.match(text, /Market/);
  assert.match(text, /data:image\/jpeg/);
});

test("recent context keeps at most 40 messages and four distinct images", () => {
  const history: ReadingHistoryMessage[] = Array.from({ length: 50 }, (_, index) => ({
    role: index % 2 === 0 ? "USER" : "ASSISTANT",
    content: `message ${index}`,
    chartImageId: index % 2 === 0 ? `image-${index}` : null,
    imageContextJson: null,
  }));
  const selected = selectRecentReadingMessages(history);
  assert.ok(selected.length <= 40);
  assert.equal(selectRecentReadingImageIds(selected).size, readingImageLimit);
});

test("recent context stops before exceeding the text budget but always keeps the latest message", () => {
  const history: ReadingHistoryMessage[] = [
    { role: "USER", content: "a".repeat(40_000), chartImageId: null, imageContextJson: null },
    { role: "ASSISTANT", content: "b".repeat(40_000), chartImageId: null, imageContextJson: null },
    { role: "USER", content: "latest", chartImageId: null, imageContextJson: null },
  ];
  const selected = selectRecentReadingMessages(history);
  assert.equal(selected.at(-1)?.content, "latest");
  assert.ok(selected.length < history.length);
});
