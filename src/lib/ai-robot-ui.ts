import { robotErrorMessage, type RobotLocale, type RobotStreamEvent } from "@/lib/ai-robot-types";

export async function readRobotJson<T>(response: Response, locale: RobotLocale): Promise<T> {
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) {
    const code = typeof value?.code === "string" ? value.code : response.ok ? "invalid_response_body" : "execution_failed";
    throw new Error(robotErrorMessage(code, locale));
  }
  return value as T;
}

export async function fetchRobotJson<T>(url: string, locale: RobotLocale, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...init }); }
  catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error(robotErrorMessage("network_error", locale));
  }
  return readRobotJson<T>(response, locale);
}
export type RobotFrame = { x: number; y: number; width: number; height: number };
export type RobotResize = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export function clampRobotFrame(frame: RobotFrame, viewport: { width: number; height: number }, launcher = false): RobotFrame {
  const margin = 12;
  const width = Math.min(Math.max(launcher ? 52 : 320, frame.width), Math.max(1, viewport.width - margin * 2));
  const height = Math.min(Math.max(launcher ? 52 : 300, frame.height), Math.max(1, viewport.height - margin * 2));
  return { width, height, x: Math.max(margin, Math.min(frame.x, viewport.width - width - margin)), y: Math.max(margin, Math.min(frame.y, viewport.height - height - margin)) };
}
export function resizeRobotFrame(start: RobotFrame, direction: RobotResize, dx: number, dy: number, viewport: { width: number; height: number }) {
  const minW = Math.min(320, viewport.width - 24), minH = Math.min(300, viewport.height - 24);
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (direction.includes("e")) right = Math.min(viewport.width - 12, Math.max(left + minW, right + dx));
  if (direction.includes("s")) bottom = Math.min(viewport.height - 12, Math.max(top + minH, bottom + dy));
  if (direction.includes("w")) left = Math.max(12, Math.min(right - minW, left + dx));
  if (direction.includes("n")) top = Math.max(12, Math.min(bottom - minH, top + dy));
  return clampRobotFrame({ x: left, y: top, width: right - left, height: bottom - top }, viewport);
}
export function parseRobotFrame(value: unknown): RobotFrame | null {
  if (!value || typeof value !== "object") return null;
  const frame = value as RobotFrame;
  return [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.width > 0 && frame.height > 0 ? frame : null;
}
export function robotWasDragged(dx: number, dy: number) { return Math.hypot(dx, dy) >= 6; }

export type RobotDraft = { runId: string; round: number; text: string; reasoning: string; tools: Array<{ id: string; name: string; status: string }> };
export function updateRobotDraft(current: RobotDraft | null, event: RobotStreamEvent): RobotDraft | null {
  if (event.type === "done" || event.type === "error") return null;
  if (event.type !== "trace" && event.type !== "delta") return current;
  const runId = event.type === "delta" ? event.runId : event.record.runId;
  const draft = current?.runId === runId ? current : { runId, round: 0, text: "", reasoning: "", tools: [] };
  if (event.type === "delta") return { ...draft, round: event.round,
    text: event.channel === "content" ? (draft.round === event.round ? draft.text : "") + event.text : draft.text,
    reasoning: event.channel === "reasoning" ? draft.reasoning + event.text : draft.reasoning };
  const record = event.record;
  if (record.type === "model_started") return { ...draft, round: record.round ?? 0, text: "", reasoning: draft.reasoning ? draft.reasoning + "\n\n" : "" };
  if ((record.type === "tool_started" || record.type === "tool_completed") && record.callId) {
    const item = { id: record.callId, name: record.toolName ?? "", status: record.status ?? "running" };
    return { ...draft, tools: [...draft.tools.filter((tool) => tool.id !== item.id), item] };
  }
  return draft;
}

/** NDJSON preserves UTF-8 fragments and requires an explicit terminal event. */
export class RobotStreamError extends Error {}
export async function consumeRobotStream(response: Response, onEvent: (event: RobotStreamEvent) => void, signal: AbortSignal) {
  if (!response.body) throw new RobotStreamError("Empty response stream.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", terminal = false;
  const aborted = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", aborted, { once: true });
  function line(text: string) {
    if (!text.trim()) return;
    if (terminal) throw new RobotStreamError("Unexpected event after completion.");
    let event: RobotStreamEvent;
    try { event = JSON.parse(text) as RobotStreamEvent; } catch { throw new RobotStreamError("Invalid robot event."); }
    if (!event || !["ping", "user_message", "delta", "trace", "done", "error"].includes(event.type)) throw new RobotStreamError("Invalid robot event.");
    if (event.type === "done" || event.type === "error") terminal = true;
    onEvent(event);
  }
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > 2_097_152) throw new RobotStreamError("Robot stream frame is too large.");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
    }
    buffer += decoder.decode(); line(buffer);
    if (!terminal) throw new RobotStreamError("Incomplete robot response.");
  } finally { signal.removeEventListener("abort", aborted); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
