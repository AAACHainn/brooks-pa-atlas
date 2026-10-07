type Lease = { controller: AbortController; mutation: boolean; done: Promise<void>; finish: () => void };
const state = globalThis as typeof globalThis & { brooksReadingRuns?: Map<string, Lease> };
const runs = state.brooksReadingRuns ??= new Map<string, Lease>();
export function acquireReadingRun(id: string): Lease | null {
  if (runs.has(id)) return null;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const lease = { controller: new AbortController(), mutation: false, done, finish };
  runs.set(id, lease); return lease;
}
export function releaseReadingRun(id: string, lease: Lease) { if (runs.get(id) === lease) runs.delete(id); lease.finish(); }
export async function mutateReadingConversation<T>(id: string, mutation: () => Promise<T>) {
  while (runs.get(id)?.mutation) await runs.get(id)!.done;
  const old = runs.get(id);
  if (old) { old.controller.abort(); releaseReadingRun(id, old); }
  const lease = acquireReadingRun(id)!; lease.mutation = true;
  try { return await mutation(); } finally { releaseReadingRun(id, lease); }
}
