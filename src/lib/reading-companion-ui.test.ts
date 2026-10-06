import assert from "node:assert/strict";
import test from "node:test";

import { createBufferedReadingText, createLatestValueScheduler, shouldSendReadingInput } from "./reading-companion-ui";

function manualClock() {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  return {
    schedule(callback: () => void) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle: number) { callbacks.delete(handle); },
    tick() {
      const scheduled = [...callbacks.values()];
      callbacks.clear();
      scheduled.forEach((callback) => callback());
    },
    get pendingCount() { return callbacks.size; },
  };
}

test("a burst of pointer updates applies only the latest coordinates on the next frame", () => {
  const clock = manualClock();
  const frames: Array<{ x: number; y: number }> = [];
  const updates = createLatestValueScheduler((frame: { x: number; y: number }) => frames.push(frame), clock.schedule, clock.cancel);
  for (let x = 0; x < 100; x++) updates.queue({ x, y: x * 2 });
  assert.equal(clock.pendingCount, 1);
  assert.deepEqual(frames, []);
  clock.tick();
  assert.deepEqual(frames, [{ x: 99, y: 198 }]);
  updates.queue({ x: 100, y: 200 });
  clock.tick();
  assert.equal(frames.length, 2);
});

test("ending a gesture before the next frame retains the final position exactly once", () => {
  const clock = manualClock();
  const applied: number[] = [];
  const updates = createLatestValueScheduler((value: number) => applied.push(value), clock.schedule, clock.cancel);
  updates.queue(10);
  updates.queue(20);
  updates.flush();
  clock.tick();
  updates.flush();
  assert.deepEqual(applied, [20]);
  assert.equal(clock.pendingCount, 0);
});

test("closing a window cancels a queued update and a new gesture can still run", () => {
  const clock = manualClock();
  const applied: number[] = [];
  const updates = createLatestValueScheduler((value: number) => applied.push(value), clock.schedule, clock.cancel);
  updates.queue(1);
  updates.cancel();
  clock.tick();
  assert.deepEqual(applied, []);
  updates.queue(2);
  clock.tick();
  assert.deepEqual(applied, [2]);
});

test("coalescing stream deltas preserves Chinese, emoji, Markdown and every character", () => {
  const clock = manualClock();
  const displayed: string[] = [];
  const stream = createBufferedReadingText((text) => displayed.push(text), clock.schedule, clock.cancel);
  const deltas = ["中文", " **分析", "**\n", "😀", "```ts\n", "const n = 1;\n", "```"];
  deltas.slice(0, 4).forEach(stream.append);
  assert.equal(clock.pendingCount, 1);
  clock.tick();
  assert.deepEqual(displayed, [deltas.slice(0, 4).join("")]);
  deltas.slice(4).forEach(stream.append);
  stream.flush();
  clock.tick();
  assert.deepEqual(displayed, [deltas.slice(0, 4).join(""), deltas.join("")]);
});

test("completion, failure and stop discard pending drafts without later resurrecting them", () => {
  for (const outcome of ["complete", "failure", "stop"]) {
    const clock = manualClock();
    const displayed: string[] = [];
    const stream = createBufferedReadingText((text) => displayed.push(text), clock.schedule, clock.cancel);
    stream.append(`${outcome}: first`);
    clock.tick();
    stream.append(" unfinished tail");
    stream.dispose();
    stream.dispose();
    stream.append(" late delta");
    stream.flush();
    clock.tick();
    assert.deepEqual(displayed, [`${outcome}: first`]);
    assert.equal(clock.pendingCount, 0);
  }
});

test("Enter sends, while Shift+Enter keeps its newline behavior", () => {
  const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };
  assert.equal(shouldSendReadingInput(enter, false), true);
  assert.equal(shouldSendReadingInput({ ...enter, shiftKey: true }, false), false);
  assert.equal(shouldSendReadingInput({ ...enter, key: "a", keyCode: 65 }, false), false);
});

test("IME candidate confirmation cannot send, including composition boundary events", () => {
  const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };
  assert.equal(shouldSendReadingInput(enter, true), false);
  assert.equal(shouldSendReadingInput({ ...enter, isComposing: true }, false), false);
  assert.equal(shouldSendReadingInput({ ...enter, keyCode: 229 }, false), false);
  assert.equal(shouldSendReadingInput(enter, false), true);
});
