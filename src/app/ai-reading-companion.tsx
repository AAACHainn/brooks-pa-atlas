"use client";

import {
  Bot,
  BrainCircuit,
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
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { createBrowserId } from "@/lib/browser-id";
import { notifyReadingChange, subscribeReadingChanges } from "@/lib/reading-companion-sync";
import { useAppDialog } from "@/app/app-dialog";
import type { DeepReadingPhase, DeepReadingResearch } from "@/lib/knowledge-types";
import { createBufferedReadingText, createLatestValueScheduler, shouldSendReadingInput } from "@/lib/reading-companion-ui";

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
  reasoningContent: string | null;
  reasoningDurationMs: number | null;
  createdAt: string;
  image: {
    id: string | null;
    title: string | null;
    originalName: string;
    available: boolean;
  } | null;
  answerMode?: "quick" | "deep";
  knowledge: {
    sources: Array<{
      id: string;
      citation: string;
      title: string;
      lessonCode: string | null;
      sourceType?: string;
      sourceFormat?: string;
      locator?: { kind: "subtitle"; startMs: number | null; endMs: number | null } | { kind: "text"; lineStart: number; lineEnd: number; headingPath: string[] };
      startMs: number | null;
      endMs: number | null;
      scope: "current" | "related";
      versionId?: string;
      versionNumber?: number;
      text?: string;
    }>;
    semanticSearchUsed: boolean;
    warning: "semantic_unavailable" | "no_current_binding" | "no_relevant_evidence" | null;
    research?: DeepReadingResearch;
  } | null;
};

type ReferenceImage = { id: string; title: string | null; originalName: string };
type FloatingFrame = { x: number; y: number; width: number; height: number };
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const labels = {
  zh: {
    title: "AI 阅读伴侣",
    quickAnswer: "快速回答", deepAnswer: "深度思考", stop: "停止", stopped: "已停止，未完成的回答不会保存。",
    planning: "拆解问题", retrieving: "检索资料", ranking: "排序证据", reading: "分批阅读", synthesizing: "综合回答",
    coverage: "证据覆盖", targetChunks: "目标片段", recalledChunks: "召回片段", modelCalls: "模型调用", estimatedTokens: "估算输入 Token",
    modeHint: "快速：当前图片局部问题；深度：整章总结、多课程比较和综合资料。",
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
    thinking: "思考过程",
    thinkingActive: "思考中",
    thoughtFor: "已思考",
    waitingVisibleThinking: "等待模型返回可显示的思考内容…",
    noVisibleThinking: "当前模型没有提供可显示的思考内容。",
    loadOlder: "加载更早消息",
    loading: "加载中",
    loadFailed: "无法加载伴读会话。",
    operationFailed: "操作失败",
    retryHint: "内容已恢复到输入框，可以重新发送。",
    configure: "配置阅读伴侣",
    configureHint: "请先选择可用的 AI 端点和视觉模型。",
    recentContext: "默认参考当前图片；明确比较或回看时最多使用 4 张图片。会话保存在本地。",
    knowledgeSources: "参考资料",
    knowledgeSourcesHint: "以下资料提供给 AI 参考，回答采用的依据以正文引用为准。",
    noRelevantEvidence: "未找到相关知识库资料，本次没有使用知识库片段。",
    semanticUnavailable: "本次未使用语义检索。",
    noCurrentBinding: "当前图片没有关联资料，已使用全库检索。",
  },
  en: {
    title: "AI reading companion",
    quickAnswer: "Quick answer", deepAnswer: "Deep thinking", stop: "Stop", stopped: "Stopped. The unfinished answer was not saved.",
    planning: "Planning", retrieving: "Retrieving", ranking: "Ranking evidence", reading: "Reading batches", synthesizing: "Synthesizing",
    coverage: "Evidence coverage", targetChunks: "target chunks", recalledChunks: "retrieved chunks", modelCalls: "model calls", estimatedTokens: "estimated input tokens",
    modeHint: "Quick: local image questions. Deep: chapter summaries, course comparisons and synthesis.",
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
    thinking: "Thinking",
    thinkingActive: "Thinking",
    thoughtFor: "Thought for",
    waitingVisibleThinking: "Waiting for visible reasoning from the model…",
    noVisibleThinking: "The current model did not provide visible reasoning content.",
    loadOlder: "Load older messages",
    loading: "Loading",
    loadFailed: "Could not load reading conversations.",
    operationFailed: "Operation failed",
    retryHint: "Your message was restored to the input box so you can send it again.",
    configure: "Configure reading companion",
    configureHint: "Select an available AI endpoint and vision-capable model first.",
    recentContext: "Uses the current image by default; comparisons or revisits can include up to 4 images. Chats stay saved locally.",
    knowledgeSources: "Reference materials",
    knowledgeSourcesHint: "These materials were provided to the AI; answer citations indicate the evidence used.",
    noRelevantEvidence: "No relevant knowledge materials were found; no library excerpts were used for this answer.",
    semanticUnavailable: "Semantic retrieval was unavailable for this answer.",
    noCurrentBinding: "The current image has no linked material; the full library was searched.",
  },
} as const;

const defaultWindowWidth = 440;
const minimumWindowWidth = 320;
const minimumWindowHeight = 320;
const viewportMargin = 12;

function knowledgeTime(value: number | null) {
  if (value === null) return "--:--";
  const seconds = Math.floor(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function knowledgeLocation(source: Message["knowledge"] extends { sources: Array<infer T> } | null ? T : never) {
  if (source.locator?.kind === "text") {
    const heading = source.locator.headingPath.join(" / ");
    return `${heading ? `${heading} · ` : ""}L${source.locator.lineStart}–L${source.locator.lineEnd}`;
  }
  return `${knowledgeTime(source.startMs)}–${knowledgeTime(source.endMs)}`;
}

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

const markdownPlugins = [remarkGfm];
const markdownComponents: Components = {
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
};

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function formattedThinkingTime(durationMs: number, locale: Locale) {
  const seconds = Math.max(0, durationMs) / 1000;
  const value = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return locale === "zh" ? `${value} 秒` : `${value}s`;
}

const ReasoningPanel = memo(function ReasoningPanel({
  content,
  durationMs,
  active,
  startedAt = 0,
  locale,
  defaultExpanded = false,
}: {
  content: string;
  durationMs: number;
  active: boolean;
  startedAt?: number;
  locale: Locale;
  defaultExpanded?: boolean;
}) {
  const t = labels[locale];
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!active) return;
    const updateElapsed = () => setElapsedMs(Date.now() - startedAt);
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  const time = formattedThinkingTime(active ? elapsedMs : durationMs, locale);

  return (
    <section className="mb-2 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/70 text-zinc-700">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs font-medium hover:bg-amber-100/70"
        aria-expanded={expanded}
      >
        {active ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-700" />
        ) : (
          <BrainCircuit className="h-3.5 w-3.5 shrink-0 text-amber-700" />
        )}
        <span>{t.thinking}</span>
        <span className="font-normal text-zinc-500">
          {active ? t.thinkingActive : t.thoughtFor} · {time}
        </span>
        {expanded ? (
          <ChevronUp className="ml-auto h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0" />
        )}
      </button>
      {expanded ? (
        <div className="border-t border-amber-200 px-3 py-2 text-xs leading-5 text-zinc-600">
          {content ? (
            <MarkdownContent content={content} />
          ) : (
            <p className="italic text-zinc-500">
              {active ? t.waitingVisibleThinking : t.noVisibleThinking}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
});

const MessageItem = memo(function MessageItem({ message, locale }: { message: Message; locale: Locale }) {
  const t = labels[locale];
  return (
    <article className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm leading-6 shadow-sm ${message.role === "USER" ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white text-zinc-800"}`}>
        <p className={`mb-1 text-[10px] font-medium ${message.role === "USER" ? "text-zinc-300" : "text-cyan-700"}`}>
          {message.answerMode === "deep" ? t.deepAnswer : t.quickAnswer}
        </p>
        {message.image ? (
          <div className={`mb-1.5 truncate text-[10px] font-medium ${message.role === "USER" ? "text-cyan-200" : "text-cyan-700"}`} title={message.image.title ?? message.image.originalName}>
            {message.image.title ?? message.image.originalName}{message.image.available ? "" : ` · ${t.unavailableImage}`}
          </div>
        ) : null}
        {message.role === "ASSISTANT" ? (
          <>
            {message.reasoningContent || message.reasoningDurationMs !== null ? (
              <ReasoningPanel
                content={message.reasoningContent ?? ""}
                durationMs={message.reasoningDurationMs ?? 0}
                active={false}
                locale={locale}
              />
            ) : null}
            <MarkdownContent content={message.content} />
            {message.knowledge?.research ? (
              <details className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] leading-5">
                <summary className="cursor-pointer font-semibold">
                  {t.coverage} · {message.knowledge.research.coverage.readChunks}/{message.knowledge.research.coverage.availableChunks} {message.knowledge.research.intent === "summary" ? t.targetChunks : t.recalledChunks}
                </summary>
                <p>{message.knowledge.research.modelCalls} {t.modelCalls} · {t.estimatedTokens} {message.knowledge.research.estimatedInputTokens.toLocaleString()}</p>
                {message.knowledge.research.coverage.documents.map((doc) => (
                  <p key={doc.documentId}>{doc.title} · {doc.readChunks}/{doc.availableChunks}</p>
                ))}
                {message.knowledge.research.warnings.map((warning) => <p key={warning} className="text-amber-800">{warning}</p>)}
              </details>
            ) : null}
            {message.knowledge?.sources.length ? (
              <details className="mt-2 rounded-md border border-cyan-100 bg-cyan-50/60 px-2 py-1.5 text-[11px] leading-4 text-cyan-950">
                <summary className="cursor-pointer font-semibold">{t.knowledgeSources} · {message.knowledge.sources.length}</summary>
                <div className="mt-1.5 space-y-1.5">
                  {message.knowledge.warning ? (
                    <p className="text-amber-700">
                      {message.knowledge.warning === "no_relevant_evidence" ? t.noRelevantEvidence : message.knowledge.warning === "semantic_unavailable" ? t.semanticUnavailable : t.noCurrentBinding}
                    </p>
                  ) : null}
                  <p className="text-cyan-800">{t.knowledgeSourcesHint}</p>
                  {message.knowledge.sources.map((source) => (
                    <details key={`${message.id}-${source.citation}`} className="rounded border border-cyan-100 bg-white/70 px-2 py-1">
                      <summary className="cursor-pointer">
                        <span className="font-semibold">[{source.citation}]</span>{" "}
                        {source.lessonCode ? `${source.lessonCode} · ` : ""}{source.title}{" · "}{knowledgeLocation(source)}
                      </summary>
                      <p className="mt-1 text-zinc-500" title={source.versionId}>{source.sourceType}{source.versionNumber ? ` · v${source.versionNumber}` : ""}{source.versionId ? ` · ${source.versionId.slice(0, 12)}` : ""}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{source.text}</p>
                    </details>
                  ))}
                </div>
              </details>
            ) : message.knowledge?.warning ? (
              <p className="mt-2 text-[11px] text-amber-700">
                {message.knowledge.warning === "no_relevant_evidence" ? t.noRelevantEvidence : message.knowledge.warning === "semantic_unavailable" ? t.semanticUnavailable : t.noCurrentBinding}
              </p>
            ) : null}
          </>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
      </div>
    </article>
  );
});

const MessageList = memo(function MessageList({ messages, locale }: { messages: Message[]; locale: Locale }) {
  return messages.map((message) => <MessageItem key={message.id} message={message} locale={locale} />);
});

type ComposerHandle = { setValue: (value: string) => void };
type ReadingProgress = { phase: DeepReadingPhase; completed?: number; total?: number };

const ReadingComposer = memo(function ReadingComposer({
  composerRef, locale, configured, canSend, sending, answerMode, progress,
  onInputChange, onSend, onStop, onAnswerModeChange, onOpenSettings,
}: {
  composerRef: RefObject<ComposerHandle | null>;
  locale: Locale;
  configured: boolean;
  canSend: boolean;
  sending: boolean;
  answerMode: "quick" | "deep";
  progress: ReadingProgress | null;
  onInputChange: (value: string) => void;
  onSend: () => Promise<void>;
  onStop: () => void;
  onAnswerModeChange: (mode: "quick" | "deep") => void;
  onOpenSettings: () => void;
}) {
  const t = labels[locale];
  const [input, setInput] = useState("");
  const composingRef = useRef(false);
  useImperativeHandle(composerRef, () => ({ setValue: setInput }), []);
  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white p-3">
      {!configured ? (
        <button type="button" onClick={onOpenSettings} className="mb-2 flex w-full items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100">
          <Settings className="h-3.5 w-3.5" />
          <span>{t.configureHint} {t.configure}</span>
        </button>
      ) : null}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-3" role="group" aria-label={t.modeHint}>
          {(["quick", "deep"] as const).map((mode) => (
            <button key={mode} type="button" disabled={sending} aria-pressed={answerMode === mode}
              onClick={() => onAnswerModeChange(mode)} title={t.modeHint}
              className={`border-b-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:opacity-60 ${answerMode === mode ? "border-cyan-700 text-cyan-800" : "border-transparent text-zinc-500 hover:text-cyan-700"}`}>
              {mode === "quick" ? t.quickAnswer : t.deepAnswer}
            </button>
          ))}
        </div>
        {sending ? <button type="button" onClick={onStop}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100">{t.stop}</button> : null}
      </div>
      {progress ? <p role="status" className="mb-2 flex items-center gap-2 text-xs text-cyan-800">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />{t[progress.phase]}
        {progress.total !== undefined ? ` · ${progress.completed ?? 0}/${progress.total}` : ""}
      </p> : null}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            onInputChange(event.target.value);
          }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={(event) => {
            if (shouldSendReadingInput(event.nativeEvent, composingRef.current)) {
              event.preventDefault();
              void onSend();
            }
          }}
          disabled={sending}
          maxLength={20_000}
          rows={2}
          placeholder={t.placeholder}
          className="min-h-16 min-w-0 flex-1 resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm leading-5 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:bg-zinc-100"
        />
        <button type="button" onClick={() => void onSend()} disabled={!canSend || !input.trim() || sending || !configured} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cyan-700 text-white hover:bg-cyan-800 disabled:bg-zinc-200 disabled:text-zinc-400" title={sending ? t.sending : t.send}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-zinc-400">{t.recentContext}</p>
    </div>
  );
});

type ReadingCompanionProps = { open: boolean; locale: Locale; image: ReferenceImage | null; configured: boolean; onClose: () => void; onOpenSettings: () => void; embedded?: boolean; onSending?: (sending: boolean) => void };
export default function AiReadingCompanion(props: ReadingCompanionProps) { return <ReadingCompanionSession {...props} />; }

export function ReadingCompanionSession({
  open,
  locale,
  image,
  configured,
  onClose,
  onOpenSettings, embedded = false, onSending,
}: {
  embedded?: boolean; onSending?: (sending: boolean) => void;
  open: boolean;
  locale: Locale;
  image: ReferenceImage | null;
  configured: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const t = labels[locale];
  const preferencePrefix = embedded ? "brooks-pa-atlas.aiRobot.reading" : "brooks-pa-atlas.aiReading";
  const origin = useRef("");
  useEffect(() => { origin.current = createBrowserId(); }, []);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const inputValueRef = useRef("");
  const composerRef = useRef<ComposerHandle | null>(null);
  const windowRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [answerMode, setAnswerMode] = useState<"quick" | "deep">("quick");
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const sendAbortRef = useRef<AbortController | null>(null);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantReasoningDraft, setAssistantReasoningDraft] = useState("");
  const [thinkingActive, setThinkingActive] = useState(false);
  const [thinkingElapsedMs, setThinkingElapsedMs] = useState(0);
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
  const savedMessageScrollRef = useRef<{ scrollTop: number; stickToBottom: boolean } | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [thinkingStartedAt, setThinkingStartedAt] = useState(0);
  const { showAlert, showConfirm, showPrompt, dialogElement } = useAppDialog({
    confirm: t.confirm,
    cancel: t.cancel,
  });

  const createConversation = useCallback(async () => {
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
    notifyReadingChange(origin.current);
    return result.conversation;
  }, [t.operationFailed]);

  const loadConversations = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/reading-companion/conversations", { cache: "no-store" });
      const result = (await response.json().catch(() => null)) as
        | { conversations?: Conversation[]; error?: string }
        | null;
      if (!response.ok || !result?.conversations) throw new Error(result?.error ?? t.loadFailed);
      setConversations(result.conversations);
      const candidate = preferredId ?? activeIdRef.current;
      if (candidate && result.conversations.some((item) => item.id === candidate)) {
        setActiveId(candidate);
        return candidate;
      } else if (result.conversations[0]) {
        setActiveId(result.conversations[0].id);
        return result.conversations[0].id;
      } else {
        return (await createConversation()).id;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [createConversation, t.loadFailed]);

  const loadMessages = useCallback(async (conversationId: string, before?: number, preserveHistory = false) => {
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
      const pane = messagePaneRef.current, height = pane?.scrollHeight ?? 0, top = pane?.scrollTop ?? 0;
      if (before !== undefined) savedMessageScrollRef.current = { scrollTop: top, stickToBottom: false };
      setMessages((current) => {
        if (before !== undefined) return [...result.messages!, ...current];
        if (preserveHistory && result.nextBefore !== null && result.messages!.length) {
          const first = result.messages![0].sequence;
          return [...current.filter((message) => message.sequence < first), ...result.messages!];
        }
        return result.messages!;
      });
      if (before !== undefined) requestAnimationFrame(() => {
        if (pane) { pane.scrollTop = top + pane.scrollHeight - height; savedMessageScrollRef.current = { scrollTop: pane.scrollTop, stickToBottom: false }; }
      });
      setNextBefore(result.nextBefore ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.loadFailed]);

  useEffect(() => { onSending?.(sending); }, [sending, onSending]);
  useEffect(() => subscribeReadingChanges((sender) => {
    if (sender === origin.current || !open || sending) return;
    void loadConversations(activeIdRef.current ?? undefined).then((id) => { if (id && id === activeIdRef.current) void loadMessages(id, undefined, true); });
    // Each surface keeps its selection, input and scroll independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [open, sending]);

  const rememberInput = useCallback((value: string) => { inputValueRef.current = value; }, []);
  const updateInput = useCallback((value: string) => {
    inputValueRef.current = value;
    composerRef.current?.setValue(value);
  }, []);
  const stopSending = useCallback(() => { sendAbortRef.current?.abort(); }, []);

  useLayoutEffect(() => {
    if (open) composerRef.current?.setValue(inputValueRef.current);
  }, [open]);

  useEffect(() => () => sendAbortRef.current?.abort(), []);
  useEffect(() => { if (!open) sendAbortRef.current?.abort(); }, [open]);

  useEffect(() => {
    const storedPosition = window.localStorage.getItem(`${preferencePrefix}.position`);
    const storedSize = window.localStorage.getItem(`${preferencePrefix}.size`);
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
    const restoredMinimized = window.localStorage.getItem(`${preferencePrefix}.minimized`) === "true";
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
  }, [preferencePrefix]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setFrame((current) => current ?? defaultFrame());
      void loadConversations(window.localStorage.getItem(`${preferencePrefix}.conversation`) ?? undefined).then((id) => { if (id && id === activeIdRef.current) void loadMessages(id, undefined, true); });
    }, 0);
    return () => window.clearTimeout(timer);
    // Only initialize when the floating window is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (!activeId) return;
    window.localStorage.setItem(`${preferencePrefix}.conversation`, activeId);
    const timer = window.setTimeout(() => { void loadMessages(activeId); }, 0);
    return () => window.clearTimeout(timer);
    // loadMessages deliberately reads the latest locale labels without making
    // an active conversation reload whenever the interface language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    const pane = messagePaneRef.current;
    if (!pane) return;
    const saved = savedMessageScrollRef.current;
    pane.scrollTop = !saved || saved.stickToBottom ? pane.scrollHeight : Math.min(saved.scrollTop, Math.max(0, pane.scrollHeight - pane.clientHeight));
  }, [assistantDraft, assistantReasoningDraft, messages.length]);

  useLayoutEffect(() => {
    if (!open || minimized) return;
    const pane = messagePaneRef.current;
    if (!pane) return;
    const saved = savedMessageScrollRef.current;
    if (saved) {
      pane.scrollTop = saved.stickToBottom
        ? pane.scrollHeight
        : Math.min(saved.scrollTop, Math.max(0, pane.scrollHeight - pane.clientHeight));
    }
  }, [minimized, open]);

  useEffect(() => {
    function handleResize() {
      setFrame((current) => (current ? clampedFrame(current) : current));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!interaction || !open) return;
    const activeInteraction = interaction;
    let latestFrame = interactionRef.current.frame;
    const updates = createLatestValueScheduler<FloatingFrame>((next) => {
      if (activeInteraction === "drag") {
        // Keep message rendering and layout out of the drag animation.
        if (windowRef.current) windowRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
      } else {
        setFrame(next);
      }
    }, window.requestAnimationFrame.bind(window), window.cancelAnimationFrame.bind(window));
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = activeInteraction === "drag" ? "grabbing" : `${activeInteraction}-resize`;
    function handlePointerMove(event: PointerEvent) {
      const deltaX = event.clientX - interactionRef.current.pointerX;
      const deltaY = event.clientY - interactionRef.current.pointerY;
      if (activeInteraction === "drag") {
        const start = interactionRef.current.frame;
        latestFrame = clampedFrame({ ...start, x: start.x + deltaX, y: start.y + deltaY });
      } else {
        latestFrame = resizedFrame(interactionRef.current.frame, activeInteraction, deltaX, deltaY);
      }
      updates.queue(latestFrame);
    }
    function handlePointerUp() {
      // A pointerup can arrive before the scheduled animation frame.
      updates.flush();
      setFrame(latestFrame);
      setInteraction(null);
      window.localStorage.setItem(`${preferencePrefix}.position`, JSON.stringify({ x: latestFrame.x, y: latestFrame.y }));
      window.localStorage.setItem(`${preferencePrefix}.size`, JSON.stringify({ width: latestFrame.width, height: latestFrame.height }));
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      updates.cancel();
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [interaction, open, preferencePrefix]);

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
    notifyReadingChange(origin.current);
    setConversations((items) => items.map((item) => item.id === current.id ? { ...item, title } : item));
  }

  async function clearConversation() {
    if (!activeId || sending) return;
    if (!(await showConfirm({ title: t.clearTitle, message: t.clearMessage, tone: "danger" }))) return;
    const response = await fetch(`/api/ai/reading-companion/conversations/${activeId}/messages`, {
      method: "DELETE",
    });
    if (!response.ok) return void showAlert({ title: t.operationFailed, message: t.loadFailed, tone: "danger" });
    notifyReadingChange(origin.current);
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
    notifyReadingChange(origin.current);
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

  const sendMessage = useCallback(async () => {
    const content = inputValueRef.current.trim();
    if (!activeId || !image || !content || sending) return;
    if (!configured) {
      onOpenSettings();
      return;
    }
    const conversationId = activeId;
    updateInput("");
    setError(null);
    setAssistantDraft("");
    setAssistantReasoningDraft("");
    setThinkingActive(false);
    setThinkingElapsedMs(0);
    setSending(true);
    const sendAbort = new AbortController();
    sendAbortRef.current = sendAbort;
    setProgress(answerMode === "deep" ? { phase: "planning" } : null);
    const scheduleText = (callback: () => void) => window.setTimeout(callback, 50);
    const cancelText = (handle: number) => window.clearTimeout(handle);
    const answerBuffer = createBufferedReadingText(setAssistantDraft, scheduleText, cancelText);
    const reasoningBuffer = createBufferedReadingText(setAssistantReasoningDraft, scheduleText, cancelText);
    try {
      const response = await fetch(
        `/api/ai/reading-companion/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: image.id, content, answerMode }),
          signal: sendAbort.signal,
        },
      );
      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? t.operationFailed);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: "start" | "progress" | "ping" | "thinking_start" | "reasoning_delta" | "thinking_done" | "delta" | "done" | "error";
            phase?: DeepReadingPhase;
            completed?: number;
            total?: number;
            text?: string;
            error?: string;
            durationMs?: number;
            userMessage?: Message;
            assistantMessage?: Message;
            conversation?: { id: string; title: string | null };
          };
          if (event.type === "start" && event.userMessage) {
            setMessages((current) => current.some((item) => item.id === event.userMessage!.id) ? current : [...current, event.userMessage!]);
            if (event.conversation) {
              setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, title: event.conversation!.title, messageCount: item.messageCount + 1, preview: content, updatedAt: new Date().toISOString() } : item));
            }
          } else if (event.type === "progress" && event.phase) {
            setProgress({ phase: event.phase, completed: event.completed, total: event.total });
          } else if (event.type === "thinking_start") {
            setThinkingStartedAt(Date.now());
            setThinkingElapsedMs(0);
            setThinkingActive(true);
          } else if (event.type === "reasoning_delta") {
            reasoningBuffer.append(event.text ?? "");
          } else if (event.type === "thinking_done") {
            reasoningBuffer.flush();
            setThinkingActive(false);
            setThinkingElapsedMs(event.durationMs ?? 0);
          } else if (event.type === "delta") {
            answerBuffer.append(event.text ?? "");
          } else if (event.type === "done" && event.assistantMessage) {
            completed = true;
            answerBuffer.dispose();
            reasoningBuffer.dispose();
            setMessages((current) => [...current, event.assistantMessage!]);
            setAssistantDraft("");
            setAssistantReasoningDraft("");
            setThinkingActive(false);
            setThinkingElapsedMs(0);
            setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, messageCount: item.messageCount + 1, preview: event.assistantMessage!.content, updatedAt: new Date().toISOString() } : item));
          } else if (event.type === "error") {
            throw new Error(event.error ?? t.operationFailed);
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error(t.operationFailed);
    } catch (caught) {
      answerBuffer.dispose();
      reasoningBuffer.dispose();
      setAssistantDraft("");
      setAssistantReasoningDraft("");
      setThinkingActive(false);
      setThinkingElapsedMs(0);
      updateInput(content);
      const message = caught instanceof Error ? caught.message : t.operationFailed;
      setError(sendAbort.signal.aborted ? t.stopped : `${message}\n${t.retryHint}`);
    } finally {
      answerBuffer.dispose();
      reasoningBuffer.dispose();
      setSending(false);
      notifyReadingChange(origin.current);
      void loadConversations(conversationId).then((id) => { if (id && id === activeIdRef.current) void loadMessages(id, undefined, true); });
      setProgress(null);
      if (sendAbortRef.current === sendAbort) sendAbortRef.current = null;
    }
  }, [activeId, image, configured, sending, onOpenSettings, answerMode, updateInput, loadConversations, loadMessages, t.operationFailed, t.retryHint, t.stopped]);

  function rememberMessageScrollPosition() {
    const pane = messagePaneRef.current;
    if (!pane) return;
    const distanceFromBottom = pane.scrollHeight - pane.clientHeight - pane.scrollTop;
    savedMessageScrollRef.current = {
      scrollTop: pane.scrollTop,
      stickToBottom: distanceFromBottom <= 24,
    };
  }

  function toggleMinimized() {
    if (!minimized) rememberMessageScrollPosition();
    setMinimized((current) => {
      const next = !current;
      window.localStorage.setItem(`${preferencePrefix}.minimized`, String(next));
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
        left: 0,
        top: 0,
        transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`,
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
        ref={windowRef}
        role="dialog"
        aria-modal="false"
        aria-label={t.title}
        className={`${embedded ? "relative min-h-0 flex-1 bg-white" : "fixed z-[60] rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20"} flex flex-col overflow-hidden ${interaction ? "select-none" : ""}`}
        style={embedded ? undefined : { ...windowStyle, willChange: interaction === "drag" ? "transform" : undefined }}
      >
        <div
          onPointerDown={beginDrag}
          className={`${embedded ? "hidden" : "flex"} h-[52px] shrink-0 cursor-move items-center gap-2 border-b border-zinc-200 bg-zinc-950 px-3 text-white`}
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

        <div className={`${!embedded && minimized ? "hidden" : "flex"} min-h-0 flex-1 flex-col`}>
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

            <div ref={messagePaneRef} onScroll={rememberMessageScrollPosition} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50/70 p-3">
              {nextBefore !== null ? (
                <button type="button" onClick={() => activeId && void loadMessages(activeId, nextBefore)} disabled={loading} className="mx-auto block rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
                  {loading ? t.loading : t.loadOlder}
                </button>
              ) : null}
              {loading && messages.length === 0 ? (
                <div className="grid h-full place-items-center text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : messages.length === 0 && !assistantDraft && !thinkingActive ? (
                <div className="grid h-full place-items-center px-6 text-center text-sm leading-6 text-zinc-500">{t.noMessages}</div>
              ) : null}
              <MessageList messages={messages} locale={locale} />
              {thinkingActive || assistantReasoningDraft || assistantDraft ? (
                <div className="flex justify-start">
                  <div className="max-w-[88%] rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-800 shadow-sm">
                    <ReasoningPanel
                      content={assistantReasoningDraft}
                      durationMs={thinkingElapsedMs}
                      startedAt={thinkingStartedAt}
                      active={thinkingActive}
                      locale={locale}
                      defaultExpanded
                    />
                    {assistantDraft ? <MarkdownContent content={assistantDraft} /> : null}
                  </div>
                </div>
              ) : null}
              {error ? <p className="whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            </div>

            <ReadingComposer
              composerRef={composerRef}
              locale={locale}
              configured={configured}
              canSend={Boolean(activeId && image)}
              sending={sending}
              answerMode={answerMode}
              progress={progress}
              onInputChange={rememberInput}
              onSend={sendMessage}
              onStop={stopSending}
              onAnswerModeChange={setAnswerMode}
              onOpenSettings={onOpenSettings}
            />
        </div>
        {!embedded && !minimized ? (
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
