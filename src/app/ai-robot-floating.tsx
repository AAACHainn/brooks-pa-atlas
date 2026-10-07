"use client";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { AiRobotIcon } from "@/app/ai-robot-icon";
import { clampRobotFrame, parseRobotFrame, resizeRobotFrame, robotWasDragged, type RobotFrame, type RobotResize } from "@/lib/ai-robot-ui";
import { createLatestValueScheduler } from "@/lib/reading-companion-ui";

export function robotPreference(key: string, value?: string) {
  try { if (value !== undefined) window.localStorage.setItem("brooks-pa-atlas.aiRobot." + key, value); return window.localStorage.getItem("brooks-pa-atlas.aiRobot." + key); } catch { return null; }
}
function viewport() { return { width: window.innerWidth, height: window.innerHeight }; }
function useFloating(launcher: boolean) {
  const [frame, setFrame] = useState<RobotFrame | null>(null);
  const element = useRef<HTMLElement | null>(null);
  const gesture = useRef<(() => void) | null>(null);
  const preventClick = useRef(false);
  const key = launcher ? "launcher" : "window";
  useEffect(() => {
    const restore = () => {
      let saved: RobotFrame | null = null;
      try { saved = parseRobotFrame(JSON.parse(robotPreference(key) ?? "null")); } catch { /* Invalid preference. */ }
      const initial = launcher ? { x: window.innerWidth - 76, y: window.innerHeight * 0.65, width: 52, height: 52 }
        : { x: window.innerWidth - 464, y: 80, width: 440, height: Math.min(720, window.innerHeight * 0.7) };
      setFrame(clampRobotFrame(saved ?? initial, viewport(), launcher));
    };
    const timer = window.setTimeout(restore, 0);
    const resized = () => setFrame((current) => current ? clampRobotFrame(current, viewport(), launcher) : current);
    window.addEventListener("resize", resized);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", resized); gesture.current?.(); };
  }, [key, launcher]);
  function begin(event: ReactPointerEvent, direction?: RobotResize) {
    if (event.button !== 0 || !frame || !element.current || (event.target as Element).closest("select,textarea,input,a,[data-no-drag]")) return;
    event.preventDefault();
    gesture.current?.();
    const node = element.current, start = frame, x = event.clientX, y = event.clientY;
    let latest = start, moved = false;
    const previousCursor = document.body.style.cursor, previousSelection = document.body.style.userSelect;
    document.body.style.cursor = direction ? `${direction}-resize` : "grabbing";
    document.body.style.userSelect = "none";
    const scheduler = createLatestValueScheduler<RobotFrame>((next) => {
      if (direction) setFrame(next);
      else node.style.transform = `translate3d(${next.x - start.x}px, ${next.y - start.y}px, 0)`;
    }, requestAnimationFrame, cancelAnimationFrame);
    function move(e: PointerEvent) {
      const dx = e.clientX - x, dy = e.clientY - y;
      moved ||= robotWasDragged(dx, dy);
      latest = direction ? resizeRobotFrame(start, direction, dx, dy, viewport()) : clampRobotFrame({ ...start, x: start.x + dx, y: start.y + dy }, viewport(), launcher);
      scheduler.queue(latest);
    }
    function cleanup() {
      scheduler.cancel(); node.style.transform = "";
      document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelection;
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", cancel);
      gesture.current = null;
    }
    function finish(cancelled: boolean) {
      scheduler.flush(); cleanup();
      preventClick.current = moved || cancelled;
      setFrame(latest); robotPreference(key, JSON.stringify(latest));
    }
    function end(e: PointerEvent) { move(e); finish(false); }
    function cancel() { finish(true); }
    gesture.current = cleanup;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true }); window.addEventListener("pointercancel", cancel, { once: true });
  }
  return { frame, begin, attach: (node: HTMLElement | null) => { element.current = node; },
    consumeDrag: () => { const dragged = preventClick.current; preventClick.current = false; return dragged; } };
}
export function RobotLauncher({ locale, busy, onOpen }: { locale: "zh" | "en"; busy: boolean; onOpen: () => void }) {
  const { frame, attach, begin, consumeDrag } = useFloating(true);
  return <button ref={attach} type="button" onPointerDown={(event) => begin(event)}
    onClick={(event) => { const dragged = consumeDrag(); if (event.detail === 0 || !dragged) onOpen(); }}
    aria-label={locale === "zh" ? "打开 AI 机器人" : "Open AI robot"} title={locale === "zh" ? "AI 机器人（可拖动）" : "AI robot (drag to move)"}
    style={frame ? { left: frame.x, top: frame.y, width: 52, height: 52 } : { right: 24, top: "65%", width: 52, height: 52 }}
    className="fixed z-[60] grid touch-none place-items-center rounded-2xl border border-white/40 bg-gradient-to-br from-cyan-500/75 via-sky-600/80 to-blue-700/75 text-white shadow-lg shadow-blue-950/15 ring-1 ring-inset ring-white/20 backdrop-blur-sm transition-colors hover:border-white/70 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2">
    <AiRobotIcon className="h-9 w-9" />{busy ? <span className="absolute right-0 top-0 h-3 w-3 animate-pulse rounded-full border border-white bg-amber-400" /> : null}
  </button>;
}
export function RobotWindow({ locale, minimized, onMinimize, onClose, subtitle, children }: {
  locale: "zh" | "en"; minimized: boolean; onMinimize: () => void; onClose: () => void; subtitle: string; children: ReactNode;
}) {
  const { frame, attach, begin } = useFloating(false), zh = locale === "zh";
  return <section ref={attach} role="dialog" aria-modal="false" aria-label={zh ? "AI 机器人" : "AI robot"}
    style={frame ? { left: frame.x, top: frame.y, width: frame.width, height: minimized ? 52 : frame.height } : { right: 24, top: 80, width: "min(440px,calc(100vw - 24px))", height: minimized ? 52 : "min(70vh,720px)" }}
    className="fixed z-[61] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20">
    <header onPointerDown={(event) => begin(event)} className="flex h-[52px] shrink-0 touch-none cursor-move items-center gap-2 border-b border-zinc-200 bg-zinc-950 px-3 text-white">
      <AiRobotIcon className="h-5 w-5 shrink-0 text-cyan-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{zh ? "AI 机器人" : "AI robot"}</p><p className="truncate text-[10px] text-zinc-400">{subtitle}</p></div>
      <button data-no-drag type="button" onClick={onMinimize} title={zh ? (minimized ? "展开" : "收起") : (minimized ? "Expand" : "Minimize")} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10">{minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
      <button data-no-drag type="button" onClick={onClose} title={zh ? "关闭" : "Close"} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><X className="h-4 w-4" /></button>
    </header>
    <div className={`${minimized ? "hidden" : "flex"} min-h-0 flex-1 flex-col`}>{children}</div>
    {!minimized ? (["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const).map((direction) => <div key={direction} aria-hidden="true" onPointerDown={(event) => begin(event, direction)}
      style={{ cursor: `${direction}-resize` }} className={`absolute z-20 touch-none ${direction === "n" ? "inset-x-3 top-0 h-1" : direction === "s" ? "inset-x-3 bottom-0 h-1" : direction === "e" ? "bottom-3 right-0 top-3 w-1" : direction === "w" ? "bottom-3 left-0 top-3 w-1" : `h-3 w-3 ${direction.includes("n") ? "top-0" : "bottom-0"} ${direction.includes("e") ? "right-0" : "left-0"}`}`} />) : null}
  </section>;
}
