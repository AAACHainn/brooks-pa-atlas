"use client";

import { BookOpen, Check, FileSearch, Loader2, Search, Trash2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppDialog } from "@/app/app-dialog";
import IndexTreeSelector, {
  flattenIndexTree,
  type IndexTreeNode,
} from "@/app/index-tree-selector";
import KnowledgeImportProgress, {
  type KnowledgeImportJobItemView,
  type KnowledgeImportJobView,
} from "@/app/knowledge-import-progress";

type Locale = "zh" | "en";
type SelectedSubtitle = { id: string; file: File; indexNodeId: string };
type JobItem = KnowledgeImportJobItemView;
type Job = KnowledgeImportJobView;
type Version = { id: string; versionNumber: number; sourceFileName: string; status: string; approvalMode: string; chunkCount: number; error: string | null };
type DocumentRow = { id: string; title: string; lessonCode: string | null; indexNodeId: string | null; indexPathSnapshot: string; bindingStatus: string; chunkCount: number; activeVersionId: string | null; versions: Version[] };
type Review = { id: string; title: string; sourceFileName: string; rawText: string; chunks: Array<{ ordinal: number; startMs: number | null; endMs: number | null; originalText: string; cleanedText: string; topic: string; keywords: string[] }> };
type MaintenanceJob = { id: string; status: string; totalItems: number; processedItems: number; error: string | null };

const text = {
  zh: {
    title: "字幕知识库", importTab: "导入字幕", libraryTab: "知识文档", testTab: "检索测试",
    choose: "选择字幕文件", chooseFolder: "选择字幕文件夹", root: "批量匹配根节点", autoMap: "自动匹配",
    mapping: "目标索引（导入前必须确认）", manual: "人工预览后再入库", manualHint: "默认关闭：AI 整理通过程序硬校验后自动批准。",
    start: "开始导入", noFiles: "请选择 .srt、.vtt、.ass 或 .txt 文件。", progress: "导入进度",
    approve: "批准", approveAll: "全部批准", reject: "拒绝", retry: "重试", review: "预览",
    original: "原字幕", cleaned: "AI 整理结果", close: "关闭", empty: "知识库中还没有字幕文档。",
    active: "当前版本", activate: "回退/启用此版本", disable: "停用", enable: "启用", delete: "删除文档",
    rebuildFts: "重建全文索引", rebuildVectors: "重建全部向量", maintenanceStarted: "向量重建已在后台启动。",
    testQuestion: "输入测试问题", search: "检索", currentNode: "当前索引范围", sources: "检索结果",
    confirmDelete: "删除字幕文档？", confirmDeleteMessage: "该文档的所有版本、片段和仅由它使用的原字幕文件将被逐个删除。",
    operationFailed: "操作失败", unmatched: "未匹配，请手动选择", resultEmpty: "没有检索到字幕片段。",
    reviewStats: "差异统计", characters: "字符", retained: "整理后占原文", ranking: "排序分", scope: "范围",
    collapseIndex: "收起索引", expandIndex: "展开索引", noMatchingIndex: "没有匹配的索引", searchIndex: "搜索索引名称或路径",
  },
  en: {
    title: "Subtitle knowledge base", importTab: "Import", libraryTab: "Documents", testTab: "Search test",
    choose: "Choose subtitle files", chooseFolder: "Choose subtitle folder", root: "Batch mapping root", autoMap: "Auto map",
    mapping: "Target index (confirmation required)", manual: "Review before activation", manualHint: "Off by default: validated AI output is approved automatically.",
    start: "Start import", noFiles: "Choose .srt, .vtt, .ass, or .txt files.", progress: "Import progress",
    approve: "Approve", approveAll: "Approve all", reject: "Reject", retry: "Retry", review: "Preview",
    original: "Original", cleaned: "AI result", close: "Close", empty: "No subtitle documents yet.",
    active: "Active version", activate: "Activate this version", disable: "Disable", enable: "Enable", delete: "Delete document",
    rebuildFts: "Rebuild full-text index", rebuildVectors: "Rebuild all vectors", maintenanceStarted: "Vector rebuild started in the background.",
    testQuestion: "Enter a test question", search: "Search", currentNode: "Current index scope", sources: "Results",
    confirmDelete: "Delete subtitle document?", confirmDeleteMessage: "All versions, chunks, and source files used only by this document will be deleted one file at a time.",
    operationFailed: "Operation failed", unmatched: "Unmatched; select manually", resultEmpty: "No subtitle chunks found.",
    reviewStats: "Difference summary", characters: "characters", retained: "retained", ranking: "score", scope: "scope",
    collapseIndex: "Collapse index", expandIndex: "Expand index", noMatchingIndex: "No matching index", searchIndex: "Search index name or path",
  },
} as const;

function id() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }
function timestamp(ms: number | null) {
  if (ms === null) return "--:--";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function KnowledgeManagerDialog({ open, locale, indexTree, initialIndexNodeId, onClose }: {
  open: boolean; locale: Locale; indexTree: IndexTreeNode[]; initialIndexNodeId: string | null; onClose: () => void;
}) {
  const t = text[locale];
  const indexes = useMemo(() => flattenIndexTree(indexTree), [indexTree]);
  const { showAlert, showConfirm, dialogElement } = useAppDialog({ confirm: locale === "zh" ? "确认" : "Confirm", cancel: locale === "zh" ? "取消" : "Cancel" });
  const [tab, setTab] = useState<"import" | "library" | "test">("import");
  const [files, setFiles] = useState<SelectedSubtitle[]>([]);
  const [rootId, setRootId] = useState(initialIndexNodeId ?? indexes[0]?.id ?? "");
  const [manualReview, setManualReview] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [maintenanceJob, setMaintenanceJob] = useState<MaintenanceJob | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const reviewStats = useMemo(() => {
    if (!review) return null;
    const original = review.chunks.reduce((sum, chunk) => sum + chunk.originalText.length, 0);
    const cleaned = review.chunks.reduce((sum, chunk) => sum + chunk.cleanedText.length, 0);
    return { original, cleaned, ratio: original ? Math.round(cleaned / original * 100) : 0 };
  }, [review]);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/knowledge/documents", { cache: "no-store" });
    const result = await response.json() as { documents?: DocumentRow[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? t.operationFailed);
    setDocuments(result.documents ?? []);
  }, [t.operationFailed]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setManualReview(false);
      setRootId(initialIndexNodeId ?? indexes[0]?.id ?? "");
      void loadDocuments().catch((error) => showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.operationFailed, tone: "danger" }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [indexes, initialIndexNodeId, loadDocuments, open, showAlert, t.operationFailed]);

  useEffect(() => {
    if (!job || !["RUNNING", "QUEUED"].includes(job.status)) return;
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/knowledge/import-jobs/${job.id}`, { cache: "no-store" });
      const result = await response.json() as { job?: Job };
      if (result.job) setJob(result.job);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [job]);

  useEffect(() => {
    if (!maintenanceJob || maintenanceJob.status !== "RUNNING") return;
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/knowledge/maintenance/${maintenanceJob.id}`, { cache: "no-store" });
      const result = await response.json() as { job?: MaintenanceJob };
      if (result.job) setMaintenanceJob(result.job);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [maintenanceJob]);

  useEffect(() => {
    if (!job || ["RUNNING", "QUEUED"].includes(job.status)) return;
    const timer = window.setTimeout(() => void loadDocuments(), 0);
    return () => window.clearTimeout(timer);
  }, [job, loadDocuments]);

  const allMapped = files.length > 0 && files.every((file) => file.indexNodeId);
  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted = [...list].filter((file) => /\.(srt|vtt|ass|txt)$/i.test(file.name));
    setFiles(accepted.map((file) => ({ id: id(), file, indexNodeId: initialIndexNodeId ?? "" })));
  }

  async function autoMap() {
    if (!rootId || !files.length) return;
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge/import-mappings/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootIndexNodeId: rootId, fileNames: files.map((entry) => entry.file.name) }),
      });
      const result = await response.json() as { mappings?: Array<{ fileName: string; selectedIndexNodeId: string | null }>; error?: string };
      if (!response.ok) throw new Error(result.error ?? t.operationFailed);
      setFiles((current) => current.map((entry, index) => ({ ...entry, indexNodeId: result.mappings?.[index]?.selectedIndexNodeId ?? "" })));
    } catch (error) {
      await showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.operationFailed, tone: "danger" });
    } finally { setBusy(false); }
  }

  async function startImport() {
    if (!allMapped) return;
    setBusy(true);
    try {
      const form = new FormData();
      files.forEach((entry) => form.append("files", entry.file));
      form.set("mappings", JSON.stringify(files.map((entry, fileIndex) => ({ fileIndex, indexNodeId: entry.indexNodeId }))));
      form.set("manualReview", String(manualReview));
      const response = await fetch("/api/knowledge/import-jobs", { method: "POST", body: form });
      const result = await response.json() as { job?: Job; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error ?? t.operationFailed);
      setJob(result.job); setFiles([]);
    } catch (error) {
      await showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.operationFailed, tone: "danger" });
    } finally { setBusy(false); }
  }

  async function decide(item: JobItem, action: "approve" | "reject" | "retry") {
    const response = await fetch(`/api/knowledge/import-jobs/${job?.id}/items/${item.id}/${action}`, { method: "POST" });
    const result = await response.json() as { job?: Job; error?: string };
    if (!response.ok || !result.job) throw new Error(result.error ?? t.operationFailed);
    setJob(result.job); setReview(null);
  }

  async function openReview(item: JobItem) {
    if (!item.versionId) return;
    const response = await fetch(`/api/knowledge/documents?reviewVersionId=${encodeURIComponent(item.versionId)}`, { cache: "no-store" });
    const result = await response.json() as { review?: Review; error?: string };
    if (!response.ok || !result.review) throw new Error(result.error ?? t.operationFailed);
    setReview(result.review);
  }

  async function patchDocument(document: DocumentRow, body: object) {
    const response = await fetch(`/api/knowledge/documents/${document.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? t.operationFailed);
    await loadDocuments();
  }

  async function deleteDocument(document: DocumentRow) {
    if (!await showConfirm({ title: t.confirmDelete, message: t.confirmDeleteMessage, tone: "danger", confirmLabel: t.delete })) return;
    const response = await fetch(`/api/knowledge/documents/${document.id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? t.operationFailed);
    await loadDocuments();
  }

  async function activate(document: DocumentRow, version: Version) {
    const response = await fetch(`/api/knowledge/documents/${document.id}/versions/${version.id}/activate`, { method: "POST" });
    if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? t.operationFailed);
    await loadDocuments();
  }

  async function testSearch() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, indexNodeId: initialIndexNodeId }) });
      const result = await response.json() as { result?: { sources: Array<Record<string, unknown>> }; error?: string };
      if (!response.ok) throw new Error(result.error ?? t.operationFailed);
      setResults(result.result?.sources ?? []);
    } catch (error) { await showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.operationFailed, tone: "danger" }); }
    finally { setBusy(false); }
  }

  async function runMaintenance(kind: "fts" | "embeddings") {
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      const result = await response.json() as { error?: string; job?: MaintenanceJob };
      if (!response.ok) throw new Error(result.error ?? t.operationFailed);
      if (result.job) setMaintenanceJob(result.job);
      await showAlert({ title: t.title, message: kind === "fts" ? t.rebuildFts : t.maintenanceStarted, tone: "success" });
    } catch (error) { await showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.operationFailed, tone: "danger" }); }
    finally { setBusy(false); }
  }

  if (!open) return dialogElement;
  return <>
    <div className="fixed inset-0 z-[80] grid place-items-center bg-zinc-950/50 p-4 sm:p-6" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex max-h-[min(52rem,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold"><BookOpen className="h-5 w-5 text-cyan-700" />{t.title}</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"><X className="h-4 w-4" /></button>
        </header>
        <nav className="flex gap-1 border-b border-zinc-200 px-5 pt-3">
          {(["import", "library", "test"] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === item ? "border-cyan-700 text-cyan-800" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"}`}>{item === "import" ? t.importTab : item === "library" ? t.libraryTab : t.testTab}</button>)}
        </nav>
        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "import" ? <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"><UploadCloud className="h-4 w-4" />{t.choose}<input type="file" multiple accept=".srt,.vtt,.ass,.txt" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></label>
              <button type="button" onClick={() => folderRef.current?.click()} className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50">{t.chooseFolder}</button>
              <input ref={folderRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)} />
              <IndexTreeSelector
                className="min-w-72 flex-1"
                invalid={!rootId}
                value={rootId}
                onChange={setRootId}
                nodes={indexTree}
                labels={{
                  choose: t.root,
                  collapse: t.collapseIndex,
                  expand: t.expandIndex,
                  noResults: t.noMatchingIndex,
                  searchPlaceholder: t.searchIndex,
                  unclassified: t.root,
                }}
              />
              <button type="button" disabled={!rootId || !files.length || busy} onClick={() => void autoMap()} className="h-10 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-sm font-medium text-cyan-800 transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">{t.autoMap}</button>
            </div>
            {files.length ? <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white"><table className="w-full table-fixed text-left text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="w-1/3 p-3 font-medium">{t.choose}</th><th className="p-3 font-medium">{t.mapping}</th><th className="w-10" /></tr></thead><tbody>{files.map((entry) => <tr key={entry.id} className="border-t border-zinc-100"><td className="truncate p-3" title={entry.file.name}>{entry.file.name}</td><td className="p-3"><IndexTreeSelector value={entry.indexNodeId} onChange={(indexNodeId) => setFiles((items) => items.map((item) => item.id === entry.id ? { ...item, indexNodeId } : item))} nodes={indexTree} invalid={!entry.indexNodeId} labels={{ choose: t.mapping, collapse: t.collapseIndex, expand: t.expandIndex, noResults: t.noMatchingIndex, searchPlaceholder: t.searchIndex, unclassified: t.unmatched }} /></td><td className="p-3"><button type="button" onClick={() => setFiles((items) => items.filter((item) => item.id !== entry.id))} className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-rose-600"><X className="h-4 w-4" /></button></td></tr>)}</tbody></table></div> : <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-8 text-center text-sm text-zinc-500">{t.noFiles}</p>}
            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={manualReview} onChange={(e) => setManualReview(e.target.checked)} className="mt-0.5 h-4 w-4" /><span><strong>{t.manual}</strong><span className="mt-0.5 block text-xs text-amber-800">{t.manualHint}</span></span></label>
            <button disabled={!allMapped || busy} onClick={() => void startImport()} className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-800 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t.start}</button>
            {job ? <KnowledgeImportProgress
              job={job}
              locale={locale}
              copy={{ approve: t.approve, approveAll: t.approveAll, reject: t.reject, retry: t.retry, review: t.review }}
              onReview={(item) => void openReview(item)}
              onApprove={(item) => void decide(item, "approve")}
              onReject={(item) => void decide(item, "reject")}
              onRetry={(item) => void decide(item, "retry")}
              onApproveAll={(items) => void (async () => { for (const item of items) await decide(item, "approve"); })()}
            /> : null}
          </div> : null}
          {tab === "library" ? <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy} onClick={() => void runMaintenance("fts")} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">{t.rebuildFts}</button><button type="button" disabled={busy || maintenanceJob?.status === "RUNNING"} onClick={() => void runMaintenance("embeddings")} className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50">{t.rebuildVectors}</button>{maintenanceJob ? <span className={`text-xs ${maintenanceJob.status === "FAILED" ? "text-rose-700" : "text-zinc-500"}`}>{maintenanceJob.processedItems}/{maintenanceJob.totalItems} · {maintenanceJob.status}{maintenanceJob.error ? ` · ${maintenanceJob.error}` : ""}</span> : null}</div>{documents.length ? documents.map((document) => <section key={document.id} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h3 className="font-semibold text-zinc-900">{document.lessonCode ? `${document.lessonCode} · ` : ""}{document.title}</h3><p className="mt-1 text-xs text-zinc-500">{document.indexPathSnapshot} · {document.bindingStatus} · {document.chunkCount} chunks</p><IndexTreeSelector className="mt-3 max-w-xl" value={document.indexNodeId ?? ""} onChange={(indexNodeId) => indexNodeId && void patchDocument(document, { indexNodeId })} nodes={indexTree} invalid={!document.indexNodeId} labels={{ choose: t.mapping, collapse: t.collapseIndex, expand: t.expandIndex, noResults: t.noMatchingIndex, searchPlaceholder: t.searchIndex, unclassified: t.unmatched }} /></div><button type="button" onClick={() => void patchDocument(document, { enabled: document.bindingStatus === "DISABLED" })} className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50">{document.bindingStatus === "DISABLED" ? t.enable : t.disable}</button><button type="button" onClick={() => void deleteDocument(document)} className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-100"><Trash2 className="mr-1 inline h-3 w-3" />{t.delete}</button></div><div className="mt-3 space-y-2">{document.versions.map((version) => <div key={version.id} className="flex items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"><span>v{version.versionNumber} · {version.sourceFileName} · {version.status} · {version.chunkCount}</span>{document.activeVersionId === version.id ? <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">{t.active}</span> : version.chunkCount ? <button type="button" className="ml-auto font-medium text-cyan-700 hover:text-cyan-900" onClick={() => void activate(document, version)}>{t.activate}</button> : null}</div>)}</div></section>) : <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 py-16 text-center text-sm text-zinc-500">{t.empty}</p>}</div> : null}
          {tab === "test" ? <div className="space-y-4"><div className="flex gap-2"><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t.testQuestion} className="h-10 min-w-0 flex-1 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /><button type="button" onClick={() => void testSearch()} disabled={busy || !question.trim()} className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-800 px-4 text-sm font-medium text-white transition-colors hover:bg-cyan-900 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{t.search}</button></div><p className="text-xs text-zinc-500">{t.currentNode}: {indexes.find((node) => node.id === initialIndexNodeId)?.path ?? "—"}</p><div className="space-y-2">{results.length ? results.map((result) => <article key={String(result.id)} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-cyan-800">[{String(result.citation)}] {String(result.lessonCode ?? "")} · {String(result.title)} · {timestamp(result.startMs as number | null)}–{timestamp(result.endMs as number | null)}</p><p className="mt-1 text-[11px] text-zinc-500">{t.scope}: {String(result.scope)} · {t.ranking}: {Number(result.score).toFixed(5)}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">{String(result.text)}</p></article>) : <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-8 text-center text-sm text-zinc-500">{t.resultEmpty}</p>}</div></div> : null}
        </main>
      </div>
    </div>
    {review ? <div className="fixed inset-0 z-[90] grid place-items-center bg-zinc-950/50 p-4 sm:p-6"><div className="flex max-h-[min(52rem,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4"><div><h3 className="font-semibold"><FileSearch className="mr-2 inline h-4 w-4 text-cyan-700" />{review.title}</h3>{reviewStats ? <p className="mt-1 text-xs text-zinc-500">{t.reviewStats}: {t.original} {reviewStats.original} {t.characters} · {t.cleaned} {reviewStats.cleaned} {t.characters} · {t.retained} {reviewStats.ratio}%</p> : null}</div><button type="button" onClick={() => setReview(null)} className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"><X className="h-4 w-4" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="space-y-3">{review.chunks.map((chunk) => <section key={chunk.ordinal} className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-2"><div><p className="mb-1 text-xs font-semibold text-zinc-500">{t.original} · {timestamp(chunk.startMs)}–{timestamp(chunk.endMs)}</p><p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{chunk.originalText}</p></div><div className="border-t border-zinc-100 pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0"><p className="mb-1 text-xs font-semibold text-cyan-700">{t.cleaned} · {chunk.topic}</p><p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{chunk.cleanedText}</p></div></section>)}</div></div></div></div> : null}
    {dialogElement}
  </>;
}
