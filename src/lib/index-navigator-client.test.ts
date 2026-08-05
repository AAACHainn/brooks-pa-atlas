import assert from "node:assert/strict";
import test from "node:test";

import {
  addNavigatorMatchCounts,
  buildNavigatorAssignmentIndex,
  findLocalNavigatorResults,
  normalizeNavigatorSelection,
  type NavigatorCategoryBase,
} from "./index-navigator-client";

const categories: NavigatorCategoryBase[] = [
  {
    id: "gap",
    name: "Gap",
    sortOrder: 0,
    assignmentCount: 3,
    options: [
      { id: "gu", categoryId: "gap", name: "GU", sortOrder: 0, assignmentCount: 2 },
      { id: "gd", categoryId: "gap", name: "GD", sortOrder: 1, assignmentCount: 1 },
    ],
  },
  {
    id: "setup",
    name: "Setup",
    sortOrder: 1,
    assignmentCount: 3,
    options: [
      { id: "buy", categoryId: "setup", name: "Buy", sortOrder: 0, assignmentCount: 2 },
      { id: "sell", categoryId: "setup", name: "Sell", sortOrder: 1, assignmentCount: 1 },
    ],
  },
];

const assignments = [
  { indexNodeId: "n1", optionId: "gu" },
  { indexNodeId: "n1", optionId: "buy" },
  { indexNodeId: "n2", optionId: "gu" },
  { indexNodeId: "n2", optionId: "sell" },
  { indexNodeId: "n3", optionId: "gd" },
  { indexNodeId: "n3", optionId: "buy" },
];

const nodes = [
  { id: "n1", name: "10", path: "Root / 10", depth: 1, imageCount: 2 },
  { id: "n2", name: "2", path: "Root / 2", depth: 1, imageCount: 3 },
  { id: "n3", name: "Other", path: "Other", depth: 0, imageCount: 1 },
];

test("unselected match counts equal valid direct assignments", () => {
  const index = buildNavigatorAssignmentIndex(assignments);
  const result = addNavigatorMatchCounts(categories, index, [], new Set(nodes.map((node) => node.id)));
  assert.deepEqual(
    result.flatMap((category) => category.options.map((option) => [option.id, option.matchCount])),
    [["gu", 2], ["gd", 1], ["buy", 2], ["sell", 1]],
  );
});

test("same-category candidates remain replaceable while other categories use AND", () => {
  const index = buildNavigatorAssignmentIndex(assignments);
  const result = addNavigatorMatchCounts(categories, index, ["gu", "buy"]);
  const counts = new Map(result.flatMap((category) => category.options.map((option) => [option.id, option.matchCount])));
  assert.equal(counts.get("gu"), 1);
  assert.equal(counts.get("gd"), 1);
  assert.equal(counts.get("buy"), 1);
  assert.equal(counts.get("sell"), 1);

  const zeroCombination = addNavigatorMatchCounts(categories, index, ["gu", "sell"]);
  const zeroCounts = new Map(
    zeroCombination.flatMap((category) =>
      category.options.map((option) => [option.id, option.matchCount]),
    ),
  );
  assert.equal(zeroCounts.get("gd"), 0);
});

test("selection normalization keeps at most one existing option per category", () => {
  assert.deepEqual([...normalizeNavigatorSelection(categories, ["missing", "gd", "gu", "buy"])], ["gu", "buy"]);
});

test("local results preserve AND semantics, natural sorting, search, and pagination", () => {
  const index = buildNavigatorAssignmentIndex(assignments);
  const guResults = findLocalNavigatorResults(nodes, categories, index, ["gu"], "", 1, 50);
  assert.deepEqual(guResults.results.map((node) => node.id), ["n2", "n1"]);

  const andResults = findLocalNavigatorResults(nodes, categories, index, ["gu", "buy"], "", 1, 50);
  assert.deepEqual(andResults.results.map((node) => node.id), ["n1"]);

  const searchResults = findLocalNavigatorResults(nodes, categories, index, [], "other", 1, 1);
  assert.deepEqual(searchResults.results.map((node) => node.id), ["n3"]);
  assert.equal(searchResults.pagination.total, 1);
});
