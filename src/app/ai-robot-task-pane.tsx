"use client";
import { Loader2, MessageSquarePlus, PencilLine, Trash2, X, Send } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppDialog } from "@/app/app-dialog";
import { robotPreference } from "@/app/ai-robot-floating";
import { fetchRobotJson } from "@/lib/ai-robot-ui";
import { shouldSendReadingInput } from "@/lib/reading-companion-ui";
import type { RobotConversation, RobotSelection } from "@/lib/ai-robot-types";
import type { TaskSnapshot } from "@/lib/ai-robot-task-types";
const api = "/api/ai/robot/conversations", plugins = [remarkGfm];
const button = "rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:opacity-50";
const TaskText = memo(function TaskText({ content }: { content: string }) { return <ReactMarkdown remarkPlugins={plugins}>{content}</ReactMarkdown>; });
function TaskCard({ task, locale, busy, onAction, onEvidence }: { task: TaskSnapshot; locale: "zh" | "en"; busy: boolean; onAction: (task: TaskSnapshot, action: "start" | "pause" | "resume" | "cancel") => void; onEvidence: (id: string) => void }) {
  const zh = locale === "zh", running = ["planning", "running"].includes(task.status);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  useEffect(() => { if (evidenceOpen && task.checkpoints.length < task.checkpointCount) onEvidence(task.id); }, [evidenceOpen, task.id, task.checkpointCount, task.checkpoints.length, onEvidence]);
  const labels: Record<string, string> = zh ? { planning: "制定计划", awaiting_confirmation: "等待确认计划", running: "执行中", paused: "已暂停", completed: "已完成", failed: "失败，可重试", cancelled: "已取消" } : { planning: "Planning", awaiting_confirmation: "Confirm plan", running: "Running", paused: "Paused", completed: "Completed", failed: "Failed — retry available", cancelled: "Cancelled" };
  return <article className="rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm">
    <p className="whitespace-pre-wrap font-medium text-zinc-800">{task.goal}</p>
    <p role="status" className="my-2 flex items-center gap-2 text-xs text-cyan-800">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{labels[task.status] ?? task.status} · {task.completedBatches}/{task.totalBatches} {zh ? "资料批次" : "source batches"} · {task.completedSources}/{task.totalSources} {zh ? "资料页" : "source pages"}</p>
    {task.plan ? <details open={task.status === "awaiting_confirmation"} className="mb-2 rounded-md border border-cyan-100 bg-cyan-50/40 p-2">
      <summary className="cursor-pointer text-xs font-medium text-cyan-900">{task.plan.title} · v{task.planVersion}</summary>
      <p className="mt-2 text-xs text-zinc-600">{zh ? "范围：" : "Scope: "}{task.scopeLabel}</p>
      <ol className="my-2 list-decimal space-y-1 pl-5 text-xs text-zinc-700">{task.plan.steps.map((step, index) => <li key={index}>{step} · {task.status === "completed" || index < task.currentStep ? (zh ? "完成" : "Done") : index === task.currentStep && task.status === "running" ? (zh ? "进行中" : "Running") : (zh ? "待执行" : "Pending")}</li>)}</ol>
      <p className="whitespace-pre-wrap text-xs leading-5 text-zinc-600">{task.plan.approach}</p>
    </details> : null}
    {task.totalBatches ? <progress aria-label={zh ? "资料读取进度" : "Source reading progress"} value={task.completedBatches} max={task.totalBatches} className="mb-2 h-1.5 w-full accent-cyan-700" /> : null}
    <p className="text-[11px] text-zinc-500">{zh ? "模型" : "Model"} {task.budget.modelCalls} · {zh ? "工具" : "Tools"} {task.budget.toolCalls} · Token {task.budget.inputTokens.toLocaleString()} · {(task.budget.elapsedMs / 1000).toFixed(1)}s</p>
    {task.checkpointCount ? <details onToggle={(event) => setEvidenceOpen(event.currentTarget.open)} className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">{zh ? "检查点与证据" : "Checkpoints and evidence"} ({task.checkpointCount})</summary>
      {task.checkpoints.map((checkpoint) => <details key={checkpoint.ordinal} className="mt-2 rounded-md border border-zinc-100 bg-zinc-50 p-2"><summary className="cursor-pointer">{checkpoint.kind === "read" ? (zh ? "资料批次" : "Source batch") : (zh ? "汇总检查点" : "Reduction checkpoint")} {checkpoint.ordinal + 1}</summary>
        <div className="mt-2 whitespace-pre-wrap leading-5">{checkpoint.summary}</div>
        {checkpoint.sources.map((source) => <details key={source.citation} className="mt-2 border-t border-zinc-200 pt-2"><summary className="cursor-pointer text-cyan-800">[{source.citation}] {source.title}{source.location ? ` · ${source.location}` : ""}{source.version ? ` · ${source.version}` : ""}</summary><p className="mt-1 whitespace-pre-wrap leading-5">{source.text}</p></details>)}
      </details>)}
    </details> : null}
    {task.error ? <p role="alert" className="mt-2 whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{task.error}</p> : null}
    {task.result ? <div className="mt-3 break-words text-sm leading-6 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-2"><TaskText content={task.result} /></div> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {task.status === "awaiting_confirmation" ? <button type="button" disabled={busy} onClick={() => onAction(task, "start")} className={`${button} border-cyan-700 bg-cyan-700 text-white hover:bg-cyan-800`}>{zh ? "开始执行" : "Start"}</button> : null}
      {running ? <button type="button" disabled={busy} onClick={() => onAction(task, "pause")} className={button}>{zh ? "暂停" : "Pause"}</button> : null}
      {["paused", "failed"].includes(task.status) ? <button type="button" disabled={busy} onClick={() => onAction(task, "resume")} className={button}>{zh ? (task.plan ? "继续" : "继续制定计划") : "Continue"}</button> : null}
      {!["completed", "cancelled"].includes(task.status) ? <button type="button" disabled={busy} onClick={() => onAction(task, "cancel")} className={`${button} border-rose-200 text-rose-700`}>{zh ? "取消任务" : "Cancel task"}</button> : null}
    </div>
  </article>;
}
export function RobotTaskPane({ active, enabled, configured, locale, selection, onSettings, onRunning }: { active: boolean; enabled: boolean; configured: boolean; locale: "zh" | "en"; selection: RobotSelection; onSettings: () => void; onRunning: (running: boolean) => void }) {
  const zh = locale === "zh";
  const [visible, setVisible] = useState(true);
  useEffect(() => { const update = () => setVisible(!document.hidden); const timer = window.setTimeout(update, 0); document.addEventListener("visibilitychange", update); return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", update); }; }, []);
  const [conversations, setConversations] = useState<RobotConversation[]>([]), [id, setId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]), [value, setValue] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [nextBefore, setNextBefore] = useState<string | null>(null);
  const olderLoaded = useRef(false);
  const composing = useRef(false), sending = useRef(false), selected = useRef(id), pane = useRef<HTMLDivElement>(null), scroll = useRef(0);
  useEffect(() => { selected.current = id; }, [id]);
  const { showConfirm, showPrompt, dialogElement } = useAppDialog({ confirm: zh ? "确认" : "Confirm", cancel: zh ? "取消" : "Cancel" });
  const list = useCallback(async () => { const result = await fetchRobotJson<{ conversations: RobotConversation[] }>(api + "?mode=task", locale); setConversations(result.conversations); return result.conversations; }, [locale]);
  const evidence = useCallback((taskId: string) => { void fetchRobotJson<{ task: TaskSnapshot }>(`/api/ai/robot/tasks/${taskId}?evidence=true`, locale).then((result) => setTasks((rows) => rows.map((row) => row.id === taskId ? { ...row, checkpoints: result.task.checkpoints } : row))).catch((caught) => setError(String(caught))); }, [locale]);
  useEffect(() => {
    if (!active || !enabled) return;
    let live = true;
    const timer = window.setTimeout(() => { void (async () => {
      const result = await fetchRobotJson<{ conversations: RobotConversation[] }>(api + "?mode=task", locale);
      let rows = result.conversations;
      if (!rows.length) { const created = await fetchRobotJson<{ conversation: RobotConversation }>(api, locale, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "task" }) }); rows = [created.conversation]; }
      if (live) { setConversations(rows); const saved = selected.current ?? robotPreference("task.conversation"); setId(rows.find((row) => row.id === saved)?.id ?? rows[0].id); }
    })().catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : "Request failed"); }); }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [active, enabled, locale]);
  useEffect(() => {
    if (!active || !visible || !enabled || !id) return;
    robotPreference("task.conversation", id);
    const controller = new AbortController(); let polling = false;
    const load = async () => { if (polling) return; polling = true; try {
      const result = await fetchRobotJson<{ tasks: TaskSnapshot[]; nextBefore: string | null }>(`${api}/${id}/tasks`, locale, { signal: controller.signal });
      if (!controller.signal.aborted) { setTasks((previous) => [...result.tasks.map((task) => ({ ...task, checkpoints: previous.find((row) => row.id === task.id)?.checkpoints ?? [] })), ...previous.filter((task) => !result.tasks.some((row) => row.id === task.id))]); if (!olderLoaded.current) setNextBefore(result.nextBefore); onRunning(result.tasks.some((task) => ["planning", "running"].includes(task.status))); }
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Request failed"); } finally { polling = false; } };
    const timer = window.setTimeout(() => { void load(); if (pane.current) pane.current.scrollTop = scroll.current; }, 0), interval = window.setInterval(() => { void load(); }, 1000);
    return () => { controller.abort(); window.clearTimeout(timer); window.clearInterval(interval); };
  }, [active, visible, enabled, id, locale, onRunning]);
  async function control(task: TaskSnapshot, action: "start" | "pause" | "resume" | "cancel" | "replan", feedback?: string) {
    if (sending.current) return false;
    sending.current = true; setBusy(true); setError(null);
    try {
      const result = await fetchRobotJson<{ task: TaskSnapshot }>(`/api/ai/robot/tasks/${task.id}/actions`, locale, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: task.revision, planVersion: task.planVersion, feedback }) });
      setTasks((rows) => [result.task, ...rows.filter((row) => row.id !== result.task.id && (action !== "replan" || row.id !== task.id))]);
      await list(); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed"); return false; }
    finally { sending.current = false; setBusy(false); }
  }
  const unfinished = tasks.find((task) => !["completed", "cancelled"].includes(task.status));
  const canReplan = unfinished && ["awaiting_confirmation", "paused", "failed"].includes(unfinished.status);
  async function submit() {
    const content = value.trim(); if (!id || !content || !configured || sending.current) return;
    if (canReplan) { if (await control(unfinished, "replan", content)) setValue(""); return; }
    if (unfinished) return;
    sending.current = true; setBusy(true); setError(null);
    try { const result = await fetchRobotJson<{ task: TaskSnapshot }>(`${api}/${id}/tasks`, locale, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, locale, imageId: selection.image?.id ?? null, indexNodeId: selection.index?.id ?? null }) }); setTasks((rows) => [result.task, ...rows]); setValue(""); await list(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed"); }
    finally { sending.current = false; setBusy(false); }
  }
  async function conversationAction(action: "new" | "rename" | "clear" | "delete") {
    if (busy) return; setBusy(true);
    try {
      if (action === "new") { const result = await fetchRobotJson<{ conversation: RobotConversation }>(api, locale, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "task" }) }); setId(result.conversation.id); setTasks([]); olderLoaded.current = false; }
      else if (id && action === "rename") { const title = await showPrompt({ title: zh ? "重命名任务会话" : "Rename task conversation", inputLabel: zh ? "名称" : "Title", initialValue: conversations.find((row) => row.id === id)?.title ?? "" }); if (title) await fetchRobotJson(`${api}/${id}`, locale, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }); }
      else if (id && await showConfirm({ title: zh ? "清空或删除任务会话？" : "Clear or delete task conversation?", message: zh ? "任务将停止，历史和检查点将被删除，此操作无法撤销。" : "Tasks will stop and history and checkpoints will be removed. This cannot be undone.", tone: "danger" })) { await fetchRobotJson(`${api}/${id}${action === "clear" ? "/messages" : ""}`, locale, { method: "DELETE" }); setTasks([]); olderLoaded.current = false; if (action === "delete") setId(null); }
      const rows = await list(); if (action === "delete") { if (rows.length) setId(rows[0].id); else { const result = await fetchRobotJson<{ conversation: RobotConversation }>(api, locale, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "task" }) }); setId(result.conversation.id); await list(); } }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed"); } finally { setBusy(false); }
  }
  return <>
    <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-zinc-50 p-2"><select aria-label={zh ? "任务会话" : "Task conversation"} value={id ?? ""} disabled={busy} onChange={(event) => { olderLoaded.current = false; setTasks([]); setNextBefore(null); setId(event.target.value); scroll.current = 0; }} className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs focus:border-cyan-600">{conversations.map((row) => <option key={row.id} value={row.id}>{row.title ?? (zh ? "新任务会话" : "New task conversation")}</option>)}</select>
      {(["new", "rename", "clear", "delete"] as const).map((action) => <button key={action} type="button" disabled={busy || (action !== "new" && !id)} onClick={() => void conversationAction(action)} title={zh ? ({ new: "新会话", rename: "重命名", clear: "清空", delete: "删除" })[action] : action} className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">{action === "new" ? <MessageSquarePlus className="h-3.5 w-3.5" /> : action === "rename" ? <PencilLine className="h-3.5 w-3.5" /> : action === "clear" ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</button>)}
    </div>
    <div ref={pane} onScroll={() => { scroll.current = pane.current?.scrollTop ?? 0; }} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50/70 p-3">
      {!tasks.length ? <p className="p-4 text-sm leading-6 text-zinc-500">{zh ? "输入目标后先制定步骤，确认后分批阅读图库文字与知识库。任务可暂停、继续，关闭窗口仍在后台执行。" : "Describe a goal, review the plan, then run it in batches. Tasks support checkpoints, pause and resume, and continue in the background."}</p> : null}
      {tasks.map((task) => <TaskCard key={task.id} task={task} locale={locale} busy={busy} onEvidence={evidence} onAction={(row, action) => { void control(row, action); }} />)}
      {nextBefore && id ? <button type="button" className={button} onClick={() => { void fetchRobotJson<{ tasks: TaskSnapshot[]; nextBefore: string | null }>(`${api}/${id}/tasks?before=${encodeURIComponent(nextBefore)}`, locale).then((result) => { olderLoaded.current = true; setTasks((rows) => [...rows, ...result.tasks.filter((task) => !rows.some((row) => row.id === task.id))]); setNextBefore(result.nextBefore); }).catch((caught) => setError(String(caught))); }}>{zh ? "加载更早任务" : "Load older tasks"}</button> : null}
      {error ? <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</p> : null}
    </div>
    <footer className="shrink-0 border-t border-zinc-200 bg-white p-3">
      {!configured ? <button type="button" onClick={onSettings} className="mb-2 text-xs text-cyan-800">{zh ? "到管理设置配置任务模式" : "Configure task mode in settings"}</button> : null}
      <div className="flex items-end gap-2"><textarea aria-label={zh ? "任务目标或计划反馈" : "Task goal or plan feedback"} value={value} onChange={(event) => setValue(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (shouldSendReadingInput(event.nativeEvent, composing.current)) { event.preventDefault(); void submit(); } }} rows={2} maxLength={20_000} disabled={busy || Boolean(unfinished && !canReplan)} placeholder={canReplan ? (zh ? "输入调整要求，重新制定计划…" : "Give feedback to revise the plan…") : (zh ? "例如：总结这个索引的主要观点，并列出资料引用…" : "Describe a read-only analysis goal…")} className="min-h-16 min-w-0 flex-1 resize-none rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 disabled:bg-zinc-50" />
        <button type="button" disabled={busy || !configured || !id || !value.trim() || Boolean(unfinished && !canReplan)} onClick={() => void submit()} aria-label={zh ? "发送任务" : "Send task"} className="grid h-9 w-9 place-items-center rounded-md bg-cyan-700 text-white hover:bg-cyan-800 disabled:bg-zinc-200 disabled:text-zinc-400">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-400">{zh ? "只读分析；关闭或切换模式继续运行，暂停立即中断当前批次。" : "Read-only analysis. Closing or switching modes keeps tasks running; pause interrupts the current batch."}</p>
    </footer>{dialogElement}
  </>;
}
