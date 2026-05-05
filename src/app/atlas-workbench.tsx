"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FolderPlus,
  ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Undo2,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type IndexTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: string;
  imageCount: number;
  children: IndexTreeNode[];
};

type ChartImage = {
  id: string;
  originalName: string;
  title: string | null;
  notes: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  hash: string;
  ocrStatus: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  ocrText: string | null;
  ocrError: string | null;
  createdAt: string;
  indexNode: { id: string; name: string; path: string } | null;
};

type ImportBatch = {
  id: string;
  status: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  duplicateCount: number;
  ocrPendingCount: number;
  ocrCompletedCount: number;
  ocrFailedCount: number;
  createdAt: string;
};

type AtlasData = {
  tree: IndexTreeNode[];
  images: ChartImage[];
  batches: ImportBatch[];
  stats: {
    imageCount: number;
    unclassifiedCount: number;
    ocr: Record<string, number>;
  };
};

type SelectedFile = {
  file: File;
  relativePath: string;
  groupKey: string;
};

type Locale = "zh" | "en";

const chunkSize = 80;

const copy = {
  zh: {
    imageUnit: "张图片",
    refresh: "刷新",
    newIndex: "新建索引",
    addIndex: "添加索引",
    allImages: "全部图片",
    searchPlaceholder: "搜索标题、OCR、备注、索引",
    chooseImages: "选择图片",
    chooseFolder: "选择文件夹",
    clearSelection: "取消选择",
    selected: "已选择",
    groups: "个分组",
    startImport: "开始导入",
    undoBatch: "撤销本批次",
    overview: "概览",
    hideOverview: "收起概览",
    showOverview: "展开概览",
    collapseSidebar: "收起侧栏",
    expandSidebar: "展开侧栏",
    unclassified: "未分类",
    ocrPending: "OCR 待处理",
    ocrDone: "OCR 已完成",
    ocrFailed: "OCR 失败",
    noImages: "暂无图片",
    imageDetail: "图片详情",
    noSelection: "未选择图片",
    title: "标题",
    index: "索引",
    notes: "备注",
    save: "保存",
    retryOcr: "重试 OCR",
    noOcrText: "暂无 OCR 文本",
    size: "大小",
    pixels: "像素",
    unknown: "未知",
    hash: "Hash",
    noImageSelected: "请选择一张图片",
    duplicates: "重复",
    ocrFailedShort: "OCR 失败",
    language: "EN",
  },
  en: {
    imageUnit: "images",
    refresh: "Refresh",
    newIndex: "New index",
    addIndex: "Add index",
    allImages: "All images",
    searchPlaceholder: "Search title, OCR, notes, index",
    chooseImages: "Choose images",
    chooseFolder: "Choose folder",
    clearSelection: "Clear",
    selected: "selected",
    groups: "groups",
    startImport: "Start import",
    undoBatch: "Undo batch",
    overview: "Overview",
    hideOverview: "Hide overview",
    showOverview: "Show overview",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    unclassified: "Unclassified",
    ocrPending: "OCR pending",
    ocrDone: "OCR done",
    ocrFailed: "OCR failed",
    noImages: "No images",
    imageDetail: "Image detail",
    noSelection: "No selection",
    title: "Title",
    index: "Index",
    notes: "Notes",
    save: "Save",
    retryOcr: "Retry OCR",
    noOcrText: "No OCR text",
    size: "Size",
    pixels: "Pixels",
    unknown: "Unknown",
    hash: "Hash",
    noImageSelected: "No image selected",
    duplicates: "duplicates",
    ocrFailedShort: "OCR failed",
    language: "中",
  },
} as const;

const ocrStatusLabels: Record<Locale, Record<ChartImage["ocrStatus"], string>> = {
  zh: {
    PENDING: "待处理",
    RUNNING: "识别中",
    COMPLETED: "已完成",
    FAILED: "失败",
    SKIPPED: "已跳过",
  },
  en: {
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    SKIPPED: "SKIPPED",
  },
};

const batchStatusLabels: Record<Locale, Record<string, string>> = {
  zh: {
    DRAFT: "草稿",
    IMPORTING: "导入中",
    PROCESSING_OCR: "OCR 处理中",
    COMPLETED: "已完成",
    COMPLETED_WITH_ERRORS: "完成但有错误",
    FAILED: "失败",
  },
  en: {
    DRAFT: "DRAFT",
    IMPORTING: "IMPORTING",
    PROCESSING_OCR: "PROCESSING_OCR",
    COMPLETED: "COMPLETED",
    COMPLETED_WITH_ERRORS: "COMPLETED_WITH_ERRORS",
    FAILED: "FAILED",
  },
};

function fileRelativePath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function defaultGroupFor(relativePath: string) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (parts.length > 1) {
    return parts[0];
  }

  const stem = parts[0]?.replace(/\.[^.]+$/, "") ?? "未分组";
  const prefix = stem.match(/^[A-Za-z]+|\d+/)?.[0];
  return prefix || "未分组";
}

function flattenTree(nodes: IndexTreeNode[]) {
  const result: IndexTreeNode[] = [];
  const visit = (node: IndexTreeNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function ocrTone(status: ChartImage["ocrStatus"]) {
  switch (status) {
    case "COMPLETED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "FAILED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "RUNNING":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function IndexBranch({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: IndexTreeNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <div key={node.id}>
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className={`grid h-9 w-full grid-cols-[16px_1fr_auto] items-center gap-2 rounded-md px-2 text-left text-sm transition ${
              selectedId === node.id
                ? "bg-zinc-950 text-white"
                : "text-zinc-700 hover:bg-zinc-100"
            }`}
            style={{ paddingLeft: 8 + node.depth * 12 }}
            title={node.path}
          >
            <ChevronRight className="h-3.5 w-3.5 text-current opacity-60" />
            <span className="truncate">{node.name}</span>
            <span className="rounded border border-current/15 px-1.5 py-0.5 text-[11px] opacity-75">
              {node.imageCount}
            </span>
          </button>
          {node.children.length > 0 ? (
            <IndexBranch nodes={node.children} selectedId={selectedId} onSelect={onSelect} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function AtlasWorkbench() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") {
      return "zh";
    }

    return window.localStorage.getItem("brooks-pa-atlas.locale") === "en" ? "en" : "zh";
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem("brooks-pa-atlas.sidebar") === "collapsed";
  });
  const [isOverviewCollapsed, setIsOverviewCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem("brooks-pa-atlas.overview") === "collapsed";
  });
  const [data, setData] = useState<AtlasData | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [newIndexName, setNewIndexName] = useState("");
  const [detailDraft, setDetailDraft] = useState({ title: "", notes: "", indexNodeId: "" });
  const t = copy[locale];

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (selectedIndexId) {
      params.set("indexId", selectedIndexId);
    }

    const response = await fetch(`/api/atlas?${params.toString()}`, { cache: "no-store" });
    setData(await response.json());
  }, [query, selectedIndexId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const hasActiveBatch = data?.batches.some((batch) =>
      ["IMPORTING", "PROCESSING_OCR"].includes(batch.status),
    );
    if (!hasActiveBatch) {
      return;
    }

    const interval = window.setInterval(() => {
      void refresh();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [data?.batches, refresh]);

  const flatIndexes = useMemo(() => flattenTree(data?.tree ?? []), [data?.tree]);
  const selectedImage = data?.images.find((image) => image.id === selectedImageId) ?? null;
  const layoutClass = isSidebarCollapsed
    ? "grid min-h-screen grid-cols-1 xl:grid-cols-[64px_minmax(520px,1fr)_360px]"
    : "grid min-h-screen grid-cols-1 xl:grid-cols-[300px_minmax(520px,1fr)_360px]";
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    files.forEach((item) => counts.set(item.groupKey, (counts.get(item.groupKey) ?? 0) + 1));
    return Array.from(counts.entries()).map(([groupKey, count]) => ({ groupKey, count }));
  }, [files]);

  function handleFiles(fileList: FileList | null) {
    const nextFiles = Array.from(fileList ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => {
        const relativePath = fileRelativePath(file);
        return {
          file,
          relativePath,
          groupKey: defaultGroupFor(relativePath),
        };
      });

    setFiles(nextFiles);
    setAssignments(
      Object.fromEntries(
        Array.from(new Set(nextFiles.map((item) => item.groupKey))).map((groupKey) => [
          groupKey,
          groupKey,
        ]),
      ),
    );
    setUploadProgress({ done: 0, total: nextFiles.length });
  }

  async function uploadFiles() {
    if (!files.length) {
      return;
    }

    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });
    let batchId = "";

    try {
      for (let index = 0; index < files.length; index += chunkSize) {
        const chunk = files.slice(index, index + chunkSize);
        const formData = new FormData();
        const groupAssignments = Object.fromEntries(
          Object.entries(assignments).map(([groupKey, path]) => [
            groupKey,
            path
              .split("/")
              .map((part) => part.trim())
              .filter(Boolean),
          ]),
        );

        formData.set("totalCount", String(files.length));
        formData.set("assignments", JSON.stringify(groupAssignments));
        if (batchId) {
          formData.set("batchId", batchId);
        }

        chunk.forEach((item) => {
          formData.append("files", item.file);
          formData.append("relativePaths", item.relativePath);
          formData.append("groupKeys", item.groupKey);
        });

        const response = await fetch("/api/import", {
          method: "POST",
          body: formData,
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error ?? "Import failed.");
        }

        batchId = result.batchId;
        setUploadProgress({ done: Math.min(index + chunk.length, files.length), total: files.length });
        await refresh();
      }

      setFiles([]);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  async function createNode() {
    if (!newIndexName.trim()) {
      return;
    }

    await fetch("/api/index-nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newIndexName, parentId: selectedIndexId }),
    });
    setNewIndexName("");
    await refresh();
  }

  async function saveDetails() {
    if (!selectedImage) {
      return;
    }

    await fetch(`/api/images/${selectedImage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(detailDraft),
    });
    await refresh();
  }

  async function retryOcr() {
    await fetch("/api/ocr/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageIds: selectedImage ? [selectedImage.id] : undefined }),
    });
    await refresh();
  }

  async function undoBatch(batchId: string) {
    await fetch(`/api/import/${batchId}/undo`, {
      method: "POST",
    });
    setSelectedImageId(null);
    await refresh();
  }

  function selectImage(image: ChartImage) {
    setSelectedImageId(image.id);
    setDetailDraft({
      title: image.title ?? "",
      notes: image.notes ?? "",
      indexNodeId: image.indexNode?.id ?? "",
    });
  }

  function toggleLocale() {
    const nextLocale = locale === "zh" ? "en" : "zh";
    setLocale(nextLocale);
    window.localStorage.setItem("brooks-pa-atlas.locale", nextLocale);
  }

  function toggleSidebar() {
    const nextValue = !isSidebarCollapsed;
    setIsSidebarCollapsed(nextValue);
    window.localStorage.setItem(
      "brooks-pa-atlas.sidebar",
      nextValue ? "collapsed" : "expanded",
    );
  }

  function toggleOverview() {
    const nextValue = !isOverviewCollapsed;
    setIsOverviewCollapsed(nextValue);
    window.localStorage.setItem(
      "brooks-pa-atlas.overview",
      nextValue ? "collapsed" : "expanded",
    );
  }

  function clearSelectedFiles() {
    setFiles([]);
    setAssignments({});
    setUploadProgress({ done: 0, total: 0 });
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-zinc-950">
      <div className={layoutClass}>
        <aside className="border-r border-zinc-200 bg-white">
          {isSidebarCollapsed ? (
            <div className="flex min-h-screen flex-col items-center gap-3 py-3">
              <button
                type="button"
                onClick={toggleSidebar}
                className="grid h-10 w-10 place-items-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                title={t.expandSidebar}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedIndexId(null)}
                className={`grid h-10 w-10 place-items-center rounded-md ${
                  selectedIndexId === null
                    ? "bg-zinc-950 text-white"
                    : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                }`}
                title={t.allImages}
              >
                <ImageIcon className="h-4 w-4" />
              </button>
              <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-500">
                {data?.stats.imageCount ?? 0}
              </span>
            </div>
          ) : (
            <>
              <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-4">
                <div>
                  <h1 className="text-lg font-semibold leading-tight">Brooks PA Atlas</h1>
                  <p className="text-xs text-zinc-500">
                    {data?.stats.imageCount ?? 0} {t.imageUnit}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleLocale}
                    className="h-9 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    title={locale === "zh" ? "Switch to English" : "切换到中文"}
                  >
                    {t.language}
                  </button>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="grid h-9 w-9 place-items-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                    title={t.refresh}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    className="grid h-9 w-9 place-items-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                    title={t.collapseSidebar}
                  >
                    <ChevronRight className="h-4 w-4 rotate-180" />
                  </button>
                </div>
              </div>

              <div className="border-b border-zinc-200 p-4">
                <div className="flex gap-2">
                  <input
                    value={newIndexName}
                    onChange={(event) => setNewIndexName(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500"
                    placeholder={t.newIndex}
                  />
                  <button
                    type="button"
                    onClick={() => void createNode()}
                    className="grid h-9 w-9 place-items-center rounded-md bg-zinc-950 text-white hover:bg-zinc-800"
                    title={t.addIndex}
                  >
                    <FolderPlus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <nav className="max-h-96 overflow-auto p-3 xl:h-[calc(100vh-129px)] xl:max-h-none">
                <button
                  type="button"
                  onClick={() => setSelectedIndexId(null)}
                  className={`mb-2 grid h-9 w-full grid-cols-[16px_1fr_auto] items-center gap-2 rounded-md px-2 text-left text-sm ${
                    selectedIndexId === null ? "bg-zinc-950 text-white" : "text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>{t.allImages}</span>
                  <span className="rounded border border-current/15 px-1.5 py-0.5 text-[11px] opacity-75">
                    {data?.stats.imageCount ?? 0}
                  </span>
                </button>
                <IndexBranch
                  nodes={data?.tree ?? []}
                  selectedId={selectedIndexId}
                  onSelect={setSelectedIndexId}
                />
              </nav>
            </>
          )}
        </aside>

        <section className="min-w-0">
          <div className="flex h-16 items-center gap-3 border-b border-zinc-200 bg-white px-5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-zinc-500"
                placeholder={t.searchPlaceholder}
              />
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white hover:bg-cyan-800">
              <ImageIcon className="h-4 w-4" />
              <span>{t.chooseImages}</span>
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
              />
            </label>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              <FolderPlus className="h-4 w-4" />
              <span>{t.chooseFolder}</span>
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              />
            </label>
          </div>

          {files.length > 0 ? (
            <div className="border-b border-zinc-200 bg-white px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {files.length} {t.selected}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {groups.length} {t.groups}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearSelectedFiles}
                    disabled={uploading}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    <X className="h-4 w-4" />
                    <span>{t.clearSelection}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void uploadFiles()}
                    disabled={uploading}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    <span>
                      {uploading ? `${uploadProgress.done}/${uploadProgress.total}` : t.startImport}
                    </span>
                  </button>
                </div>
              </div>
              <div className="grid max-h-40 grid-cols-1 gap-2 overflow-auto pr-1 lg:grid-cols-2">
                {groups.map((group) => (
                  <div key={group.groupKey} className="grid grid-cols-[1fr_2fr_54px] items-center gap-2 rounded-md border border-zinc-200 p-2">
                    <span className="truncate text-sm font-medium" title={group.groupKey}>
                      {group.groupKey}
                    </span>
                    <input
                      value={assignments[group.groupKey] ?? ""}
                      onChange={(event) =>
                        setAssignments((current) => ({
                          ...current,
                          [group.groupKey]: event.target.value,
                        }))
                      }
                      className="h-8 rounded-md border border-zinc-200 px-2 text-sm outline-none focus:border-zinc-500"
                    />
                    <span className="text-right text-xs text-zinc-500">{group.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="overflow-auto p-5 xl:h-[calc(100vh-65px)]">
            <div className="mb-4 rounded-md border border-zinc-200 bg-white">
              <div className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t.overview}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {t.unclassified} {data?.stats.unclassifiedCount ?? 0} / {t.ocrPending}{" "}
                    {data?.stats.ocr.PENDING ?? 0} / {t.ocrDone}{" "}
                    {data?.stats.ocr.COMPLETED ?? 0} / {t.ocrFailed}{" "}
                    {data?.stats.ocr.FAILED ?? 0}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleOverview}
                  className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 transition ${isOverviewCollapsed ? "rotate-90" : "-rotate-90"}`}
                  />
                  <span>{isOverviewCollapsed ? t.showOverview : t.hideOverview}</span>
                </button>
              </div>

              {!isOverviewCollapsed ? (
                <div className="border-t border-zinc-200 p-3">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className="rounded-md border border-zinc-200 bg-white p-3">
                      <p className="text-xs text-zinc-500">{t.unclassified}</p>
                      <p className="mt-1 text-xl font-semibold">{data?.stats.unclassifiedCount ?? 0}</p>
                    </div>
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-700">{t.ocrPending}</p>
                      <p className="mt-1 text-xl font-semibold">{data?.stats.ocr.PENDING ?? 0}</p>
                    </div>
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs text-emerald-700">{t.ocrDone}</p>
                      <p className="mt-1 text-xl font-semibold">{data?.stats.ocr.COMPLETED ?? 0}</p>
                    </div>
                    <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                      <p className="text-xs text-rose-700">{t.ocrFailed}</p>
                      <p className="mt-1 text-xl font-semibold">{data?.stats.ocr.FAILED ?? 0}</p>
                    </div>
                  </div>

                  {data?.batches.length ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {data.batches.slice(0, 2).map((batch) => (
                        <div key={batch.id} className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold">
                                {batchStatusLabels[locale][batch.status] ?? batch.status}
                              </p>
                              <p className="mt-1 text-zinc-500">
                                {batch.successCount}/{batch.totalCount} / {t.duplicates} {batch.duplicateCount}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void undoBatch(batch.id)}
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 font-medium text-rose-700 hover:bg-rose-100"
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              <span>{t.undoBatch}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
              {data?.images.map((image) => (
                <button
                  type="button"
                  key={image.id}
                  onClick={() => selectImage(image)}
                  className={`overflow-hidden rounded-md border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    selectedImage?.id === image.id ? "border-zinc-950" : "border-zinc-200"
                  }`}
                >
                  <div className="aspect-[4/3] bg-zinc-100">
                    <img
                      src={`/api/images/${image.id}/file`}
                      alt={image.title ?? image.originalName}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="space-y-2 p-3">
                    <div>
                      <p className="truncate text-sm font-semibold" title={image.title ?? image.originalName}>
                        {image.title ?? image.originalName}
                      </p>
                      <p className="truncate text-xs text-zinc-500" title={image.indexNode?.path ?? t.unclassified}>
                        {image.indexNode?.path ?? t.unclassified}
                      </p>
                    </div>
                    <span className={`inline-flex h-6 items-center rounded border px-2 text-xs ${ocrTone(image.ocrStatus)}`}>
                      {ocrStatusLabels[locale][image.ocrStatus]}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {data?.images.length === 0 ? (
              <div className="grid h-72 place-items-center rounded-md border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                {t.noImages}
              </div>
            ) : null}
          </div>
        </section>

        <aside className="border-l border-zinc-200 bg-white">
          <div className="h-16 border-b border-zinc-200 px-4 py-3">
            <p className="text-sm font-semibold">{t.imageDetail}</p>
            <p className="truncate text-xs text-zinc-500">{selectedImage?.originalName ?? t.noSelection}</p>
          </div>

          {selectedImage ? (
            <div className="overflow-auto p-4 xl:h-[calc(100vh-65px)]">
              <div className="mb-4 aspect-[4/3] overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                <img
                  src={`/api/images/${selectedImage.id}/file`}
                  alt={selectedImage.title ?? selectedImage.originalName}
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.title}</span>
                  <input
                    value={detailDraft.title}
                    onChange={(event) => setDetailDraft((draft) => ({ ...draft, title: event.target.value }))}
                    className="h-9 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.index}</span>
                  <select
                    value={detailDraft.indexNodeId}
                    onChange={(event) => setDetailDraft((draft) => ({ ...draft, indexNodeId: event.target.value }))}
                    className="h-9 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500"
                  >
                    <option value="">{t.unclassified}</option>
                    {flatIndexes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {"- ".repeat(node.depth)}
                        {node.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.notes}</span>
                  <textarea
                    value={detailDraft.notes}
                    onChange={(event) => setDetailDraft((draft) => ({ ...draft, notes: event.target.value }))}
                    className="min-h-24 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void saveDetails()}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{t.save}</span>
                </button>
              </div>

              <div className="mt-5 space-y-3 rounded-md border border-zinc-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex h-6 items-center rounded border px-2 text-xs ${ocrTone(selectedImage.ocrStatus)}`}>
                    {ocrStatusLabels[locale][selectedImage.ocrStatus]}
                  </span>
                  <button
                    type="button"
                    onClick={() => void retryOcr()}
                    className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                    title={t.retryOcr}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                {selectedImage.ocrError ? (
                  <p className="flex gap-2 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
                    <AlertTriangle className="h-4 w-4 flex-none" />
                    <span>{selectedImage.ocrError}</span>
                  </p>
                ) : null}
                <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-600">
                  {selectedImage.ocrText ?? t.noOcrText}
                </p>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="text-zinc-500">{t.size}</dt>
                  <dd className="mt-1 font-medium">{formatBytes(selectedImage.sizeBytes)}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="text-zinc-500">{t.pixels}</dt>
                  <dd className="mt-1 font-medium">
                    {selectedImage.width && selectedImage.height
                      ? `${selectedImage.width}x${selectedImage.height}`
                      : t.unknown}
                  </dd>
                </div>
                <div className="col-span-2 rounded-md bg-zinc-50 p-2">
                  <dt className="text-zinc-500">{t.hash}</dt>
                  <dd className="mt-1 truncate font-mono text-[11px]" title={selectedImage.hash}>
                    {selectedImage.hash}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 space-y-2">
                {data?.batches.map((batch) => (
                  <div key={batch.id} className="rounded-md border border-zinc-200 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {batchStatusLabels[locale][batch.status] ?? batch.status}
                      </span>
                      <span className="text-zinc-500">{batch.successCount}/{batch.totalCount}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full bg-cyan-700"
                        style={{
                          width: `${batch.totalCount ? (batch.successCount / batch.totalCount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-zinc-500">
                      {t.duplicates} {batch.duplicateCount} / {t.ocrFailedShort} {batch.ocrFailedCount}
                    </p>
                    <button
                      type="button"
                      onClick={() => void undoBatch(batch.id)}
                      className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-700 hover:bg-rose-100"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      <span>{t.undoBatch}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid h-40 place-items-center text-sm text-zinc-500 xl:h-[calc(100vh-65px)]">
              {t.noImageSelected}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
