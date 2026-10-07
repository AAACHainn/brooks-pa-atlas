"use client";
import { BrainCircuit, Loader2, MessageSquarePlus, PencilLine, Send, Settings, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppDialog } from "@/app/app-dialog";
import { RobotLauncher, RobotWindow, robotPreference } from "@/app/ai-robot-floating";
import { createLatestValueScheduler, shouldSendReadingInput } from "@/lib/reading-companion-ui";
import { consumeRobotStream, fetchRobotJson, readRobotJson, updateRobotDraft, RobotStreamError, RobotTaskError, type RobotDraft } from "@/lib/ai-robot-ui";
import { robotErrorMessage, robotToolLabel, robotBudgetFeedback, robotBudgetReason, type RobotConversation, type RobotLocale, type RobotMessage, type RobotSelection } from "@/lib/ai-robot-types";
import type { AiToolBudgetSnapshot } from "@/lib/ai-tool-limits";

const api = "/api/ai/robot/conversations";
const plugins = [remarkGfm];
const markdown: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 font-semibold">{children}</h3>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-3 border-cyan-500 bg-cyan-50/70 py-1 pl-3 text-zinc-600">{children}</blockquote>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">{children}</pre>,
  table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
  th: ({ children }) => <th className="border border-zinc-300 bg-zinc-100 px-2 py-1.5">{children}</th>,
  td: ({ children }) => <td className="border border-zinc-300 px-2 py-1.5">{children}</td>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-700 underline">{children}</a>,
};
const Text = memo(function Text({ content }: { content: string }) { return <ReactMarkdown remarkPlugins={plugins} components={markdown}>{content}</ReactMarkdown>; });
const Thought = memo(function Thought({ content, duration, locale }: { content: string; duration?: number | null; locale: RobotLocale }) {
  return content ? <details className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-zinc-600"><summary className="cursor-pointer text-amber-800"><BrainCircuit className="mr-1 inline h-3 w-3" />{locale === "zh" ? "思考过程" : "Reasoning"}{duration ? ` · ${(duration / 1000).toFixed(1)}s` : ""}</summary><div className="mt-2 whitespace-pre-wrap leading-5">{content}</div></details> : null;
});
const BudgetFeedback = memo(function BudgetFeedback({ budget, locale }: { budget: AiToolBudgetSnapshot; locale: RobotLocale }) {
  return <div className="mt-2 space-y-1 text-[11px] leading-5">{robotBudgetFeedback(budget, locale).map((line, index) => <p key={index}>{line}</p>)}</div>;
});
const MessageList = memo(function MessageList({ messages, locale }: { messages: RobotMessage[]; locale: RobotLocale }) {
  return messages.map((message) => <div key={message.id} className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
    <div className={`max-w-[90%] break-words rounded-xl border px-3 py-2 text-sm leading-6 shadow-sm ${message.role === "USER" ? "border-zinc-800 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-800"}`}>
      {message.role === "USER" ? <><p className="whitespace-pre-wrap">{message.content}</p>{message.selection?.image || message.selection?.index ? <p className="mt-1 border-t border-zinc-700 pt-1 text-[10px] text-cyan-200">{message.selection.image?.title ?? message.selection.image?.originalName ?? message.selection.index?.path}</p> : null}</>
        : <><Thought content={message.reasoningContent ?? ""} duration={message.reasoningDurationMs} locale={locale} /><Text content={message.content} />
          {message.execution?.warnings?.includes("approaching_limit") ? <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{locale === "zh" ? "本次已临近运行上限，优先生成了当前回答。需要更多资料时，可缩小范围继续提问。" : "The task approached its limit and prioritized the current answer. Ask a narrower follow-up if more evidence is needed."}</p> : null}
          {message.execution ? <details className="mt-2 border-t border-zinc-100 pt-1 text-[11px] text-zinc-500"><summary className="cursor-pointer">{locale === "zh" ? "工具执行" : "Tool activity"} · {message.execution.toolCalls}</summary>
            {message.execution.records.filter((record) => record.type === "tool_completed").map((record) => <p key={record.callId}>{robotToolLabel(record.toolName, locale)} · {record.status === "succeeded" ? (locale === "zh" ? "完成" : "Done") : (locale === "zh" ? "失败" : "Failed")}{record.itemCount !== undefined ? ` · ${record.itemCount}` : ""}</p>)}
            {message.execution.budget ? <BudgetFeedback budget={message.execution.budget} locale={locale} /> : null}
          </details> : null}</>}
    </div>
  </div>);
});
const Composer = memo(function Composer({ sending, configured, ready, locale, onSend, onStop, onSettings }: {
  sending: boolean; configured: boolean; ready: boolean; locale: RobotLocale; onSend: (text: string) => Promise<boolean>; onStop: () => void; onSettings: () => void;
}) {
  const [value, setValue] = useState("");
  const composing = useRef(false), pending = useRef(false);
  const submit = async () => { if (!value.trim() || sending || !configured || !ready || pending.current) return; pending.current = true; try { if (await onSend(value)) setValue(""); } finally { pending.current = false; } };
  const zh = locale === "zh";
  return <footer className="shrink-0 border-t border-zinc-200 bg-white p-3">
    {!configured ? <button type="button" onClick={onSettings} className="mb-2 flex items-center gap-1 text-xs text-cyan-800"><Settings className="h-3 w-3" />{zh ? "请到管理设置配置 AI 机器人" : "Configure the AI robot in management settings"}</button> : null}
    <div className="flex items-end gap-2"><textarea aria-label={zh ? "机器人消息" : "Robot message"} value={value} onChange={(event) => setValue(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => { if (shouldSendReadingInput({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode }, composing.current)) { event.preventDefault(); void submit(); } }}
      disabled={sending} maxLength={20_000} rows={2} placeholder={zh ? "可以查询索引，或询问当前图片的文字资料…" : "Search indexes or ask about the selected image's text…"}
      className="min-h-16 min-w-0 flex-1 resize-none rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 disabled:bg-zinc-50" />
      <button type="button" onClick={() => sending ? onStop() : void submit()} disabled={!sending && (!configured || !ready || !value.trim())}
        aria-label={zh ? (sending ? "停止" : "发送") : (sending ? "Stop" : "Send")} className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-cyan-800 text-white hover:bg-cyan-900 disabled:bg-zinc-200 disabled:text-zinc-400">{sending ? <X className="h-4 w-4" /> : <Send className="h-4 w-4" />}</button>
    </div><p className="mt-1.5 text-[10px] text-zinc-400">{zh ? "首版仅支持只读工具；使用最近四组已完成问答，历史保存在本地系统。" : "Read-only tools; context uses the last four completed exchanges. History is stored locally."}</p>
  </footer>;
});
export default function AiRobot({ enabled, configured, locale, selection, onOpenSettings }: {
  enabled: boolean; configured: boolean; locale: RobotLocale; selection: RobotSelection; onOpenSettings: () => void;
}) {
  const zh = locale === "zh";
  const [open, setOpen] = useState(false), [minimized, setMinimized] = useState(false);
  const [conversations, setConversations] = useState<RobotConversation[]>([]), [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RobotMessage[]>([]), [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RobotDraft | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<{ conversationId: string; question: string; selection: RobotSelection; code: string; budget: AiToolBudgetSnapshot } | null>(null);
  const sendAbort = useRef<AbortController | null>(null), loadAbort = useRef<AbortController | null>(null);
  const pane = useRef<HTMLDivElement | null>(null), scroll = useRef({ top: 0, stick: true });
  const context = useRef(selection);
  const active = useRef(activeId);
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => { context.current = selection; active.current = activeId; enabledRef.current = enabled; }, [selection, activeId, enabled]);
  const { showConfirm, showPrompt, dialogElement } = useAppDialog({ confirm: zh ? "确认" : "Confirm", cancel: zh ? "取消" : "Cancel" });
  const stop = useCallback(() => { sendAbort.current?.abort(); }, []);
  const settings = useCallback(() => { stop(); setOpen(false); onOpenSettings(); }, [onOpenSettings, stop]);
  const refreshList = useCallback(async () => {
    const result = await fetchRobotJson<{ conversations: RobotConversation[] }>(api, locale);
    setConversations(result.conversations); return result.conversations;
  }, [locale]);
  useEffect(() => () => { sendAbort.current?.abort(); loadAbort.current?.abort(); }, []);
  useEffect(() => { if (!enabled) { stop(); loadAbort.current?.abort(); const timer = window.setTimeout(() => setOpen(false), 0); return () => window.clearTimeout(timer); } }, [enabled, stop]);
  useEffect(() => {
    if (!open || !enabled) return;
    const controller = new AbortController(); loadAbort.current?.abort(); loadAbort.current = controller;
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null);
      void (async () => {
        let result = await fetchRobotJson<{ conversations: RobotConversation[] }>(api, locale, { signal: controller.signal });
        if (!result.conversations.length) {
          const created = await fetchRobotJson<{ conversation: RobotConversation }>(api, locale, { method: "POST", signal: controller.signal });
          result = { conversations: [created.conversation] };
        }
        const saved = active.current ?? robotPreference("conversation");
        const id = result.conversations.find((row) => row.id === saved)?.id ?? result.conversations[0].id;
        if (!controller.signal.aborted) { setConversations(result.conversations); setActiveId(id); }
      })().catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : robotErrorMessage("execution_failed", locale)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, open, locale, reloadVersion]);
  useEffect(() => {
    if (!activeId || !open || !enabled) return;
    robotPreference("conversation", activeId);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetchRobotJson<{ messages: RobotMessage[]; nextBefore: number | null }>(`${api}/${activeId}`, locale, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) {
          try {
            const saved = JSON.parse(robotPreference("scroll." + activeId) ?? "null") as { top: number; stick: boolean } | null;
            if (saved && Number.isFinite(saved.top) && saved.top >= 0 && typeof saved.stick === "boolean") scroll.current = saved;
            else scroll.current = { top: 0, stick: true };
          } catch { scroll.current = { top: 0, stick: true }; }
          setMessages(result.messages); setNextBefore(result.nextBefore);
        } })
        .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : robotErrorMessage("execution_failed", locale)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeId, enabled, open, locale, reloadVersion]);
  useEffect(() => {
    if (!open || minimized || !pane.current) return;
    const node = pane.current;
    if (scroll.current.stick) node.scrollTop = node.scrollHeight;
  }, [messages, draft, open, minimized]);
  const send = useCallback(async (text: string, reference?: RobotSelection) => {
    const id = active.current;
    if (!id || sendAbort.current || !enabledRef.current) return false;
    const controller = new AbortController(); sendAbort.current = controller;
    const selected = reference ?? context.current;
    setSending(true); setError(null); setFailedAttempt(null); setDraft(null); scroll.current.stick = true;
    let localDraft: RobotDraft | null = null, accepted = false;
    const buffer = createLatestValueScheduler<RobotDraft | null>(setDraft, (callback) => window.setTimeout(callback, 50), window.clearTimeout);
    try {
      const response = await fetch(`${api}/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ content: text, locale, imageId: selected.image?.id ?? null, indexNodeId: selected.index?.id ?? null }) });
      if (!response.ok) await readRobotJson(response, locale);
      await consumeRobotStream(response, (event) => {
        if (event.type === "user_message") { accepted = true; setMessages((rows) => [...rows, event.message]); }
        else if (event.type === "done") { buffer.cancel(); setDraft(null); setMessages((rows) => [...rows, event.message]); }
        else if (event.type === "error") throw new RobotTaskError(event.error, event.code, event.budget);
        else { localDraft = updateRobotDraft(localDraft, event); buffer.queue(localDraft); }
      }, controller.signal);
    } catch (caught) {
      setError(controller.signal.aborted ? robotErrorMessage("cancelled", locale) : caught instanceof RobotStreamError ? robotErrorMessage("invalid_response", locale) : caught instanceof Error ? caught.message : robotErrorMessage("execution_failed", locale));
      if (!controller.signal.aborted && caught instanceof RobotTaskError && caught.budget?.limitKind) setFailedAttempt({ conversationId: id, question: text, selection: selected, code: caught.code, budget: caught.budget });
    }
    finally {
      buffer.cancel(); setDraft(null); sendAbort.current = null; setSending(false);
      if (enabledRef.current) await refreshList().catch(() => {});
    }
    return accepted;
  }, [locale, refreshList]);
  async function action(kind: "new" | "rename" | "clear" | "delete" | "older") {
    if (sending || loading) return;
    setLoading(true);
    const id = activeId;
    try {
      if (kind === "rename" && id) {
        const title = await showPrompt({ title: zh ? "重命名会话" : "Rename conversation", inputLabel: zh ? "会话名称" : "Title", initialValue: conversations.find((row) => row.id === id)?.title ?? "" });
        if (!title?.trim()) return;
        await fetchRobotJson(`${api}/${id}`, locale, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      } else if ((kind === "clear" || kind === "delete") && id) {
        if (!await showConfirm({ title: zh ? (kind === "clear" ? "清空此会话？" : "删除此会话？") : (kind === "clear" ? "Clear this conversation?" : "Delete this conversation?"), message: zh ? "此操作无法撤销。" : "This cannot be undone.", tone: "danger" })) return;
        await fetchRobotJson(`${api}/${id}${kind === "clear" ? "/messages" : ""}`, locale, { method: "DELETE" });
        setMessages([]); setNextBefore(null); setError(null); setFailedAttempt(null);
      } else if (kind === "older" && id && nextBefore !== null) {
        setLoading(true);
        const result = await fetchRobotJson<{ messages: RobotMessage[]; nextBefore: number | null }>(`${api}/${id}?before=${nextBefore}`, locale);
        const node = pane.current, height = node?.scrollHeight ?? 0;
        scroll.current.stick = false;
        setMessages((rows) => [...result.messages, ...rows]); setNextBefore(result.nextBefore);
        requestAnimationFrame(() => { if (node) node.scrollTop += node.scrollHeight - height; });
        return;
      }
      let rows = await refreshList();
      if (kind === "new" || !rows.length) { const created = await fetchRobotJson<{ conversation: RobotConversation }>(api, locale, { method: "POST" }); rows = await refreshList(); setActiveId(created.conversation.id); setMessages([]); scroll.current.stick = true; }
      else if (kind === "delete") setActiveId(rows[0].id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : robotErrorMessage("execution_failed", locale)); }
    finally { setLoading(false); }
  }
  function rememberScroll() { if (pane.current) { const node = pane.current; scroll.current = { top: node.scrollTop, stick: node.scrollHeight - node.scrollTop - node.clientHeight < 32 }; robotPreference("scroll." + activeId, JSON.stringify(scroll.current)); } }
  function toggleMinimize() { rememberScroll(); setMinimized((value) => !value); }
  if (!enabled) return null;
  const subtitle = selection.image?.title ?? selection.image?.originalName ?? selection.index?.path ?? (zh ? "全局助手 · 只读工具" : "Global assistant · read-only tools");
  const btn = "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50";
  const failure = failedAttempt?.conversationId === activeId ? failedAttempt : null;
  return <>
    {!open ? <RobotLauncher locale={locale} busy={sending} onOpen={() => { setMinimized(false); setOpen(true); }} /> : <RobotWindow locale={locale} minimized={minimized} onMinimize={toggleMinimize} subtitle={subtitle}
      onClose={() => { rememberScroll(); stop(); setOpen(false); }}>
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-zinc-50 p-2">
        <select aria-label={zh ? "机器人会话" : "Robot conversation"} value={activeId ?? ""} disabled={sending || loading} onChange={(event) => { scroll.current.stick = true; setMessages([]); setError(null); setActiveId(event.target.value); }} className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-cyan-600">
          {conversations.map((row) => <option key={row.id} value={row.id}>{row.title ?? (zh ? "新会话" : "New conversation")} ({row.messageCount})</option>)}
        </select>
        {(["new", "rename", "clear", "delete"] as const).map((kind) => <button key={kind} type="button" disabled={sending || loading || (kind !== "new" && !activeId)} onClick={() => void action(kind)}
          title={zh ? ({ new: "新建会话", rename: "重命名会话", clear: "清空消息", delete: "删除会话" })[kind] : ({ new: "New conversation", rename: "Rename", clear: "Clear", delete: "Delete" })[kind]} className={btn}>{kind === "new" ? <MessageSquarePlus className="h-3.5 w-3.5" /> : kind === "rename" ? <PencilLine className="h-3.5 w-3.5" /> : kind === "clear" ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 text-rose-600" />}</button>)}
      </div>
      <div ref={(node) => { pane.current = node; if (node && scroll.current.top && !scroll.current.stick) node.scrollTop = scroll.current.top; }} onScroll={rememberScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50/70 p-3">
        {nextBefore !== null ? <button type="button" disabled={loading} onClick={() => void action("older")} className="mx-auto block rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500">{zh ? "加载更早消息" : "Load older messages"}</button> : null}
        {loading && !messages.length ? <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-zinc-400" /> : null}
        {!loading && !messages.length && !sending ? <div className="grid h-full place-items-center px-5 text-center text-sm leading-6 text-zinc-500">{zh ? "你好，我可以查询索引，读取当前图片保存的文字资料。其他能力将逐步加入。" : "I can query indexes and read saved text for the selected image. More tools will be added later."}</div> : null}
        <MessageList messages={messages} locale={locale} />
        {sending ? <div className="max-w-[90%] rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-800"><p className="mb-1 text-xs text-cyan-700"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{zh ? "正在处理" : "Working"}{draft?.round ? ` · ${draft.round}` : ""}</p>
          <Thought content={draft?.reasoning ?? ""} locale={locale} />{draft?.text ? <Text content={draft.text} /> : null}
          {draft?.tools.map((tool) => <p key={tool.id} className="text-[11px] text-zinc-500">{robotToolLabel(tool.name, locale)} · {tool.status === "running" ? (zh ? "读取中" : "Reading") : tool.status === "succeeded" ? (zh ? "完成" : "Done") : (zh ? "失败" : "Failed")}</p>)}
          {draft?.warning ? <p role="status" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{zh ? "接近" : "Approaching "}{robotBudgetReason(draft.warning.limitKind, locale)}{zh ? "，正在收束已完成的读取并生成回答。" : "; wrapping up successful reads and preparing an answer."}</p> : null}
        </div> : null}
        {error || failure ? <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"><p role="alert" className="whitespace-pre-wrap">{failure ? `${robotErrorMessage(failure.code, locale)} ${zh ? "对应限制：" : "Relevant limit: "}${robotBudgetReason(failure.budget.limitKind, locale)}。` : error}</p>
          {failure ? <><BudgetFeedback budget={failure.budget} locale={locale} /><p className="mt-2">{zh ? "尚未生成最终答案。可调整对应限制或缩小问题范围；重试会按当前设置重新执行原问题，不会自动续跑。" : "No final answer was produced. Adjust the relevant limit or narrow the question. Retrying starts the original question again with current settings; it does not resume automatically."}</p></> : null}
          {!sending && !loading ? <div className="mt-2 flex flex-wrap gap-2">{failure ? <>
            <button type="button" onClick={settings} className="rounded-md border border-cyan-200 bg-white px-2 py-1 text-cyan-800 hover:bg-cyan-50">{zh ? "调整运行限制" : "Adjust limits"}</button>
            <button type="button" title={zh ? "使用原问题和原参考对象，按当前设置重新执行" : "Rerun the original question and reference selection with current settings"} onClick={() => void send(failure.question, failure.selection)} className="rounded-md border border-rose-200 bg-white px-2 py-1 hover:bg-rose-100">{zh ? "重试此问题" : "Retry question"}</button>
          </> : null}<button type="button" onClick={() => { setFailedAttempt(null); setReloadVersion((value) => value + 1); }} className="rounded-md border border-rose-200 bg-white px-2 py-1 hover:bg-rose-100">{zh ? "重新加载会话" : "Reload conversations"}</button></div> : null}
        </div> : null}
      </div>
      <Composer sending={sending} configured={configured} ready={Boolean(activeId) && !loading} locale={locale} onSend={send} onStop={stop} onSettings={settings} />
    </RobotWindow>}
    {dialogElement}
  </>;
}
