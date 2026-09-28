"use client";

import {
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquarePlus,
  PencilLine,
  Send,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAppDialog } from "@/app/app-dialog";

type Locale = "zh" | "en";

type Conversation = {
  id: string;
  title: string | null;
  messageCount: number;
  preview: string | null;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  role: "USER" | "ASSISTANT";
  sequence: number;
  content: string;
  createdAt: string;
  image: {
    id: string | null;
    title: string | null;
    originalName: string;
    available: boolean;
  } | null;
};

type ReferenceImage = { id: string; title: string | null; originalName: string };
type FloatingFrame = { x: number; y: number; width: number; height: number };
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const labels = {
  zh: {
    title: "AI 阅读伴侣",
    newConversation: "新建会话",
    untitled: "新会话",
    rename: "重命名会话",
    renameTitle: "重命名会话",
    renameLabel: "会话名称",
    clear: "清空消息",
    clearTitle: "清空当前会话？",
    clearMessage: "当前会话的全部消息将被删除，此操作无法撤销。",
    delete: "删除会话",
    deleteTitle: "删除当前会话？",
    deleteMessage: "会话及其全部消息将被删除，此操作无法撤销。",
    confirm: "确认",
    cancel: "取消",
    close: "关闭",
    collapse: "收起",
    expand: "展开",
    currentImage: "当前参考图",
    unavailableImage: "原图已删除",
    noMessages: "可以要求我翻译、讲解、总结或讨论当前图片。",
    placeholder: "围绕当前图片提问…",
    send: "发送",
    sending: "回答中",
    loadOlder: "加载更早消息",
    loading: "加载中",
    loadFailed: "无法加载伴读会话。",
    operationFailed: "操作失败",
    retryHint: "内容已恢复到输入框，可以重新发送。",
    configure: "配置阅读伴侣",
    configureHint: "请先选择可用的 AI 端点和视觉模型。",
    recentContext: "模型接收近期会话和最多 4 张参考图；全部历史仍保存在本地。",
  },
  en: {
    title: "AI reading companion",
    newConversation: "New conversation",
    untitled: "New conversation",
    rename: "Rename conversation",
    renameTitle: "Rename conversation",
    renameLabel: "Conversation name",
    clear: "Clear messages",
    clearTitle: "Clear this conversation?",
    clearMessage: "All messages in this conversation will be deleted. This cannot be undone.",
    delete: "Delete conversation",
    deleteTitle: "Delete this conversation?",
    deleteMessage: "The conversation and all its messages will be deleted. This cannot be undone.",
    confirm: "Confirm",
    cancel: "Cancel",
    close: "Close",
    collapse: "Collapse",
    expand: "Expand",
    currentImage: "Current reference",
    unavailableImage: "Original image deleted",
    noMessages: "Ask me to translate, explain, summarize, or discuss the current image.",
    placeholder: "Ask about the current image…",
    send: "Send",
    sending: "Responding",
    loadOlder: "Load older messages",
    loading: "Loading",
    loadFailed: "Could not load reading conversations.",
    operationFailed: "Operation failed",
    retryHint: "Your message was restored to the input box so you can send it again.",
    configure: "Configure reading companion",
    configureHint: "Select an available AI endpoint and vision-capable model first.",
    recentContext: "The model receives recent chat and up to 4 reference images; all history stays saved locally.",
  },
} as const;

const defaultWindowWidth = 440;
const minimumWindowWidth = 320;
const minimumWindowHeight = 320;
const viewportMargin = 12;

function clampedSize(size: { width: number; height: number }) {
  const maxWidth = Math.max(1, window.innerWidth - viewportMargin * 2);
  const maxHeight = Math.max(1, window.innerHeight - viewportMargin * 2);
  return {
    width: Math.min(Math.max(Math.min(minimumWindowWidth, maxWidth), size.width), maxWidth),
    height: Math.min(Math.max(Math.min(minimumWindowHeight, maxHeight), size.height), maxHeight),
  };
}

function clampedPosition(
  position: { x: number; y: number },
  size: { width: number; height: number },
) {
  return {
    x: Math.min(
      Math.max(viewportMargin, position.x),
      Math.max(viewportMargin, window.innerWidth - size.width - viewportMargin),
    ),
    y: Math.min(
      Math.max(viewportMargin, position.y),
      Math.max(viewportMargin, window.innerHeight - size.height - viewportMargin),
    ),
  };
}

function clampedFrame(frame: FloatingFrame): FloatingFrame {
  const size = clampedSize(frame);
  return { ...clampedPosition(frame, size), ...size };
}

function defaultFrame(): FloatingFrame {
  const size = clampedSize({
    width: defaultWindowWidth,
    height: Math.min(Math.round(window.innerHeight * 0.7), 720),
  });
  return {
    ...clampedPosition({ x: window.innerWidth - size.width - 24, y: 80 }, size),
    ...size,
  };
}

function resizedFrame(
  start: FloatingFrame,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  const minimumWidth = Math.min(minimumWindowWidth, window.innerWidth - viewportMargin * 2);
  const minimumHeight = Math.min(minimumWindowHeight, window.innerHeight - viewportMargin * 2);

  if (direction.includes("e")) {
    right = Math.min(
      window.innerWidth - viewportMargin,
      Math.max(left + minimumWidth, right + deltaX),
    );
  }
  if (direction.includes("w")) {
    left = Math.max(viewportMargin, Math.min(right - minimumWidth, left + deltaX));
  }
  if (direction.includes("s")) {
    bottom = Math.min(
      window.innerHeight - viewportMargin,
      Math.max(top + minimumHeight, bottom + deltaY),
    );
  }
  if (direction.includes("n")) {
    top = Math.max(viewportMargin, Math.min(bottom - minimumHeight, top + deltaY));
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-3 border-cyan-500 bg-cyan-50/70 py-1 pl-3 text-zinc-600">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-cyan-700 underline decoration-cyan-300 underline-offset-2 hover:text-cyan-900"
            >
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
              {children}
            </pre>
          ),
          code: ({ children, className }) => className ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] text-rose-700">
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-zinc-300 bg-zinc-100 px-2 py-1.5 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-zinc-300 px-2 py-1.5 align-top">{children}</td>,
          hr: () => <hr className="my-3 border-zinc-200" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function AiReadingCompanion({
  open,
  locale,
  image,
  configured,
  onClose,
  onOpenSettings,
}: {
  open: boolean;
  locale: Locale;
  image: ReferenceImage | null;
  configured: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const t = labels[locale];
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [frame, setFrame] = useState<FloatingFrame | null>(null);
  const [interaction, setInteraction] = useState<"drag" | ResizeDirection | null>(null);
  const interactionRef = useRef({
    pointerX: 0,
    pointerY: 0,
    frame: { x: 0, y: 0, width: defaultWindowWidth, height: minimumWindowHeight },
  });
  const messagePaneRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const { showAlert, showConfirm, showPrompt, dialogElement } = useAppDialog({
    confirm: t.confirm,
    cancel: t.cancel,
  });

  useEffect(() => {
    const storedPosition = window.localStorage.getItem("brooks-pa-atlas.aiReading.position");
    const storedSize = window.localStorage.getItem("brooks-pa-atlas.aiReading.size");
    let restoredPosition: { x: number; y: number } | null = null;
    let restoredSize: { width: number; height: number } | null = null;
    if (storedPosition) {
      try {
        const parsed = JSON.parse(storedPosition) as { x?: unknown; y?: unknown };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          restoredPosition = { x: parsed.x, y: parsed.y };
        }
      } catch {
        // Ignore invalid local preferences.
      }
    }
    if (storedSize) {
      try {
        const parsed = JSON.parse(storedSize) as { width?: unknown; height?: unknown };
        if (typeof parsed.width === "number" && typeof parsed.height === "number") {
          restoredSize = { width: parsed.width, height: parsed.height };
        }
      } catch {
        // Ignore invalid local preferences.
      }
    }
    const restoredMinimized = window.localStorage.getItem("brooks-pa-atlas.aiReading.minimized") === "true";
    const timer = window.setTimeout(() => {
      if (restoredPosition || restoredSize) {
        const fallback = defaultFrame();
        setFrame(clampedFrame({
          x: restoredPosition?.x ?? fallback.x,
          y: restoredPosition?.y ?? fallback.y,
          width: restoredSize?.width ?? fallback.width,
          height: restoredSize?.height ?? fallback.height,
        }));
      }
      setMinimized(restoredMinimized);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setFrame((current) => current ?? defaultFrame());
      if (conversations.length === 0 && !loading) void loadConversations();
    }, 0);
    return () => window.clearTimeout(timer);
    // Only initialize when the floating window is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (!activeId) return;
    void loadMessages(activeId);
    // loadMessages deliberately reads the latest locale labels without making
    // an active conversation reload whenever the interface language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    const pane = messagePaneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [assistantDraft, messages.length]);

  useEffect(() => {
    function handleResize() {
      setFrame((current) => (current ? clampedFrame(current) : current));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!interaction) return;
    const activeInteraction = interaction;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = activeInteraction === "drag" ? "grabbing" : `${activeInteraction}-resize`;
    function handlePointerMove(event: PointerEvent) {
      const deltaX = event.clientX - interactionRef.current.pointerX;
      const deltaY = event.clientY - interactionRef.current.pointerY;
      if (activeInteraction === "drag") {
        const start = interactionRef.current.frame;
        setFrame(clampedFrame({ ...start, x: start.x + deltaX, y: start.y + deltaY }));
      } else {
        setFrame(resizedFrame(interactionRef.current.frame, activeInteraction, deltaX, deltaY));
      }
    }
    function handlePointerUp() {
      setInteraction(null);
      setFrame((current) => {
        if (current) {
          window.localStorage.setItem(
            "brooks-pa-atlas.aiReading.position",
            JSON.stringify({ x: current.x, y: current.y }),
          );
          window.localStorage.setItem(
            "brooks-pa-atlas.aiReading.size",
            JSON.stringify({ width: current.width, height: current.height }),
          );
        }
        return current;
      });
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [interaction]);

  async function loadConversations(preferredId?: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/reading-companion/conversations", { cache: "no-store" });
      const result = (await response.json().catch(() => null)) as
        | { conversations?: Conversation[]; error?: string }
        | null;
      if (!response.ok || !result?.conversations) throw new Error(result?.error ?? t.loadFailed);
      setConversations(result.conversations);
      const candidate = preferredId ?? activeId;
      if (candidate && result.conversations.some((item) => item.id === candidate)) {
        setActiveId(candidate);
      } else if (result.conversations[0]) {
        setActiveId(result.conversations[0].id);
      } else {
        await createConversation();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  async function createConversation() {
    const response = await fetch("/api/ai/reading-companion/conversations", { method: "POST" });
    const result = (await response.json().catch(() => null)) as
      | { conversation?: Conversation; error?: string }
      | null;
    if (!response.ok || !result?.conversation) {
      throw new Error(result?.error ?? t.operationFailed);
    }
    setConversations((current) => [result.conversation!, ...current]);
    setActiveId(result.conversation.id);
    setMessages([]);
    setNextBefore(null);
    return result.conversation;
  }

  async function loadMessages(conversationId: string, before?: number) {
    if (!before) setLoading(true);
    setError(null);
    try {
      const suffix = before === undefined ? "" : `?before=${before}`;
      const response = await fetch(
        `/api/ai/reading-companion/conversations/${conversationId}${suffix}`,
        { cache: "no-store" },
      );
      const result = (await response.json().catch(() => null)) as
        | { messages?: Message[]; nextBefore?: number | null; error?: string }
        | null;
      if (!response.ok || !result?.messages) throw new Error(result?.error ?? t.loadFailed);
      if (activeIdRef.current !== conversationId) return;
      setMessages((current) => (before === undefined ? result.messages! : [...result.messages!, ...current]));
      setNextBefore(result.nextBefore ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  async function renameConversation() {
    const current = conversations.find((item) => item.id === activeId);
    if (!current || sending) return;
    const title = await showPrompt({
      title: t.renameTitle,
      inputLabel: t.renameLabel,
      initialValue: current.title ?? "",
      required: true,
    });
    if (!title) return;
    const response = await fetch(`/api/ai/reading-companion/conversations/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      await showAlert({ title: t.operationFailed, message: t.loadFailed, tone: "danger" });
      return;
    }
    setConversations((items) => items.map((item) => item.id === current.id ? { ...item, title } : item));
  }

  async function clearConversation() {
    if (!activeId || sending) return;
    if (!(await showConfirm({ title: t.clearTitle, message: t.clearMessage, tone: "danger" }))) return;
    const response = await fetch(`/api/ai/reading-companion/conversations/${activeId}/messages`, {
      method: "DELETE",
    });
    if (!response.ok) return void showAlert({ title: t.operationFailed, message: t.loadFailed, tone: "danger" });
    setMessages([]);
    setNextBefore(null);
    setConversations((items) => items.map((item) => item.id === activeId ? { ...item, messageCount: 0, preview: null } : item));
  }

  async function deleteConversation() {
    if (!activeId || sending) return;
    if (!(await showConfirm({ title: t.deleteTitle, message: t.deleteMessage, tone: "danger" }))) return;
    const deletingId = activeId;
    const response = await fetch(`/api/ai/reading-companion/conversations/${deletingId}`, {
      method: "DELETE",
    });
    if (!response.ok) return void showAlert({ title: t.operationFailed, message: t.loadFailed, tone: "danger" });
    const remaining = conversations.filter((item) => item.id !== deletingId);
    setConversations(remaining);
    if (remaining[0]) setActiveId(remaining[0].id);
    else {
      setActiveId(null);
      try {
        await createConversation();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t.operationFailed);
      }
    }
  }

  async function sendMessage() {
    const content = input.trim();
    if (!activeId || !image || !content || sending) return;
    if (!configured) {
      onOpenSettings();
      return;
    }
    const conversationId = activeId;
    setInput("");
    setError(null);
    setAssistantDraft("");
    setSending(true);
    try {
      const response = await fetch(
        `/api/ai/reading-companion/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: image.id, content }),
        },
      );
      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? t.operationFailed);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let draft = "";
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: "start" | "delta" | "done" | "error";
            text?: string;
            error?: string;
            userMessage?: Message;
            assistantMessage?: Message;
            conversation?: { id: string; title: string | null };
          };
          if (event.type === "start" && event.userMessage) {
            setMessages((current) => current.some((item) => item.id === event.userMessage!.id) ? current : [...current, event.userMessage!]);
            if (event.conversation) {
              setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, title: event.conversation!.title, messageCount: item.messageCount + 1, preview: content, updatedAt: new Date().toISOString() } : item));
            }
          } else if (event.type === "delta") {
            draft += event.text ?? "";
            setAssistantDraft(draft);
          } else if (event.type === "done" && event.assistantMessage) {
            completed = true;
            setMessages((current) => [...current, event.assistantMessage!]);
            setAssistantDraft("");
            setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, messageCount: item.messageCount + 1, preview: event.assistantMessage!.content, updatedAt: new Date().toISOString() } : item));
          } else if (event.type === "error") {
            throw new Error(event.error ?? t.operationFailed);
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error(t.operationFailed);
    } catch (caught) {
      setAssistantDraft("");
      setInput(content);
      const message = caught instanceof Error ? caught.message : t.operationFailed;
      setError(`${message}\n${t.retryHint}`);
    } finally {
      setSending(false);
    }
  }

  function toggleMinimized() {
    setMinimized((current) => {
      const next = !current;
      window.localStorage.setItem("brooks-pa-atlas.aiReading.minimized", String(next));
      if (!next) setFrame((currentFrame) => currentFrame ? clampedFrame(currentFrame) : defaultFrame());
      return next;
    });
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,select,input,textarea")) return;
    event.preventDefault();
    const current = frame ?? defaultFrame();
    interactionRef.current = { pointerX: event.clientX, pointerY: event.clientY, frame: current };
    setFrame(current);
    setInteraction("drag");
  }

  function beginResize(
    direction: ResizeDirection,
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0 || minimized) return;
    event.preventDefault();
    event.stopPropagation();
    const current = frame ?? defaultFrame();
    interactionRef.current = { pointerX: event.clientX, pointerY: event.clientY, frame: current };
    setFrame(current);
    setInteraction(direction);
  }

  if (!open) return dialogElement;
  const activeConversation = conversations.find((item) => item.id === activeId) ?? null;
  const windowStyle = frame
    ? {
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: minimized ? 52 : frame.height,
      }
    : {
        right: 24,
        top: 80,
        width: "min(440px, calc(100vw - 24px))",
        height: minimized ? 52 : "min(70vh, 720px)",
      };

  return (
    <>
      <section
        role="dialog"
        aria-modal="false"
        aria-label={t.title}
        className={`fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20 ${interaction ? "select-none" : ""}`}
        style={windowStyle}
      >
        <div
          onPointerDown={beginDrag}
          className="flex h-[52px] shrink-0 cursor-move items-center gap-2 border-b border-zinc-200 bg-zinc-950 px-3 text-white"
        >
          <Bot className="h-4 w-4 text-cyan-300" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{t.title}</p>
            <p className="truncate text-[10px] text-zinc-400">
              {image ? `${t.currentImage}: ${image.title ?? image.originalName}` : t.currentImage}
            </p>
          </div>
          <button type="button" onClick={toggleMinimized} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10" title={minimized ? t.expand : t.collapse}>
            {minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10" title={t.close}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {!minimized ? (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-zinc-50 p-2">
              <select
                value={activeId ?? ""}
                onChange={(event) => setActiveId(event.target.value || null)}
                disabled={sending || loading}
                className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-cyan-500"
                title={activeConversation?.title ?? t.untitled}
              >
                {conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.title ?? t.untitled} ({conversation.messageCount})
                  </option>
                ))}
              </select>
              <button type="button" disabled={sending} onClick={() => void createConversation().catch((caught) => setError(caught instanceof Error ? caught.message : t.operationFailed))} className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50" title={t.newConversation}>
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </button>
              <button type="button" disabled={!activeId || sending} onClick={() => void renameConversation()} className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50" title={t.rename}>
                <PencilLine className="h-3.5 w-3.5" />
              </button>
              <button type="button" disabled={!activeId || sending} onClick={() => void clearConversation()} className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50" title={t.clear}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" disabled={!activeId || sending} onClick={() => void deleteConversation()} className="grid h-8 w-8 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50" title={t.delete}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div ref={messagePaneRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50/70 p-3">
              {nextBefore !== null ? (
                <button type="button" onClick={() => activeId && void loadMessages(activeId, nextBefore)} disabled={loading} className="mx-auto block rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
                  {loading ? t.loading : t.loadOlder}
                </button>
              ) : null}
              {loading && messages.length === 0 ? (
                <div className="grid h-full place-items-center text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : messages.length === 0 && !assistantDraft ? (
                <div className="grid h-full place-items-center px-6 text-center text-sm leading-6 text-zinc-500">{t.noMessages}</div>
              ) : null}
              {messages.map((message) => (
                <article key={message.id} className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm leading-6 shadow-sm ${message.role === "USER" ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white text-zinc-800"}`}>
                    {message.image ? (
                      <div className={`mb-1.5 truncate text-[10px] font-medium ${message.role === "USER" ? "text-cyan-200" : "text-cyan-700"}`} title={message.image.title ?? message.image.originalName}>
                        {message.image.title ?? message.image.originalName}{message.image.available ? "" : ` · ${t.unavailableImage}`}
                      </div>
                    ) : null}
                    {message.role === "ASSISTANT" ? (
                      <MarkdownContent content={message.content} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    )}
                  </div>
                </article>
              ))}
              {assistantDraft ? (
                <div className="flex justify-start">
                  <div className="max-w-[88%] rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-800 shadow-sm">
                    <MarkdownContent content={assistantDraft} />
                  </div>
                </div>
              ) : null}
              {error ? <p className="whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            </div>

            <div className="shrink-0 border-t border-zinc-200 bg-white p-3">
              {!configured ? (
                <button type="button" onClick={onOpenSettings} className="mb-2 flex w-full items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100">
                  <Settings className="h-3.5 w-3.5" />
                  <span>{t.configureHint} {t.configure}</span>
                </button>
              ) : null}
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  disabled={sending}
                  maxLength={20_000}
                  rows={2}
                  placeholder={t.placeholder}
                  className="min-h-16 min-w-0 flex-1 resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm leading-5 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:bg-zinc-100"
                />
                <button type="button" onClick={() => void sendMessage()} disabled={!activeId || !image || !input.trim() || sending || !configured} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cyan-700 text-white hover:bg-cyan-800 disabled:bg-zinc-200 disabled:text-zinc-400" title={sending ? t.sending : t.send}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-zinc-400">{t.recentContext}</p>
            </div>
          </>
        ) : null}
        {!minimized ? (
          <>
            <div aria-hidden="true" onPointerDown={(event) => beginResize("n", event)} className="absolute inset-x-3 top-0 z-20 h-2 cursor-n-resize" />
            <div aria-hidden="true" onPointerDown={(event) => beginResize("e", event)} className="absolute bottom-3 right-0 top-3 z-20 w-2 cursor-e-resize" />
            <div aria-hidden="true" onPointerDown={(event) => beginResize("s", event)} className="absolute inset-x-3 bottom-0 z-20 h-2 cursor-s-resize" />
            <div aria-hidden="true" onPointerDown={(event) => beginResize("w", event)} className="absolute bottom-3 left-0 top-3 z-20 w-2 cursor-w-resize" />
            <div aria-hidden="true" onPointerDown={(event) => beginResize("nw", event)} className="absolute left-0 top-0 z-30 h-3 w-3 cursor-nw-resize" />
            <div aria-hidden="true" onPointerDown={(event) => beginResize("ne", event)} className="absolute right-0 top-0 z-30 h-3 w-3 cursor-ne-resize" />
            <div aria-hidden="true" onPointerDown={(event) => beginResize("se", event)} className="absolute bottom-0 right-0 z-30 h-3 w-3 cursor-se-resize" />
            <div aria-hidden="true" onPointerDown={(event) => beginResize("sw", event)} className="absolute bottom-0 left-0 z-30 h-3 w-3 cursor-sw-resize" />
          </>
        ) : null}
      </section>
      {dialogElement}
    </>
  );
}
