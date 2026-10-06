import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReadingCompanionMessages,
  parseReadingMessageBefore,
  readingConversationTitle,
  readingImageLimit,
  selectRecentReadingImageIds,
  selectReadingImageIdsForQuestion,
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

function switchedImageHistory(question = "翻译这一页") {
  const previous = snapshot("old-stop-chart.png");
  previous.index = { name: "Stops", path: "Encyclopedia / Stops", navigatorAttributes: [] };
  previous.ocr.text = "OLD_OCR: Wait for Strong Signal Bar, Use Appropriate Protective Stop";
  const current = snapshot("new-price-time.png");
  current.index = { name: "Charts", path: "Flash Cards / Charts: Price vs. Time", navigatorAttributes: [] };
  current.ocr.text = "CURRENT_OCR: Charts: Price vs. Time";
  const history: ReadingHistoryMessage[] = [
    { role: "USER", content: "解释上一页", chartImageId: "old", imageContextJson: JSON.stringify(previous) },
    { role: "ASSISTANT", content: "上一页的回答", chartImageId: null, imageContextJson: null },
    { role: "USER", content: question, chartImageId: "current", imageContextJson: JSON.stringify(current) },
  ];
  return { history, imageDataUrls: new Map([["old", "data:image/jpeg;base64,OLD"], ["current", "data:image/jpeg;base64,CURRENT"]]) };
}

test("switching topics sends only the current image and fresh OCR while preserving chat history", () => {
  const { history, imageDataUrls } = switchedImageHistory();
  assert.deepEqual([...selectReadingImageIdsForQuestion(history, "翻译这一页")], ["current"]);
  const messages = buildReadingCompanionMessages({ prompt: "Read charts", history, imageDataUrls });
  assert.equal(messages[2].content, "上一页的回答");
  assert.match(String(messages[1].content), /old-stop-chart/);
  assert.match(String(messages[1].content), /历史参考图/);
  assert.doesNotMatch(String(messages[1].content), /OLD_OCR/);
  const latest = messages.at(-1)!.content;
  assert.ok(Array.isArray(latest));
  assert.equal(latest.filter((part) => part.type === "image_url").length, 1);
  assert.deepEqual(latest.find((part) => part.type === "image_url"), { type: "image_url", image_url: { url: "data:image/jpeg;base64,CURRENT" } });
  assert.match(JSON.stringify(latest), /当前参考图/);
  assert.match(JSON.stringify(latest), /CURRENT_OCR/);
  assert.doesNotMatch(JSON.stringify(messages), /base64,OLD/);
});

test("explicit image comparisons retain historical images and label their separate references", () => {
  for (const question of ["比较当前图片和上一张图", "和刚才的有什么区别？", "回看历史图", "Compare this chart with the previous image", "Compare these two slides", "Revisit the old chart"]) {
    const { history, imageDataUrls } = switchedImageHistory(question);
    assert.deepEqual([...selectReadingImageIdsForQuestion(history, question)], ["current", "old"], question);
    const messages = buildReadingCompanionMessages({ prompt: "Read charts", history, imageDataUrls });
    assert.match(JSON.stringify(messages[1].content), /历史参考图/);
    assert.match(JSON.stringify(messages[1].content), /OLD_OCR/);
    assert.match(JSON.stringify(messages[1].content), /base64,OLD/);
    assert.match(JSON.stringify(messages.at(-1)!.content), /当前参考图/);
    assert.match(JSON.stringify(messages.at(-1)!.content), /base64,CURRENT/);
  }
});

test("generic topic comparisons and explicit current-only instructions do not attach previous images", () => {
  for (const question of ["牛趋势和熊趋势有什么区别？", "只看当前图片，不要使用之前的图", "Only translate the current image; ignore previous images", "解释这一页"]) {
    const { history } = switchedImageHistory(question);
    assert.deepEqual([...selectReadingImageIdsForQuestion(history, question)], ["current"], question);
  }
});

test("revisiting the same image uses its latest snapshot and attaches its pixels only once", () => {
  const { history, imageDataUrls } = switchedImageHistory();
  history[0].chartImageId = "current";
  const messages = buildReadingCompanionMessages({ prompt: "Read charts", history, imageDataUrls });
  assert.doesNotMatch(JSON.stringify(messages[1].content), /OLD_OCR/);
  assert.match(JSON.stringify(messages.at(-1)!.content), /CURRENT_OCR/);
  assert.equal(JSON.stringify(messages).split('"type":"image_url"').length - 1, 1);
});

test("historical comparisons keep the current image within the four-image limit", () => {
  const history: ReadingHistoryMessage[] = Array.from({ length: 8 }, (_, index) => ({
    role: "USER", content: index === 7 ? "比较这几张图片" : "解释图片", chartImageId: `image-${index}`, imageContextJson: null,
  }));
  assert.deepEqual([...selectReadingImageIdsForQuestion(history, history.at(-1)!.content)], ["image-7", "image-6", "image-5", "image-4"]);
});
