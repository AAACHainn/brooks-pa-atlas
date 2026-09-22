import assert from "node:assert/strict";
import test from "node:test";

import { shouldDeferEmptyFocusedAnnotationSave } from "./image-annotation-drafts";

const annotations = [
  { id: "empty", text: "" },
  { id: "whitespace", text: "  \n" },
  { id: "filled", text: "Price action" },
];

test("empty annotations are retained only while their editor is focused", () => {
  assert.equal(shouldDeferEmptyFocusedAnnotationSave(annotations, "empty"), true);
  assert.equal(shouldDeferEmptyFocusedAnnotationSave(annotations, "whitespace"), true);
  assert.equal(shouldDeferEmptyFocusedAnnotationSave(annotations, "filled"), false);
  assert.equal(shouldDeferEmptyFocusedAnnotationSave(annotations, null), false);
  assert.equal(shouldDeferEmptyFocusedAnnotationSave(annotations, "missing"), false);
});
