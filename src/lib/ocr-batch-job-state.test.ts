import assert from "node:assert/strict";
import test from "node:test";

import {
  hasExistingOcrText,
  ocrBatchProgressPercent,
  ocrBatchTerminalStatus,
} from "@/lib/ocr-batch-job-state";

test("existing OCR text ignores null, empty, and whitespace-only values", () => {
  assert.equal(hasExistingOcrText(null), false);
  assert.equal(hasExistingOcrText(""), false);
  assert.equal(hasExistingOcrText("  \n"), false);
  assert.equal(hasExistingOcrText("price action"), true);
});

test("terminal status distinguishes success, partial failure, and total failure", () => {
  assert.equal(ocrBatchTerminalStatus(3, 0), "COMPLETED");
  assert.equal(ocrBatchTerminalStatus(2, 1), "COMPLETED_WITH_ERRORS");
  assert.equal(ocrBatchTerminalStatus(0, 3), "FAILED");
});

test("progress remains below 100 until every image is processed", () => {
  assert.equal(ocrBatchProgressPercent(0, 0), 0);
  assert.equal(ocrBatchProgressPercent(1, 3), 33);
  assert.equal(ocrBatchProgressPercent(2, 3), 67);
  assert.equal(ocrBatchProgressPercent(3, 3), 100);
});
