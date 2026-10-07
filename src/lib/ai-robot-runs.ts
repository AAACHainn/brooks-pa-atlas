import { randomUUID } from "node:crypto";

export type RobotRunLease = { id: string; conversationId: string; controller: AbortController; mutation: boolean; finished: Promise<void>; finish: () => void };
const state = globalThis as typeof globalThis & { brooksAiRobotRuns?: Map<string, RobotRunLease> };
const runs = state.brooksAiRobotRuns ??= new Map<string, RobotRunLease>();

export function acquireRobotRun(conversationId: string): RobotRunLease | null {
  if (runs.has(conversationId)) return null;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const lease = { id: randomUUID(), conversationId, controller: new AbortController(), mutation: false, finished, finish };
  runs.set(conversationId, lease);
  return lease;
}
export function isRobotRunActive(lease: RobotRunLease) {
  return runs.get(lease.conversationId) === lease && !lease.controller.signal.aborted;
}
export function releaseRobotRun(lease: RobotRunLease) {
  if (runs.get(lease.conversationId) === lease) runs.delete(lease.conversationId);
  lease.finish();
}
export function cancelRobotRun(conversationId: string) {
  const lease = runs.get(conversationId);
  if (lease && !lease.mutation) { lease.controller.abort(); runs.delete(conversationId); lease.finish(); }
}
export function cancelAllRobotRuns() {
  for (const id of runs.keys()) cancelRobotRun(id);
}
/** Hold the conversation while clearing/deleting, so a new send cannot race the mutation. */
export async function mutateRobotConversation<T>(conversationId: string, mutation: () => Promise<T>) {
  // Concurrent clear/delete operations also serialize; settings cancellation does not release their lock.
  while (true) {
    const current = runs.get(conversationId);
    if (!current?.mutation) break;
    await current.finished;
  }
  cancelRobotRun(conversationId);
  const lease = acquireRobotRun(conversationId)!;
  lease.mutation = true;
  try { return await mutation(); } finally { releaseRobotRun(lease); }
}
