"use client";
type Listener = (origin: string) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
export function notifyReadingChange(origin: string) {
  for (const listener of listeners) listener(origin);
  channel?.postMessage(origin);
}
export function subscribeReadingChanges(listener: Listener) {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("brooks-pa-atlas.reading-changes");
    channel.onmessage = (event: MessageEvent<unknown>) => { if (typeof event.data === "string") for (const callback of listeners) callback(event.data); };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = null; } };
}
