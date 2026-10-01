"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Eye,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type KnowledgeImportJobItemView = {
  id: string;
  sourceFileName: string;
  targetIndexPath: string;
  versionId: string | null;
  status: string;
  phase: string;
  retryCount: number;
  error: string | null;
  errorPhase: string | null;
  progressCompleted: number;
  progressTotal: number;
  progressUnit: string | null;
  stageStartedAt: string | null;
  lastProgressAt: string | null;
  currentWindow: number | null;
  currentAttempt: number | null;
  maxAttempts: number | null;
};

export type KnowledgeImportJobView = {
  id: string;
  status: string;
  phase: string;
  totalItems: number;
  processedItems: number;
  completedItems: number;
  failedItems: number;
  items: KnowledgeImportJobItemView[];
};

type Copy = {
  approve: string;
  approveAll: string;
  reject: string;
  retry: string;
  review: string;
};

const phaseLabels = {
  zh: {
    RUNNING: "导入中",
    PENDING: "等待处理",
    QUEUED: "等待处理",
    READING_SOURCE: "读取并解析字幕",
    PARSED: "字幕解析完成",
    AI_PROCESSING: "AI 字幕整理",
    CHUNKING: "生成知识片段",
    EMBEDDING: "生成 Embedding",
    FTS_INDEXING: "建立全文索引",
    ACTIVATING: "激活新版本",
    AWAITING_REVIEW: "等待人工审核",
    COMPLETED: "导入完成",
    FAILED: "导入失败",
    REJECTED: "已拒绝",
    COMPLETED_WITH_ERRORS: "完成（有错误）",
  },
  en: {
    RUNNING: "Running",
    PENDING: "Queued",
    QUEUED: "Queued",
    READING_SOURCE: "Reading and parsing subtitles",
    PARSED: "Parsed",
    AI_PROCESSING: "AI subtitle cleanup",
    CHUNKING: "Creating knowledge chunks",
    EMBEDDING: "Creating embeddings",
    FTS_INDEXING: "Building full-text index",
    ACTIVATING: "Activating version",
    AWAITING_REVIEW: "Awaiting review",
    COMPLETED: "Completed",
    FAILED: "Failed",
    REJECTED: "Rejected",
    COMPLETED_WITH_ERRORS: "Completed with errors",
  },
} as const;

function parseTimestamp(value: string | null) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDuration(milliseconds: number, locale: "zh" | "en") {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return locale === "zh" ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return locale === "zh" ? `${minutes} 分 ${remainder} 秒` : `${minutes}m ${remainder}s`;
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "FAILED" || status === "REJECTED" || status === "COMPLETED_WITH_ERRORS") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "AWAITING_REVIEW") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "RUNNING") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "COMPLETED") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "FAILED" || status === "REJECTED") return <XCircle className="h-4 w-4 text-rose-600" />;
  if (status === "RUNNING") return <Loader2 className="h-4 w-4 animate-spin text-cyan-700" />;
  if (status === "AWAITING_REVIEW") return <Eye className="h-4 w-4 text-amber-700" />;
  return <Circle className="h-4 w-4 text-zinc-300" />;
}

export default function KnowledgeImportProgress({
  job,
  locale,
  copy,
  onReview,
  onApprove,
  onReject,
  onRetry,
  onApproveAll,
}: {
  job: KnowledgeImportJobView;
  locale: "zh" | "en";
  copy: Copy;
  onReview: (item: KnowledgeImportJobItemView) => void;
  onApprove: (item: KnowledgeImportJobItemView) => void;
  onReject: (item: KnowledgeImportJobItemView) => void;
  onRetry: (item: KnowledgeImportJobItemView) => void;
  onApproveAll: (items: KnowledgeImportJobItemView[]) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = job.status === "RUNNING" || job.status === "QUEUED";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const counts = useMemo(() => ({
    completed: job.items.filter((item) => item.status === "COMPLETED").length,
    failed: job.items.filter((item) => item.status === "FAILED").length,
    running: job.items.filter((item) => item.status === "RUNNING").length,
    queued: job.items.filter((item) => item.status === "PENDING").length,
    awaiting: job.items.filter((item) => item.status === "AWAITING_REVIEW").length,
  }), [job.items]);
  const terminal = counts.completed + counts.failed + job.items.filter((item) => item.status === "REJECTED").length;
  const processed = terminal + counts.awaiting;
  const overallPercent = job.totalItems ? Math.round(processed / job.totalItems * 100) : 0;
  const labels = phaseLabels[locale];

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{locale === "zh" ? "导入进度" : "Import progress"}</h3>
            <p className="mt-1 text-xs text-zinc-500">
              {locale === "zh"
                ? `已处理 ${processed}/${job.totalItems} · 成功 ${counts.completed} · 失败 ${counts.failed} · 审核中 ${counts.awaiting} · 处理中 ${counts.running} · 等待 ${counts.queued}`
                : `Processed ${processed}/${job.totalItems} · ${counts.completed} completed · ${counts.failed} failed · ${counts.awaiting} awaiting review · ${counts.running} running · ${counts.queued} queued`}
            </p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(job.status)}`}>
            {labels[job.status as keyof typeof labels] ?? job.status}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200" aria-label={`${overallPercent}%`}>
          <div className="h-full rounded-full bg-cyan-700 transition-all" style={{ width: `${overallPercent}%` }} />
        </div>
      </div>

      <div className="divide-y divide-zinc-200">
        {job.items.map((item) => {
          const progressPercent = item.progressTotal > 0
            ? Math.min(100, Math.round(item.progressCompleted / item.progressTotal * 100))
            : 0;
          const lastProgressAt = parseTimestamp(item.lastProgressAt);
          const stageStartedAt = parseTimestamp(item.stageStartedAt);
          const idleFor = lastProgressAt === null ? 0 : now - lastProgressAt;
          const slow = item.status === "RUNNING" && idleFor >= 60_000;
          const possiblyStalled = item.status === "RUNNING" && idleFor >= 270_000;
          const remaining = item.phase === "AI_PROCESSING" && item.progressCompleted >= 2
            && stageStartedAt !== null && lastProgressAt !== null
            ? (lastProgressAt - stageStartedAt) / item.progressCompleted * (item.progressTotal - item.progressCompleted)
            : null;
          const failurePhase = item.errorPhase
            ? labels[item.errorPhase as keyof typeof labels] ?? item.errorPhase
            : (locale === "zh" ? "处理" : "import");

          return (
            <article key={item.id} className={`p-4 ${item.status === "RUNNING" ? "bg-cyan-50/35" : ""}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5"><StatusIcon status={item.status} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900" title={item.sourceFileName}>{item.sourceFileName}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500" title={item.targetIndexPath}>{item.targetIndexPath}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(item.status)}`}>
                      {item.status === "RUNNING"
                        ? labels[item.phase as keyof typeof labels] ?? item.phase
                        : labels[item.status as keyof typeof labels] ?? item.status}
                    </span>
                  </div>

                  {item.status === "RUNNING" ? (
                    <div className="mt-3 rounded-md border border-cyan-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-cyan-900">
                          {labels[item.phase as keyof typeof labels] ?? item.phase}
                        </span>
                        <span className="tabular-nums text-zinc-600">
                          {item.progressCompleted}/{item.progressTotal || "—"}
                          {item.progressUnit === "windows" ? (locale === "zh" ? " 段" : " windows") : null}
                          {item.progressUnit === "batches" ? (locale === "zh" ? " 批" : " batches") : null}
                        </span>
                      </div>
                      {item.progressTotal > 0 ? (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-100">
                          <div className="h-full rounded-full bg-cyan-700 transition-all" style={{ width: `${progressPercent}%` }} />
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                        {item.currentWindow ? (
                          <span>{locale === "zh" ? `第 ${item.currentWindow} 段请求中` : `Window ${item.currentWindow} in progress`}
                            {item.currentAttempt ? ` · ${locale === "zh" ? `第 ${item.currentAttempt}/${item.maxAttempts} 次尝试` : `attempt ${item.currentAttempt}/${item.maxAttempts}`}` : ""}
                          </span>
                        ) : null}
                        {stageStartedAt !== null ? <span>{locale === "zh" ? "本阶段耗时" : "Stage elapsed"}: {formatDuration(now - stageStartedAt, locale)}</span> : null}
                        {lastProgressAt !== null ? <span>{locale === "zh" ? "距上次进展" : "Last progress"}: {formatDuration(idleFor, locale)}</span> : null}
                        {remaining !== null && remaining > 0 ? <span>{locale === "zh" ? "预计剩余" : "Estimated remaining"}: {formatDuration(remaining, locale)}</span> : null}
                      </div>
                      {slow ? (
                        <p className={`mt-2 flex items-center gap-1.5 text-xs ${possiblyStalled ? "text-rose-700" : "text-amber-700"}`}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {possiblyStalled
                            ? (locale === "zh" ? "长时间没有进展，任务可能已中断。" : "No progress for a long time; the task may be interrupted.")
                            : (locale === "zh" ? "AI 响应较慢，单次请求最多等待 120 秒。" : "The AI response is slow; one request may take up to 120 seconds.")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {item.status === "FAILED" ? (
                    <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      <p className="font-medium">{locale === "zh" ? `${failurePhase}失败` : `Failed during ${failurePhase}`}</p>
                      <p className="mt-1 break-words">{item.error}</p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.status === "AWAITING_REVIEW" ? <>
                      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50" onClick={() => onReview(item)}><Eye className="h-3 w-3" />{copy.review}</button>
                      <button className="rounded bg-emerald-700 px-2 py-1 text-xs text-white" onClick={() => onApprove(item)}>{copy.approve}</button>
                      <button className="rounded bg-rose-700 px-2 py-1 text-xs text-white" onClick={() => onReject(item)}>{copy.reject}</button>
                    </> : null}
                    {item.status === "FAILED" ? (
                      <button className="inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-700" onClick={() => onRetry(item)}>
                        <RotateCcw className="h-3 w-3" />{copy.retry}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {counts.awaiting > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span>{locale === "zh" ? `有 ${counts.awaiting} 份字幕等待审核。` : `${counts.awaiting} subtitles are awaiting review.`}</span>
          <button className="rounded bg-emerald-700 px-3 py-1.5 text-white" onClick={() => onApproveAll(job.items.filter((item) => item.status === "AWAITING_REVIEW"))}>{copy.approveAll}</button>
        </div>
      ) : null}
    </section>
  );
}
