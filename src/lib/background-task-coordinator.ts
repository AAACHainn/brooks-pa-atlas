export type HeavyTaskKind = "knowledge-import" | "knowledge-embeddings" | "document-import" | "ocr-batch" | "thumbnails" | "ai-deep-reading";

type HeavyTaskLease = { kind: HeavyTaskKind; id: string };

const globalForHeavyTasks = globalThis as typeof globalThis & {
  brooksHeavyTaskLease?: HeavyTaskLease;
};

export class HeavyTaskBusyError extends Error {
  constructor(readonly active: HeavyTaskLease) {
    super(`后台重任务 ${active.kind} 正在运行，请等待完成后再试。`);
  }
}

export function acquireHeavyTask(kind: HeavyTaskKind, id: string) {
  const active = globalForHeavyTasks.brooksHeavyTaskLease;
  if (active && (active.kind !== kind || active.id !== id)) return false;
  globalForHeavyTasks.brooksHeavyTaskLease = { kind, id };
  return true;
}

export function acquireHeavyTaskOrThrow(kind: HeavyTaskKind, id: string) {
  if (!acquireHeavyTask(kind, id)) {
    throw new HeavyTaskBusyError(globalForHeavyTasks.brooksHeavyTaskLease!);
  }
}

export function releaseHeavyTask(kind: HeavyTaskKind, id: string) {
  const active = globalForHeavyTasks.brooksHeavyTaskLease;
  if (active?.kind === kind && active.id === id) delete globalForHeavyTasks.brooksHeavyTaskLease;
}

export function currentHeavyTask() {
  return globalForHeavyTasks.brooksHeavyTaskLease ?? null;
}
