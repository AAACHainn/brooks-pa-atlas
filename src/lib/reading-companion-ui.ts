/** Coalesce frequent updates without losing the final value at gesture/stream end. */
export function createLatestValueScheduler<T>(
  apply: (value: T) => void,
  schedule: (callback: () => void) => number,
  cancelScheduled: (handle: number) => void,
) {
  let handle: number | null = null;
  let pending: { value: T } | null = null;

  function applyPending() {
    handle = null;
    const next = pending;
    pending = null;
    if (next) apply(next.value);
  }

  return {
    queue(value: T) {
      pending = { value };
      if (handle === null) handle = schedule(applyPending);
    },
    flush() {
      if (handle !== null) cancelScheduled(handle);
      applyPending();
    },
    cancel() {
      if (handle !== null) cancelScheduled(handle);
      handle = null;
      pending = null;
    },
  };
}

export function createBufferedReadingText(
  apply: (text: string) => void,
  schedule: (callback: () => void) => number,
  cancelScheduled: (handle: number) => void,
) {
  const updates = createLatestValueScheduler(apply, schedule, cancelScheduled);
  let text = "";
  let disposed = false;
  return {
    append(delta: string) {
      if (disposed || !delta) return;
      text += delta;
      updates.queue(text);
    },
    flush: updates.flush,
    dispose() {
      disposed = true;
      updates.cancel();
    },
  };
}

/** Enter confirms an IME candidate during composition, rather than sending a message. */
export function shouldSendReadingInput(
  event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number },
  composing: boolean,
) {
  return event.key === "Enter" && !event.shiftKey && !composing && !event.isComposing && event.keyCode !== 229;
}
