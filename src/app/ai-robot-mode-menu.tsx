"use client";
import { Plus, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RobotMode } from "@/lib/ai-robot-task-types";
export function RobotModeMenu({ mode, browse, disabled, locale, onChange }: { mode: RobotMode; browse: boolean; disabled: boolean; locale: "zh" | "en"; onChange: (mode: RobotMode) => void }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const names = locale === "zh" ? { normal: "普通模式", reading: "阅读伴侣", task: "任务模式" } : { normal: "Normal", reading: "Reading companion", task: "Task mode" };
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className="relative shrink-0 border-t border-zinc-200 bg-white px-3 py-2" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <button ref={trigger} type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}
      className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:opacity-50">
      <Plus className="h-4 w-4" />{names[mode]}
    </button>
    {open ? <div role="menu" aria-label={locale === "zh" ? "聊天模式" : "Chat mode"} className="absolute bottom-full left-3 z-40 mb-2 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl">
      {(["normal", "reading", "task"] as const).map((item) => <button key={item} type="button" role="menuitemradio" aria-checked={mode === item} disabled={item === "reading" && !browse}
        onClick={() => { onChange(item); setOpen(false); trigger.current?.focus(); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-zinc-700 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:text-zinc-400">
        <span className="min-w-0 flex-1">{names[item]}{item === "reading" && !browse ? <span className="block text-[11px]">{locale === "zh" ? "仅在浏览模式可用" : "Available in browse mode"}</span> : null}</span>{mode === item ? <Check className="h-4 w-4 text-cyan-700" /> : null}
      </button>)}
    </div> : null}
  </div>;
}
