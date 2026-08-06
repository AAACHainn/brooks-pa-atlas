import assert from "node:assert/strict";
import test from "node:test";

import { buildImageQueryKey } from "@/lib/image-query-key";

test("image query keys are stable for set insertion order", () => {
  const base = {
    query: "  wedge  ",
    selectedIndexId: "node-1",
    page: 2,
    pageSize: 50,
  };
  const left = buildImageQueryKey({
    ...base,
    selectedTagIds: new Set(["tag-b", "tag-a"]),
    selectedNavigatorOptionIds: new Set(["option-b", "option-a"]),
  });
  const right = buildImageQueryKey({
    ...base,
    selectedTagIds: new Set(["tag-a", "tag-b"]),
    selectedNavigatorOptionIds: new Set(["option-a", "option-b"]),
  });
  assert.equal(left, right);
  assert.match(left, /q=wedge/);
  assert.match(left, /page=2/);
});

test("any image filter or page change produces a new key", () => {
  const input = {
    query: "",
    selectedIndexId: null,
    selectedTagIds: [] as string[],
    selectedNavigatorOptionIds: [] as string[],
    page: 1,
    pageSize: 50,
  };
  const initial = buildImageQueryKey(input);
  assert.notEqual(buildImageQueryKey({ ...input, query: "x" }), initial);
  assert.notEqual(buildImageQueryKey({ ...input, selectedIndexId: "node" }), initial);
  assert.notEqual(buildImageQueryKey({ ...input, selectedTagIds: ["tag"] }), initial);
  assert.notEqual(buildImageQueryKey({ ...input, selectedNavigatorOptionIds: ["option"] }), initial);
  assert.notEqual(buildImageQueryKey({ ...input, page: 2 }), initial);
  assert.notEqual(buildImageQueryKey({ ...input, pageSize: 25 }), initial);
});
