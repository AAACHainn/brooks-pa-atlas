import assert from "node:assert/strict";
import test from "node:test";

import { previewKnowledgeImportMapping, type KnowledgeMappingNode } from "@/lib/knowledge-import-mapping";

function node(id: string, name: string, branch = "课程 / 19"): KnowledgeMappingNode {
  return { id, name, path: `${branch} / ${name}`, parentId: "parent" };
}

test("a lesson code token in a descriptive subtitle filename selects the exact lesson node", () => {
  const result = previewKnowledgeImportMapping("BTC PAF 19D Support and Resistance.en.srt", [
    node("19", "19"),
    node("19d", "19D"),
    node("19d-0", "19D-0"),
    node("topic", "Support and Resistance"),
  ]);

  assert.equal(result.status, "FUZZY");
  assert.equal(result.selectedIndexNodeId, "19d");
  assert.equal(result.candidates[0].id, "19d");
});

test("lesson code matching uses complete tokens instead of substrings", () => {
  assert.equal(
    previewKnowledgeImportMapping("BTC PAF 119D Support.en.srt", [node("19d", "19D")]).status,
    "UNMATCHED",
  );
  assert.equal(
    previewKnowledgeImportMapping("BTC PAF 19D-0 Support.en.srt", [node("19d", "19D"), node("19d-0", "19D-0")]).selectedIndexNodeId,
    "19d-0",
  );
});

test("duplicate highest-scoring lesson nodes remain ambiguous for manual confirmation", () => {
  const result = previewKnowledgeImportMapping("BTC PAF 19D Support.en.srt", [
    node("first", "19D", "课程 / 第一部分"),
    node("second", "19D", "课程 / 第二部分"),
  ]);

  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.selectedIndexNodeId, null);
  assert.deepEqual(result.candidates.map((candidate) => candidate.id).sort(), ["first", "second"]);
});

test("a unique descriptive fuzzy match is automatically selected", () => {
  const result = previewKnowledgeImportMapping("BTC PAF Support and Resistance.en.srt", [
    node("topic", "Support and Resistance"),
    node("other", "Breakout Pullback"),
  ]);

  assert.equal(result.status, "FUZZY");
  assert.equal(result.selectedIndexNodeId, "topic");
});

test("a full normalized node-name match remains exact", () => {
  const result = previewKnowledgeImportMapping("19D.srt", [node("19d", "19D")]);
  assert.equal(result.status, "EXACT");
  assert.equal(result.selectedIndexNodeId, "19d");
});
