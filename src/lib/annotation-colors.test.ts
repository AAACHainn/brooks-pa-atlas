import assert from "node:assert/strict";
import test from "node:test";

import { annotationBaseColors, uniqueAnnotationColors } from "./annotation-colors";

test("used annotation colors are normalized, deduplicated, and limited", () => {
  assert.deepEqual(
    uniqueAnnotationColors(["#111827", "#111827", "#ff0000", "#FF0000", "invalid", "#00B050"], 2),
    ["#111827", "#FF0000"],
  );
});

test("the base palette contains distinct valid hex colors", () => {
  assert.equal(new Set(annotationBaseColors).size, annotationBaseColors.length);
  assert.equal(annotationBaseColors.every((color) => /^#[0-9A-F]{6}$/.test(color)), true);
});
