import assert from "node:assert/strict";
import test from "node:test";

import {
  createKnowledgeTextChunks,
  decodeKnowledgeText,
  KNOWLEDGE_TEXT_MAX_CHARACTERS,
  parseKnowledgeText,
} from "@/lib/knowledge-text";

test("Markdown headings create deterministic text locators and fenced pseudo-headings stay in the body", () => {
  const source = "# 第一章\n\n第一段。\n\n```md\n# 不是标题\n```\n\n小节\n----\n\n第二段。";
  const first = createKnowledgeTextChunks(parseKnowledgeText(source, true));
  const second = createKnowledgeTextChunks(parseKnowledgeText(source, true));
  assert.deepEqual(first, second);
  assert.equal(first[0].locator.kind, "text");
  assert.deepEqual(first[0].locator.headingPath, ["第一章"]);
  assert.match(first.map((chunk) => chunk.cleanedText).join("\n"), /# 不是标题/);
  assert.deepEqual(first.at(-1)?.locator.headingPath, ["第一章", "小节"]);
  assert.equal(first.at(-1)?.locator.lineStart, 12);
  assert.equal(first.at(-1)?.locator.lineEnd, 12);
});

test("TXT paragraphs preserve order and long paragraphs stay under the hard limit", () => {
  const source = `第一段。\n\n${"很长的一句话。".repeat(400)}\n\n最后一段。`;
  const chunks = createKnowledgeTextChunks(parseKnowledgeText(source, false));
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.cleanedText.length <= KNOWLEDGE_TEXT_MAX_CHARACTERS));
  const joined = chunks.map((chunk) => chunk.cleanedText).join("\n\n");
  assert.ok(joined.indexOf("第一段。") < joined.indexOf("最后一段。"));
  assert.equal(joined.replace(/\s/g, ""), source.replace(/\s/g, ""));
});

test("generic text decoding accepts UTF-8 BOM and rejects invalid UTF-8 or empty content", () => {
  assert.equal(decodeKnowledgeText(Buffer.from([0xef, 0xbb, 0xbf, 0x41])).replace(/^\uFEFF/, ""), "A");
  assert.throws(() => decodeKnowledgeText(Buffer.from([0xc3, 0x28])), /UTF-8/);
  assert.throws(() => parseKnowledgeText(" \n\n ", false), /为空/);
});
