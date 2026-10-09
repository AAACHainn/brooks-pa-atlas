"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";
import { useAppDialog } from "@/app/app-dialog";
import { aiOcrBatchIsActive, type AiOcrBatchMode, type AiOcrBatchPreview, type AiOcrBatchSnapshot } from "@/lib/ai-ocr-batch-types";

const labels = {
  zh: { title: "批量 AI 精校", confirm: "确认开始", cancel: "取消", close: "关闭", loading: "正在读取范围…", refresh: "刷新预览",
    total: "图片总数", withText: "已有 OCR", missing: "无 OCR", endpoint: "端点 / 模型", missingChoice: "只处理没有 OCR 文本的图片", allChoice: "全部重新 AI 精校",
    count: "实际处理", estimate: "预估输入 Token", note: "输入 Token 预算参考，实际值取决于模型，不含输出 Token。",
    save: "只识别、精校原文，不翻译。每张成功后自动保存；已有文本被覆盖，失败保留原文。",
    pause: "暂停", resume: "继续", retry: "重试失败项", success: "成功", failed: "失败", skipped: "跳过", attempts: "请求次数",
    input: "已报告输入", output: "已报告输出", unavailable: "未报告", reported: "次请求有报告", error: "连接或操作失败", issues: "失败 / 跳过明细（最多 20 项）",
    cancelNote: "取消会中止当前请求，已经保存的结果保留。", remainder: "仅处理剩余清单；已成功图片不会重复处理。",
    states: { RUNNING: "运行中", PAUSING: "当前张保存后暂停", PAUSED: "已暂停", COMPLETED: "已完成", COMPLETED_WITH_ERRORS: "完成，有失败项", CANCELLED: "已取消" } },
  en: { title: "Batch AI refinement", confirm: "Confirm and start", cancel: "Cancel", close: "Close", loading: "Loading scope…", refresh: "Refresh preview",
    total: "Total images", withText: "With OCR", missing: "Without OCR", endpoint: "Endpoint / model", missingChoice: "Only images without OCR text", allChoice: "Refine every image again",
    count: "Images to process", estimate: "Estimated input tokens", note: "Input budget estimate; actual usage depends on the model. Output tokens excluded.",
    save: "Extract and refine the original language. Each success is saved automatically, replacing existing OCR. Failures retain the original text.",
    pause: "Pause", resume: "Resume", retry: "Retry failed images", success: "Succeeded", failed: "Failed", skipped: "Skipped", attempts: "Requests",
    input: "Reported input", output: "Reported output", unavailable: "Not reported", reported: "requests reported", error: "Connection or action failed", issues: "Failed / skipped details (up to 20)",
    cancelNote: "Cancel aborts the current request and keeps saved results.", remainder: "Only the remaining manifest is processed. Saved images are not repeated.",
    states: { RUNNING: "Running", PAUSING: "Pausing after saving this image", PAUSED: "Paused", COMPLETED: "Completed", COMPLETED_WITH_ERRORS: "Completed with errors", CANCELLED: "Cancelled" } },
};
const savedJobKey = "brooks-pa-atlas.aiOcrBatch.job";
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result as T;
}
export function useAiOcrBatch(locale: "zh" | "en", onCommitted: () => void) {
  const t = labels[locale];
  const [job, setJob] = useState<AiOcrBatchSnapshot | null>(null);
  const [dialog, setDialog] = useState<{ indexId?: string; action: "start" | "resume" | "retry" } | null>(null);
  const [preview, setPreview] = useState<AiOcrBatchPreview | null>(null);
  const [mode, setMode] = useState<AiOcrBatchMode>("missing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const committedRef = useRef({ id: "", count: 0 });
  const callback = useRef(onCommitted);
  const appDialog = useAppDialog({ confirm: locale === "zh" ? "确认" : "Confirm", cancel: t.cancel });
  const jobId = job?.id, jobStatus = job?.status;
  useEffect(() => { callback.current = onCommitted; }, [onCommitted]);
  const accept = useCallback((next: AiOcrBatchSnapshot | null) => {
    setJob((current) => current && next && current.id === next.id && (current.revision > next.revision || current.updatedAt > next.updatedAt) ? current : next);
    if (next && (committedRef.current.id !== next.id || committedRef.current.count !== next.completedImages)) {
      committedRef.current = { id: next.id, count: next.completedImages };
      if (next.completedImages) callback.current();
    }
    if (next) { try { localStorage.setItem(savedJobKey, next.id); } catch {} }
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<{ job: AiOcrBatchSnapshot | null }>("/api/ai/ocr-refine/jobs/active");
      let next = r.job;
      if (!next) {
        let savedId: string | null = null;
        try { savedId = localStorage.getItem(savedJobKey); } catch {}
        if (savedId) next = (await api<{ job: AiOcrBatchSnapshot }>(`/api/ai/ocr-refine/jobs/${encodeURIComponent(savedId)}`)).job;
      }
      if (live) accept(next);
    })().catch(() => {});
    return () => { live = false; };
  }, [accept]);
  useEffect(() => {
    if (!jobId || !jobStatus || !aiOcrBatchIsActive(jobStatus)) return;
    let live = true;
    const timer = window.setInterval(() => {
      void api<{ job: AiOcrBatchSnapshot }>(`/api/ai/ocr-refine/jobs/${jobId}`).then((r) => {
        if (live) { accept(r.job); setError(null); }
      }).catch((e) => { if (live) setError(e.message); });
    }, jobStatus === "PAUSED" ? 3000 : 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [jobId, jobStatus, accept]); // Polling does not cancel the server worker on unmount.
  async function loadPreview(indexId?: string, action: "start" | "resume" | "retry" = "start") {
    setBusy(true); setError(null); setPreview(null);
    try {
      const p = action === "start" ? await api<AiOcrBatchPreview>(`/api/ai/ocr-refine/index-nodes/${indexId}/batch`)
        : (await api<{ preview: AiOcrBatchPreview }>(`/api/ai/ocr-refine/jobs/${job!.id}/actions`, { action: `preview_${action}`, revision: job!.revision })).preview;
      setPreview(p);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function open(indexId: string) {
    if (job && aiOcrBatchIsActive(job.status)) {
      await appDialog.showAlert({ title: t.title, message: locale === "zh" ? "请先继续或取消右下角的未结束任务。" : "Resume or cancel the unfinished batch first." }); return;
    }
    setMode("missing"); setDialog({ indexId, action: "start" }); await loadPreview(indexId);
  }
  async function action(name: "pause" | "resume" | "cancel" | "retry") {
    if (!job) return;
    if (name === "cancel" && !await appDialog.showConfirm({ title: t.cancel, message: t.cancelNote, tone: "warning" })) return;
    if (name === "retry") { setMode("all"); setDialog({ action: "retry" }); await loadPreview(undefined, "retry"); return; }
    setBusy(true); setError(null);
    try { accept((await api<{ job: AiOcrBatchSnapshot }>(`/api/ai/ocr-refine/jobs/${job.id}/actions`, { action: name, revision: job.revision })).job); }
    catch (e) {
      if (name === "resume") { setMode("all"); setDialog({ action: "resume" }); await loadPreview(undefined, "resume"); }
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }
  async function start() {
    if (!preview || !dialog) return;
    setBusy(true); setError(null);
    try {
      const response = dialog.action === "start"
        ? await api<{ job: AiOcrBatchSnapshot }>(`/api/ai/ocr-refine/index-nodes/${dialog.indexId}/batch`, { mode, previewToken: preview.previewToken })
        : await api<{ job: AiOcrBatchSnapshot }>(`/api/ai/ocr-refine/jobs/${job!.id}/actions`, { action: dialog.action, revision: job!.revision, previewToken: preview.previewToken });
      accept(response.job); setDialog(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const button = "rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:opacity-50";
  const card = job ? <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm shadow-2xl" role="status" aria-live="polite">
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-cyan-700" />{t.title}</p><p className="mt-1 truncate text-xs text-zinc-500" title={job.indexPath}>{job.indexPath}</p></div>
      <span className="font-semibold tabular-nums">{job.progressPercent}%</span>
      {!aiOcrBatchIsActive(job.status) ? <button className={button} aria-label={t.close} onClick={() => { setJob(null); try { localStorage.removeItem(savedJobKey); } catch {} }}><X className="h-4 w-4" /></button> : null}</div>
    <p className="mt-2 text-xs font-medium text-zinc-700">{t.states[job.status]}</p>
    {job.currentImage ? <p className="mt-1 truncate text-xs text-zinc-500" title={job.currentImage}>{job.currentImage}</p> : null}
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-cyan-700 transition-all" style={{ width: `${job.progressPercent}%` }} /></div>
    <p className="mt-2 text-xs text-zinc-500">{job.processedImages}/{job.totalImages} · {t.success} {job.completedImages} / {t.failed} {job.failedImages} / {t.skipped} {job.skippedImages}</p>
    <div className="mt-3 space-y-1 text-xs text-zinc-500"><p>{t.attempts}: {job.requests} · {t.estimate}: {job.estimatedInputTokens.toLocaleString()}</p>
      <p>{t.input}: {job.reportedInputTokens?.toLocaleString() ?? t.unavailable} ({job.inputReportedRequests}/{job.requests} {t.reported})</p>
      <p>{t.output}: {job.reportedOutputTokens?.toLocaleString() ?? t.unavailable} ({job.outputReportedRequests}/{job.requests} {t.reported})</p></div>
    {job.error || error && !dialog ? <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{job.error ?? error}</p> : null}
    {job.issues.length ? <details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">{t.issues}</summary>{job.issues.map((i, n) => <p className="mt-1 break-words" key={n}>{i.originalName}: {i.error}</p>)}</details> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {job.status === "RUNNING" ? <button className={button} disabled={busy} onClick={() => void action("pause")}>{t.pause}</button> : null}
      {job.status === "PAUSED" ? <button className={button} disabled={busy} onClick={() => void action("resume")}>{t.resume}</button> : null}
      {aiOcrBatchIsActive(job.status) ? <button className={`${button} !border-rose-200 !bg-rose-50 !text-rose-700`} disabled={busy} onClick={() => void action("cancel")}>{t.cancel}</button> : null}
      {job.failedImages && ["COMPLETED", "COMPLETED_WITH_ERRORS"].includes(job.status) ? <button className={button} disabled={busy} onClick={() => void action("retry")}>{t.retry}</button> : null}
    </div>
  </section> : null;
  const modal = dialog ? <BatchConfirm locale={locale} preview={preview} mode={mode} setMode={setMode} busy={busy} error={error}
    action={dialog.action} onClose={() => { if (!busy) setDialog(null); }} onRefresh={() => void loadPreview(dialog.indexId, dialog.action)} onStart={() => void start()} /> : null;
  return { job, open, card, dialog: <>{modal}{appDialog.dialogElement}</> };
}

function BatchConfirm({ locale, preview, mode, setMode, busy, error, action, onClose, onRefresh, onStart }: {
  locale: "zh" | "en"; preview: AiOcrBatchPreview | null; mode: AiOcrBatchMode; setMode: (mode: AiOcrBatchMode) => void;
  busy: boolean; error: string | null; action: "start" | "resume" | "retry"; onClose: () => void; onRefresh: () => void; onStart: () => void;
}) {
  const t = labels[locale], panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    panel.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key === "Tab") {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
        const first = elements[0], last = elements[elements.length - 1];
        if (!elements.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  const chosen = preview?.modes[action === "start" ? mode : "all"];
  return createPortal(<div className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ai-batch-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-2xl focus:outline-none">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4"><h2 id="ai-batch-title" className="font-semibold">{action === "retry" ? t.retry : t.title}</h2><button disabled={busy} onClick={onClose} aria-label={t.close} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"><X className="h-5 w-5" /></button></div>
      <div className="space-y-4 p-5 text-sm">
        {preview ? <><p className="break-words font-medium">{preview.indexPath}</p><div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
          <p>{t.total}<strong className="mt-1 block text-lg text-zinc-950">{preview.totalImages}</strong></p><p>{t.withText}<strong className="mt-1 block text-lg text-zinc-950">{preview.withTextImages}</strong></p><p>{t.missing}<strong className="mt-1 block text-lg text-zinc-950">{preview.withoutTextImages}</strong></p></div>
          <p className="break-words text-xs text-zinc-500">{t.endpoint}: {preview.endpoint ? `${preview.endpoint.name} / ${preview.endpoint.model} (${preview.endpoint.url})` : t.unavailable}</p>
          {action === "start" ? <fieldset className="space-y-2">{(["missing", "all"] as const).map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 p-3"><input type="radio" name="ai-batch-mode" value={value} checked={mode === value} onChange={() => setMode(value)} disabled={busy} className="accent-cyan-700" />{value === "missing" ? t.missingChoice : t.allChoice}</label>)}</fieldset> : <p className="text-xs text-zinc-500">{t.remainder}</p>}
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3"><p>{t.count}: <strong>{chosen?.count}</strong></p><p className="mt-1">{t.estimate}: <strong>{chosen?.estimatedInputTokens.toLocaleString()}</strong></p><p className="mt-2 text-xs text-cyan-800">{t.note}</p></div>
          <p className="text-xs leading-5 text-zinc-600">{t.save}</p></> : <p className="flex items-center gap-2 text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p>}
        {error || preview?.error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error ?? preview?.error}</p> : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-4"><button disabled={busy} onClick={onRefresh} className="rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50">{t.refresh}</button><button disabled={busy} onClick={onClose} className="rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50">{t.cancel}</button>
        <button disabled={busy || !preview?.endpoint || Boolean(preview.error) || !chosen?.count} onClick={onStart} className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.confirm}</button></div>
    </div></div>, document.body);
}
