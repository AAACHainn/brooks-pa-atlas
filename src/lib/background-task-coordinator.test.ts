import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireHeavyTask,
  currentHeavyTask,
  releaseHeavyTask,
} from "@/lib/background-task-coordinator";

test("heavy background work is mutually exclusive and only its owner can release it", () => {
  assert.equal(acquireHeavyTask("knowledge-import", "knowledge-1"), true);
  assert.equal(acquireHeavyTask("knowledge-import", "knowledge-1"), true);
  assert.equal(acquireHeavyTask("thumbnails", "thumb-1"), false);
  releaseHeavyTask("thumbnails", "thumb-1");
  assert.deepEqual(currentHeavyTask(), { kind: "knowledge-import", id: "knowledge-1" });
  releaseHeavyTask("knowledge-import", "knowledge-1");
  assert.equal(currentHeavyTask(), null);
  assert.equal(acquireHeavyTask("ocr-batch", "ocr-1"), true);
  releaseHeavyTask("ocr-batch", "ocr-1");
});
