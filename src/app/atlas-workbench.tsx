"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FolderPlus,
  ImageIcon,
  Loader2,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  id: string;
  file: File;
  relativePath: string;
  groupKey: string;
  previewUrl: string;
};

type RestoreStats = {
  indexesCreated: number;
  indexesUpdated: number;
  imagesCreated: number;
  imagesUpdated: number;
  filesRestored: number;
};

type Locale = "zh" | "en";
type ViewMode = "browse" | "manage";
type IndexContextMenu = { node: IndexTreeNode; x: number; y: number };
type IndexAction =
  | { mode: "rename"; node: IndexTreeNode }
  | { mode: "delete"; node: IndexTreeNode }
  | { mode: "clear"; node: IndexTreeNode };

const chunkSize = 80;
const destructiveConfirmPhrase = "确认删除";

const copy = {
  zh: {
    imageUnit: "张图片",
    refresh: "刷新",
    newIndex: "新建索引",
    addIndex: "添加索引",
    renameIndex: "重命名索引",
    deleteIndex: "删除索引",
    clearIndexImages: "清空索引图片",
    deleteIndexConfirmTitle: "删除索引？",
    deleteIndexConfirmMessage: "该索引及其空子索引会被删除。只有当前索引和子索引下没有图片时才能执行。",
    deleteIndexDisabled: "当前索引或子索引下仍有图片，不能删除。",
    clearIndexImagesTitle: "清空当前索引下面的所有图片？",
    clearIndexImagesMessage: "此操作会删除当前索引及其所有子索引下的图片文件和记录，无法撤销。",
    clearIndexImagesTyping: "请输入“确认删除”以继续。",
    clearIndexImagesDisabled: "当前索引和子索引下没有图片可清空。",
    indexActionFailed: "索引操作失败，请稍后重试。",
    allImages: "全部图片",
    searchPlaceholder: "搜索标题、OCR、备注、索引",
    chooseImages: "选择图片",
    chooseFolder: "选择文件夹",
    backupData: "备份",
    backingUp: "备份中",
    restoreData: "恢复",
    restoring: "恢复中",
    backupFailed: "备份失败，请稍后重试。",
    restoreFailed: "恢复失败，请确认 zip 文件有效后重试。",
    restoreConfirmMessage:
      "恢复会合并备份数据：相同图片会覆盖标题、备注、OCR 和索引归属，不会删除当前系统中备份外的数据。是否继续？",
    noSupportedImages: "未找到支持的图片文件。",
    clearSelection: "取消选择",
    selected: "已选择",
    groups: "个分组",
    selectedFiles: "待导入图片",
    thumbnail: "缩略图",
    displayName: "显示名称",
    assignedIndex: "所属索引",
    originalPath: "原始路径",
    previewImage: "预览图片",
    closePreview: "关闭预览",
    totalImages: "总数",
    imageGrid: "图片列表",
    page: "页",
    itemsPerPage: "每页",
    previousPage: "上一页",
    nextPage: "下一页",
    resizeImportTable: "拖动调整导入表格高度",
    startImport: "开始导入",
    undoBatch: "撤销本批次",
    undoConfirmTitle: "确认撤销本批次？",
    undoConfirmMessage: "此操作会删除本批次导入的图片和记录，且无法撤销。请确认是否继续。",
    cancel: "取消",
    confirm: "确认",
    confirmUndo: "确认撤销",
    deleting: "删除中",
    saving: "保存中",
    undoing: "撤销中",
    undoFailed: "撤销失败，请稍后重试。",
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
    dataLoadFailed: "数据加载失败",
    retryLoad: "重新加载",
    imageDetail: "图片详情",
    noSelection: "未选择图片",
    deleteImage: "删除图片",
    deleteImageConfirmTitle: "删除这张图片？",
    deleteImageConfirmMessage: "此操作会删除该图片文件和记录，且无法撤销。请确认是否继续。",
    deleteImageFailed: "删除图片失败，请稍后重试。",
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
    browse: "浏览",
    manage: "管理",
    browseMode: "浏览模式",
    manageMode: "管理模式",
    previousImage: "上一张图片",
    nextImage: "下一张图片",
    previousImageShortcut: "上一张图片（快捷键 ←）",
    nextImageShortcut: "下一张图片（快捷键 →）",
    zoomIn: "放大",
    zoomOut: "缩小",
    resetZoom: "重置缩放",
    hideThumbnails: "隐藏缩略图",
    showThumbnails: "显示缩略图",
    resizeViewer: "拖动调整查看区高度",
    language: "EN",
  },
  en: {
    imageUnit: "images",
    refresh: "Refresh",
    newIndex: "New index",
    addIndex: "Add index",
    renameIndex: "Rename index",
    deleteIndex: "Delete index",
    clearIndexImages: "Clear index images",
    deleteIndexConfirmTitle: "Delete index?",
    deleteIndexConfirmMessage:
      "This index and its empty child indexes will be deleted. It is only available when the index and child indexes contain no images.",
    deleteIndexDisabled: "This index or a child index still contains images.",
    clearIndexImagesTitle: "Clear all images under this index?",
    clearIndexImagesMessage:
      "This will delete image files and records in this index and all child indexes. This cannot be undone.",
    clearIndexImagesTyping: "Type “确认删除” to continue.",
    clearIndexImagesDisabled: "This index and its child indexes have no images to clear.",
    indexActionFailed: "Index action failed. Please try again.",
    allImages: "All images",
    searchPlaceholder: "Search title, OCR, notes, index",
    chooseImages: "Choose images",
    chooseFolder: "Choose folder",
    backupData: "Backup",
    backingUp: "Backing up",
    restoreData: "Restore",
    restoring: "Restoring",
    backupFailed: "Backup failed. Please try again.",
    restoreFailed: "Restore failed. Please confirm the zip file is valid and try again.",
    restoreConfirmMessage:
      "Restore will merge backup data: matching images overwrite title, notes, OCR, and index assignment, and data outside the backup will not be deleted. Continue?",
    noSupportedImages: "No supported image files found.",
    clearSelection: "Clear",
    selected: "selected",
    groups: "groups",
    selectedFiles: "Images to import",
    thumbnail: "Thumbnail",
    displayName: "Display name",
    assignedIndex: "Index",
    originalPath: "Original path",
    previewImage: "Preview image",
    closePreview: "Close preview",
    totalImages: "Total",
    imageGrid: "Images",
    page: "Page",
    itemsPerPage: "Per page",
    previousPage: "Previous page",
    nextPage: "Next page",
    resizeImportTable: "Drag to resize import table",
    startImport: "Start import",
    undoBatch: "Undo batch",
    undoConfirmTitle: "Undo this batch?",
    undoConfirmMessage:
      "This will delete images and records imported by this batch, and cannot be undone. Please confirm before continuing.",
    cancel: "Cancel",
    confirm: "Confirm",
    confirmUndo: "Undo batch",
    deleting: "Deleting",
    saving: "Saving",
    undoing: "Undoing",
    undoFailed: "Undo failed. Please try again.",
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
    dataLoadFailed: "Data load failed",
    retryLoad: "Retry",
    imageDetail: "Image detail",
    noSelection: "No selection",
    deleteImage: "Delete image",
    deleteImageConfirmTitle: "Delete this image?",
    deleteImageConfirmMessage:
      "This will delete the image file and record, and cannot be undone. Please confirm before continuing.",
    deleteImageFailed: "Image deletion failed. Please try again.",
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
    browse: "Browse",
    manage: "Manage",
    browseMode: "Browse mode",
    manageMode: "Manage mode",
    previousImage: "Previous image",
    nextImage: "Next image",
    previousImageShortcut: "Previous image (shortcut ←)",
    nextImageShortcut: "Next image (shortcut →)",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetZoom: "Reset zoom",
    hideThumbnails: "Hide thumbnails",
    showThumbnails: "Show thumbnails",
    resizeViewer: "Drag to resize viewer",
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

function indexPathParts(value: string) {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isSupportedImageFile(file: File) {
  if (file.type.startsWith("image/")) {
    return true;
  }

  return /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name);
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

function indexBranchImageCount(node: IndexTreeNode): number {
  return node.imageCount + node.children.reduce((total, child) => total + indexBranchImageCount(child), 0);
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function backupFileNameFromHeader(value: string | null) {
  const match = value?.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? `brooks-pa-atlas-backup-${new Date().toISOString().slice(0, 10)}.zip`;
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

function clampZoom(value: number) {
  return Math.min(220, Math.max(50, value));
}

function clampViewerHeight(value: number) {
  return Math.min(1200, Math.max(420, value));
}

function clampImportTableHeight(value: number) {
  return Math.min(760, Math.max(180, value));
}

function IndexBranch({
  nodes,
  selectedId,
  collapsedIds,
  onSelect,
  onToggleExpanded,
  onContextMenu,
}: {
  nodes: IndexTreeNode[];
  selectedId: string | null;
  collapsedIds: Set<string>;
  onSelect: (id: string | null) => void;
  onToggleExpanded: (id: string) => void;
  onContextMenu?: (node: IndexTreeNode, event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsedIds.has(node.id);

        return (
          <div key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              onContextMenu={(event) => onContextMenu?.(node, event)}
              className={`grid h-9 w-full grid-cols-[16px_1fr_auto] items-center gap-2 rounded-md px-2 text-left text-sm transition ${
                selectedId === node.id
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
              style={{ paddingLeft: 8 + node.depth * 12 }}
              title={node.path}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded transition ${
                  hasChildren ? "hover:bg-current/10" : "pointer-events-none opacity-0"
                }`}
                onClick={(event) => {
                  if (!hasChildren) {
                    return;
                  }

                  event.stopPropagation();
                  onToggleExpanded(node.id);
                }}
                title={hasChildren ? (isCollapsed ? "展开索引" : "收起索引") : undefined}
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 text-current opacity-60 transition ${
                    hasChildren && !isCollapsed ? "rotate-90" : ""
                  }`}
                />
              </span>
              <span className="truncate">{node.name}</span>
              <span className="rounded border border-current/15 px-1.5 py-0.5 text-[11px] opacity-75">
                {node.imageCount}
              </span>
            </button>
            {hasChildren && !isCollapsed ? (
              <IndexBranch
                nodes={node.children}
                selectedId={selectedId}
                collapsedIds={collapsedIds}
                onSelect={onSelect}
                onToggleExpanded={onToggleExpanded}
                onContextMenu={onContextMenu}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ModeSwitch({
  mode,
  labels,
  onChange,
}: {
  mode: ViewMode;
  labels: { browse: string; manage: string; browseMode: string; manageMode: string };
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="grid h-9 grid-cols-2 rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
      <button
        type="button"
        onClick={() => onChange("browse")}
        className={`inline-flex items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition ${
          mode === "browse" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-white"
        }`}
        title={labels.browseMode}
      >
        <Eye className="h-3.5 w-3.5" />
        <span>{labels.browse}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("manage")}
        className={`inline-flex items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition ${
          mode === "manage" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-white"
        }`}
        title={labels.manageMode}
      >
        <PencilLine className="h-3.5 w-3.5" />
        <span>{labels.manage}</span>
      </button>
    </div>
  );
}

export default function AtlasWorkbench() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isOverviewCollapsed, setIsOverviewCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("manage");
  const [data, setData] = useState<AtlasData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null);
  const [collapsedIndexIds, setCollapsedIndexIds] = useState<Set<string>>(() => new Set());
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [newIndexName, setNewIndexName] = useState("");
  const [detailDraft, setDetailDraft] = useState({ title: "", notes: "", indexNodeId: "" });
  const [importPage, setImportPage] = useState(1);
  const [importPageSize, setImportPageSize] = useState(10);
  const [imageGridPage, setImageGridPage] = useState(1);
  const [imageGridPageSize, setImageGridPageSize] = useState(50);
  const [importTableHeight, setImportTableHeight] = useState(280);
  const [isResizingImportTable, setIsResizingImportTable] = useState(false);
  const [imageZoom, setImageZoom] = useState(100);
  const [importPreviewFile, setImportPreviewFile] = useState<SelectedFile | null>(null);
  const [pendingUndoBatchId, setPendingUndoBatchId] = useState<string | null>(null);
  const [undoingBatchId, setUndoingBatchId] = useState<string | null>(null);
  const [pendingDeleteImage, setPendingDeleteImage] = useState<ChartImage | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [indexContextMenu, setIndexContextMenu] = useState<IndexContextMenu | null>(null);
  const [indexAction, setIndexAction] = useState<IndexAction | null>(null);
  const [indexActionBusy, setIndexActionBusy] = useState(false);
  const [renameIndexName, setRenameIndexName] = useState("");
  const [clearIndexConfirmText, setClearIndexConfirmText] = useState("");
  const [imageViewerHeight, setImageViewerHeight] = useState(720);
  const [isResizingViewer, setIsResizingViewer] = useState(false);
  const [showBrowseThumbnails, setShowBrowseThumbnails] = useState(true);
  const importTableResizeStartRef = useRef({ height: importTableHeight, y: 0 });
  const importTableHeightRef = useRef(importTableHeight);
  const viewerResizeStartRef = useRef({ height: imageViewerHeight, y: 0 });
  const viewerHeightRef = useRef(imageViewerHeight);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const t = copy[locale];
  const isBrowseMode = viewMode === "browse";

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (selectedIndexId) {
      params.set("indexId", selectedIndexId);
    }

    try {
      const response = await fetch(`/api/atlas?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`GET /api/atlas ${response.status}`);
      }

      setData(await response.json());
      setDataError(null);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    }
  }, [query, selectedIndexId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setLocale(window.localStorage.getItem("brooks-pa-atlas.locale") === "en" ? "en" : "zh");
        setIsSidebarCollapsed(window.localStorage.getItem("brooks-pa-atlas.sidebar") === "collapsed");
        setIsOverviewCollapsed(window.localStorage.getItem("brooks-pa-atlas.overview") === "collapsed");
        setViewMode(window.localStorage.getItem("brooks-pa-atlas.viewMode") === "browse" ? "browse" : "manage");
        setShowBrowseThumbnails(window.localStorage.getItem("brooks-pa-atlas.browseThumbnails") !== "hidden");

        const savedGridPageSize = Number(window.localStorage.getItem("brooks-pa-atlas.imageGridPageSize"));
        setImageGridPageSize([25, 50, 100, 200].includes(savedGridPageSize) ? savedGridPageSize : 50);

        const savedImportTableHeight = Number(window.localStorage.getItem("brooks-pa-atlas.importTableHeight"));
        setImportTableHeight(
          Number.isFinite(savedImportTableHeight) && savedImportTableHeight > 0
            ? clampImportTableHeight(savedImportTableHeight)
            : 280,
        );

        const savedViewerHeight = Number(window.localStorage.getItem("brooks-pa-atlas.viewerHeight"));
        setImageViewerHeight(
          Number.isFinite(savedViewerHeight) && savedViewerHeight > 0 ? clampViewerHeight(savedViewerHeight) : 720,
        );
      } catch {
        // localStorage can be unavailable in restricted browser contexts.
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

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

  useEffect(() => {
    if (!isResizingViewer) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const nextHeight = clampViewerHeight(
        viewerResizeStartRef.current.height + event.clientY - viewerResizeStartRef.current.y,
      );
      viewerHeightRef.current = nextHeight;
      setImageViewerHeight(nextHeight);
    }

    function handlePointerUp() {
      setIsResizingViewer(false);
      window.localStorage.setItem(
        "brooks-pa-atlas.viewerHeight",
        String(viewerHeightRef.current),
      );
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingViewer]);

  useEffect(() => {
    if (!isResizingImportTable) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const nextHeight = clampImportTableHeight(
        importTableResizeStartRef.current.height + event.clientY - importTableResizeStartRef.current.y,
      );
      importTableHeightRef.current = nextHeight;
      setImportTableHeight(nextHeight);
    }

    function handlePointerUp() {
      setIsResizingImportTable(false);
      window.localStorage.setItem(
        "brooks-pa-atlas.importTableHeight",
        String(importTableHeightRef.current),
      );
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingImportTable]);

  useEffect(() => {
    if (!indexContextMenu) {
      return;
    }

    function closeMenu() {
      setIndexContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [indexContextMenu]);

  const flatIndexes = useMemo(() => flattenTree(data?.tree ?? []), [data?.tree]);
  const selectedIndexPath =
    flatIndexes.find((node) => node.id === selectedIndexId)?.path ?? "";
  const selectedImage = data?.images.find((image) => image.id === selectedImageId) ?? null;
  const selectedImageIndex =
    data?.images.findIndex((image) => image.id === selectedImageId) ?? -1;
  const pendingUndoBatch = data?.batches.find((batch) => batch.id === pendingUndoBatchId) ?? null;
  const indexContextImageCount = indexContextMenu
    ? indexBranchImageCount(indexContextMenu.node)
    : 0;
  const indexActionImageCount = indexAction ? indexBranchImageCount(indexAction.node) : 0;
  const canNavigateSelectedImage = (data?.images.length ?? 0) > 1;
  const shouldShowImageGrid = !isBrowseMode || showBrowseThumbnails || !selectedImage;
  const selectedImageTip = selectedImage
    ? [
        `${t.title}: ${selectedImage.title ?? selectedImage.originalName}`,
        `${t.index}: ${selectedImage.indexNode?.path ?? t.unclassified}`,
        `OCR: ${ocrStatusLabels[locale][selectedImage.ocrStatus]}`,
        `${t.size}: ${formatBytes(selectedImage.sizeBytes)}`,
        `${t.pixels}: ${
          selectedImage.width && selectedImage.height
            ? `${selectedImage.width}x${selectedImage.height}`
            : t.unknown
        }`,
        `${t.hash}: ${selectedImage.hash}`,
        selectedImage.notes ? `${t.notes}: ${selectedImage.notes}` : null,
        selectedImage.ocrError ? `${t.ocrFailedShort}: ${selectedImage.ocrError}` : null,
        selectedImage.ocrText ? `OCR: ${selectedImage.ocrText}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const layoutClass = isBrowseMode
    ? isSidebarCollapsed
      ? "grid min-h-screen grid-cols-1 xl:grid-cols-[64px_minmax(0,1fr)]"
      : "grid min-h-screen grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)]"
    : isSidebarCollapsed
      ? "grid min-h-screen grid-cols-1 xl:grid-cols-[64px_minmax(520px,1fr)_360px]"
      : "grid min-h-screen grid-cols-1 xl:grid-cols-[300px_minmax(520px,1fr)_360px]";
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    files.forEach((item) => counts.set(item.groupKey, (counts.get(item.groupKey) ?? 0) + 1));
    return Array.from(counts.entries()).map(([groupKey, count]) => ({ groupKey, count }));
  }, [files]);
  const importTotalPages = Math.max(1, Math.ceil(files.length / importPageSize));
  const importCurrentPage = Math.min(importPage, importTotalPages);
  const importStartIndex = (importCurrentPage - 1) * importPageSize;
  const importPageFiles = files.slice(importStartIndex, importStartIndex + importPageSize);
  const importEndIndex = importStartIndex + importPageFiles.length;
  const imageGridTotal = data?.images.length ?? 0;
  const imageGridTotalPages = Math.max(1, Math.ceil(imageGridTotal / imageGridPageSize));
  const imageGridCurrentPage = Math.min(imageGridPage, imageGridTotalPages);
  const imageGridStartIndex = (imageGridCurrentPage - 1) * imageGridPageSize;
  const imageGridPageImages = (data?.images ?? []).slice(
    imageGridStartIndex,
    imageGridStartIndex + imageGridPageSize,
  );
  const imageGridEndIndex = imageGridStartIndex + imageGridPageImages.length;

  useEffect(() => {
    const images = data?.images ?? [];
    if (!isBrowseMode || images.length < 2) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const target = event.target;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (isEditing || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const currentIndex = selectedImageIndex >= 0 ? selectedImageIndex : 0;
      const nextImage = images[(currentIndex + direction + images.length) % images.length];
      setSelectedImageId(nextImage.id);
      setImageZoom(100);
      setDetailDraft({
        title: nextImage.title ?? "",
        notes: nextImage.notes ?? "",
        indexNodeId: nextImage.indexNode?.id ?? "",
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data?.images, isBrowseMode, selectedImageIndex]);

  function handleFiles(fileList: FileList | null) {
    files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setImportPreviewFile(null);
    const nextFiles = Array.from(fileList ?? [])
      .filter(isSupportedImageFile)
      .map((file, index) => {
        const relativePath = fileRelativePath(file);
        const groupKey = defaultGroupFor(relativePath);
        return {
          id: `${index}-${relativePath}-${file.name}-${file.size}-${file.lastModified}`,
          file,
          relativePath,
          groupKey,
          previewUrl: URL.createObjectURL(file),
        };
      });

    if ((fileList?.length ?? 0) > 0 && nextFiles.length === 0) {
      window.alert(t.noSupportedImages);
    }

    setFiles(nextFiles);
    setAssignments(
      Object.fromEntries(
        nextFiles.map((item) => [
          item.id,
          selectedIndexPath,
        ]),
      ),
    );
    setImportPage(1);
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
          groups.map((group) => [
            group.groupKey,
            indexPathParts(group.groupKey),
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
          formData.append("indexPaths", JSON.stringify(indexPathParts(assignments[item.id] ?? "")));
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

      files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setFiles([]);
      setImportPreviewFile(null);
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

  function openIndexContextMenu(node: IndexTreeNode, event: React.MouseEvent<HTMLButtonElement>) {
    if (isBrowseMode) {
      return;
    }

    event.preventDefault();
    setSelectedIndexId(node.id);
    setIndexContextMenu({ node, x: event.clientX, y: event.clientY });
  }

  function openIndexAction(action: IndexAction) {
    setIndexContextMenu(null);
    setIndexAction(action);
    if (action.mode === "rename") {
      setRenameIndexName(action.node.name);
    }
    if (action.mode === "clear") {
      setClearIndexConfirmText("");
    }
  }

  function closeIndexAction(force = false) {
    if (indexActionBusy && !force) {
      return;
    }

    setIndexAction(null);
    setRenameIndexName("");
    setClearIndexConfirmText("");
  }

  async function renameIndexNode() {
    if (!indexAction || indexAction.mode !== "rename" || !renameIndexName.trim()) {
      return;
    }

    setIndexActionBusy(true);
    try {
      const response = await fetch("/api/index-nodes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: indexAction.node.id, name: renameIndexName }),
      });
      if (!response.ok) {
        window.alert(t.indexActionFailed);
        return;
      }

      closeIndexAction(true);
      await refresh();
    } finally {
      setIndexActionBusy(false);
    }
  }

  async function deleteIndexNode() {
    if (!indexAction || indexAction.mode !== "delete" || indexActionImageCount > 0) {
      return;
    }

    setIndexActionBusy(true);
    try {
      const response = await fetch("/api/index-nodes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: indexAction.node.id }),
      });
      if (!response.ok) {
        window.alert(t.indexActionFailed);
        return;
      }

      if (selectedIndexId === indexAction.node.id) {
        setSelectedIndexId(null);
      }
      closeIndexAction(true);
      await refresh();
    } finally {
      setIndexActionBusy(false);
    }
  }

  async function clearIndexImages() {
    if (
      !indexAction ||
      indexAction.mode !== "clear" ||
      clearIndexConfirmText !== destructiveConfirmPhrase
    ) {
      return;
    }

    setIndexActionBusy(true);
    try {
      const response = await fetch(`/api/index-nodes/${indexAction.node.id}/clear-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: clearIndexConfirmText }),
      });
      if (!response.ok) {
        window.alert(t.indexActionFailed);
        return;
      }

      setSelectedImageId(null);
      closeIndexAction(true);
      await refresh();
    } finally {
      setIndexActionBusy(false);
    }
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

  async function downloadBackup() {
    setBackingUp(true);
    try {
      const response = await fetch("/api/backups/export", { cache: "no-store" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        window.alert(result?.error ?? t.backupFailed);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backupFileNameFromHeader(response.headers.get("Content-Disposition"));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert(t.backupFailed);
    } finally {
      setBackingUp(false);
    }
  }

  function restoreCompleteMessage(stats: RestoreStats) {
    if (locale === "zh") {
      return [
        "恢复完成。",
        `索引：新建 ${stats.indexesCreated}，更新 ${stats.indexesUpdated}`,
        `图片：新建 ${stats.imagesCreated}，更新 ${stats.imagesUpdated}`,
        `文件：恢复 ${stats.filesRestored}`,
      ].join("\n");
    }

    return [
      "Restore complete.",
      `Indexes: ${stats.indexesCreated} created, ${stats.indexesUpdated} updated`,
      `Images: ${stats.imagesCreated} created, ${stats.imagesUpdated} updated`,
      `Files restored: ${stats.filesRestored}`,
    ].join("\n");
  }

  async function restoreBackup(file: File | null) {
    if (!file) {
      return;
    }

    if (!window.confirm(t.restoreConfirmMessage)) {
      return;
    }

    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append("backup", file);

      const response = await fetch("/api/backups/restore?mode=merge", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string; stats?: RestoreStats }
        | null;

      if (!response.ok || !result?.stats) {
        window.alert(result?.error ?? t.restoreFailed);
        return;
      }

      window.alert(restoreCompleteMessage(result.stats));
      setSelectedImageId(null);
      await refresh();
    } catch {
      window.alert(t.restoreFailed);
    } finally {
      setRestoring(false);
    }
  }

  async function undoBatch(batchId: string) {
    setUndoingBatchId(batchId);
    try {
      const response = await fetch(`/api/import/${batchId}/undo`, {
        method: "POST",
      });
      if (!response.ok) {
        window.alert(t.undoFailed);
        return;
      }

      setPendingUndoBatchId(null);
      setSelectedImageId(null);
      await refresh();
    } finally {
      setUndoingBatchId(null);
    }
  }

  async function deleteSelectedImage(imageId: string) {
    setDeletingImageId(imageId);
    try {
      const response = await fetch(`/api/images/${imageId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        window.alert(t.deleteImageFailed);
        return;
      }

      setPendingDeleteImage(null);
      setSelectedImageId(null);
      await refresh();
    } finally {
      setDeletingImageId(null);
    }
  }

  function selectImage(image: ChartImage) {
    setSelectedImageId(image.id);
    setImageZoom(100);
    setDetailDraft({
      title: image.title ?? "",
      notes: image.notes ?? "",
      indexNodeId: image.indexNode?.id ?? "",
    });
  }

  function selectAdjacentImage(direction: -1 | 1) {
    const images = data?.images ?? [];
    if (images.length < 2) {
      return;
    }

    const currentIndex = selectedImageIndex >= 0 ? selectedImageIndex : 0;
    const nextIndex = (currentIndex + direction + images.length) % images.length;
    selectImage(images[nextIndex]);
  }

  function selectIndex(id: string | null) {
    setSelectedIndexId(id);
    setImageGridPage(1);
  }

  function toggleIndexExpanded(id: string) {
    setCollapsedIndexIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function adjustImageZoom(delta: number) {
    setImageZoom((current) => clampZoom(current + delta));
  }

  function startViewerResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    viewerResizeStartRef.current = { height: imageViewerHeight, y: event.clientY };
    viewerHeightRef.current = imageViewerHeight;
    setIsResizingViewer(true);
  }

  function startImportTableResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    importTableResizeStartRef.current = { height: importTableHeight, y: event.clientY };
    importTableHeightRef.current = importTableHeight;
    setIsResizingImportTable(true);
  }

  function toggleBrowseThumbnails() {
    const nextValue = !showBrowseThumbnails;
    setShowBrowseThumbnails(nextValue);
    window.localStorage.setItem(
      "brooks-pa-atlas.browseThumbnails",
      nextValue ? "visible" : "hidden",
    );
  }

  function toggleLocale() {
    const nextLocale = locale === "zh" ? "en" : "zh";
    setLocale(nextLocale);
    window.localStorage.setItem("brooks-pa-atlas.locale", nextLocale);
  }

  function setPersistedViewModeWithPagination(mode: ViewMode) {
    setPersistedViewMode(mode);
    setImageGridPage(1);
  }

  function setPersistedViewMode(nextMode: ViewMode) {
    setViewMode(nextMode);
    window.localStorage.setItem("brooks-pa-atlas.viewMode", nextMode);
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

  function changeImageGridPageSize(value: number) {
    setImageGridPageSize(value);
    setImageGridPage(1);
    window.localStorage.setItem("brooks-pa-atlas.imageGridPageSize", String(value));
  }

  function clearSelectedFiles() {
    files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setFiles([]);
    setImportPreviewFile(null);
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
                onClick={() => selectIndex(null)}
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
              <button
                type="button"
                onClick={() => setPersistedViewModeWithPagination(isBrowseMode ? "manage" : "browse")}
                className="grid h-10 w-10 place-items-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                title={isBrowseMode ? t.manageMode : t.browseMode}
              >
                {isBrowseMode ? <PencilLine className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
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

              <div className="border-b border-zinc-200 p-3">
                <ModeSwitch
                  mode={viewMode}
                  labels={t}
                  onChange={setPersistedViewModeWithPagination}
                />
              </div>

              {!isBrowseMode ? (
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
              ) : null}

              <nav
                className={`max-h-96 overflow-auto p-3 xl:max-h-none ${
                  isBrowseMode ? "xl:h-[calc(100vh-119px)]" : "xl:h-[calc(100vh-183px)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectIndex(null)}
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
                  collapsedIds={collapsedIndexIds}
                  onSelect={selectIndex}
                  onToggleExpanded={toggleIndexExpanded}
                  onContextMenu={openIndexContextMenu}
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  setImageGridPage(1);
                }}
                className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-zinc-500"
                placeholder={t.searchPlaceholder}
              />
            </div>
            {!isBrowseMode ? (
              <>
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white hover:bg-cyan-800">
                  <ImageIcon className="h-4 w-4" />
                  <span>{t.chooseImages}</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      handleFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                  <FolderPlus className="h-4 w-4" />
                  <span>{t.chooseFolder}</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      handleFiles(event.target.files);
                      event.target.value = "";
                    }}
                    {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void downloadBackup()}
                  disabled={backingUp || restoring}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <span>{backingUp ? t.backingUp : t.backupData}</span>
                </button>
                <button
                  type="button"
                  onClick={() => restoreInputRef.current?.click()}
                  disabled={backingUp || restoring}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  <span>{restoring ? t.restoring : t.restoreData}</span>
                </button>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => {
                    void restoreBackup(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
          </div>

          {!isBrowseMode && files.length > 0 ? (
            <div className="border-b border-zinc-200 bg-white px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {files.length} {t.selected}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {t.selectedFiles} / {groups.length} {t.groups}
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
                <span>
                  {t.totalImages} {files.length} / {importStartIndex + 1}-{importEndIndex} / {t.page}{" "}
                  {importCurrentPage}/{importTotalPages}
                </span>
                <div className="flex items-center gap-2">
                  <span>{t.itemsPerPage}</span>
                  <select
                    value={importPageSize}
                    onChange={(event) => {
                      setImportPageSize(Number(event.target.value));
                      setImportPage(1);
                    }}
                    className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-zinc-500"
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setImportPage((page) => Math.max(1, page - 1))}
                    disabled={importCurrentPage <= 1}
                    className="h-8 rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {t.previousPage}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportPage((page) => Math.min(importTotalPages, page + 1))}
                    disabled={importCurrentPage >= importTotalPages}
                    className="h-8 rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {t.nextPage}
                  </button>
                </div>
              </div>
              <div
                className={`overflow-auto rounded-md border border-zinc-200 ${
                  isResizingImportTable ? "select-none" : ""
                }`}
                style={{ height: importTableHeight }}
              >
                <table className="min-w-full border-collapse bg-white text-sm">
                  <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-xs font-semibold text-zinc-500">
                    <tr className="border-b border-zinc-200">
                      <th className="min-w-52 px-3 py-2">{t.displayName}</th>
                      <th className="min-w-72 px-3 py-2">{t.assignedIndex}</th>
                      <th className="w-28 px-3 py-2">{t.thumbnail}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPageFiles.map((item) => (
                      <tr key={item.id} className="border-b border-zinc-100 last:border-0">
                        <td className="min-w-0 px-3 py-2">
                          <p className="truncate font-medium text-zinc-900" title={item.file.name}>
                            {item.file.name}
                          </p>
                          <p className="mt-1 truncate text-xs text-zinc-500" title={item.relativePath}>
                            {t.originalPath}: {item.relativePath}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={assignments[item.id] ?? ""}
                            onChange={(event) =>
                              setAssignments((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500"
                          >
                            <option value="">{t.unclassified}</option>
                            {flatIndexes.map((node) => (
                              <option key={node.id} value={node.path}>
                                {"- ".repeat(node.depth)}
                                {node.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setImportPreviewFile(item)}
                            className="h-14 w-20 overflow-hidden rounded border border-zinc-200 bg-zinc-100 transition hover:border-zinc-950"
                            title={t.previewImage}
                          >
                            <img
                              src={item.previewUrl}
                              alt={item.file.name}
                              className="h-full w-full object-contain"
                            />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onPointerDown={startImportTableResize}
                className="mx-auto mt-1 flex h-5 w-28 cursor-row-resize items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-white"
                title={t.resizeImportTable}
                aria-label={t.resizeImportTable}
              >
                <span className="h-1 w-12 rounded-full bg-zinc-400" />
              </button>
            </div>
          ) : null}

          <div className="overflow-auto p-5 xl:h-[calc(100vh-65px)]">
            {dataError ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <div className="min-w-0">
                  <p className="font-semibold">{t.dataLoadFailed}</p>
                  <p className="mt-1 break-all text-xs">{dataError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{t.retryLoad}</span>
                </button>
              </div>
            ) : null}

            {!isBrowseMode ? (
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
                              onClick={() => setPendingUndoBatchId(batch.id)}
                              disabled={undoingBatchId === batch.id}
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {undoingBatchId === batch.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Undo2 className="h-3.5 w-3.5" />
                              )}
                              <span>{undoingBatchId === batch.id ? t.undoing : t.undoBatch}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              </div>
            ) : null}

            {isBrowseMode && selectedImage ? (
              <div className="mb-4 rounded-md border border-zinc-200 bg-white p-4">
                <div className="mb-3 flex min-h-8 min-w-0 flex-wrap items-center gap-3">
                  <h2 className="min-w-0 flex-1 truncate text-base font-semibold" title={selectedImageTip}>
                    {selectedImage.title ?? selectedImage.originalName}
                  </h2>
                  <span className="min-w-0 max-w-[45%] truncate text-sm text-zinc-500" title={selectedImageTip}>
                    {selectedImage.indexNode?.path ?? t.unclassified}
                  </span>
                  <div className="ml-auto flex h-8 shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1">
                    <button
                      type="button"
                      onClick={toggleBrowseThumbnails}
                      className="inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-zinc-600 hover:bg-white"
                      title={showBrowseThumbnails ? t.hideThumbnails : t.showThumbnails}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      <span>{showBrowseThumbnails ? t.hideThumbnails : t.showThumbnails}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustImageZoom(-25)}
                      className="grid h-6 w-6 place-items-center rounded text-zinc-600 hover:bg-white"
                      title={t.zoomOut}
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="range"
                      min="50"
                      max="220"
                      step="10"
                      value={imageZoom}
                      onChange={(event) => setImageZoom(clampZoom(Number(event.target.value)))}
                      className="w-24 accent-zinc-950"
                      aria-label={t.zoomIn}
                    />
                    <span className="w-10 text-center text-xs font-medium text-zinc-600">
                      {imageZoom}%
                    </span>
                    <button
                      type="button"
                      onClick={() => adjustImageZoom(25)}
                      className="grid h-6 w-6 place-items-center rounded text-zinc-600 hover:bg-white"
                      title={t.zoomIn}
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageZoom(100)}
                      className="grid h-6 w-6 place-items-center rounded text-zinc-600 hover:bg-white"
                      title={t.resetZoom}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div
                  className={`group relative min-h-[420px] overflow-auto rounded-md border border-zinc-200 bg-zinc-100 ${
                    isResizingViewer ? "select-none" : ""
                  }`}
                  style={{ height: imageViewerHeight }}
                >
                  <div className="flex h-full min-h-full min-w-full items-center justify-center">
                    <img
                      src={`/api/images/${selectedImage.id}/file`}
                      alt={selectedImage.title ?? selectedImage.originalName}
                      className={imageZoom === 100 ? "h-full w-full object-contain" : "block max-w-none"}
                      style={imageZoom === 100 ? undefined : { width: `${imageZoom}%` }}
                    />
                  </div>
                  {canNavigateSelectedImage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => selectAdjacentImage(-1)}
                        className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-zinc-950/55 text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-zinc-950/75 focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label={t.previousImage}
                        title={t.previousImageShortcut}
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                      <button
                        type="button"
                        onClick={() => selectAdjacentImage(1)}
                        className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-zinc-950/55 text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-zinc-950/75 focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label={t.nextImage}
                        title={t.nextImageShortcut}
                      >
                        <ChevronRight className="h-6 w-6" />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onPointerDown={startViewerResize}
                    className="absolute bottom-0 left-1/2 z-10 flex h-5 w-28 -translate-x-1/2 cursor-row-resize items-center justify-center rounded-t-md border border-zinc-300 bg-white/85 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100"
                    title={t.resizeViewer}
                    aria-label={t.resizeViewer}
                  >
                    <span className="h-1 w-12 rounded-full bg-zinc-400" />
                  </button>
                </div>
              </div>
            ) : null}

            {shouldShowImageGrid ? (
              <>
                {imageGridTotal > 0 ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
                    <span>
                      {t.imageGrid} {imageGridTotal} / {imageGridStartIndex + 1}-{imageGridEndIndex} /{" "}
                      {t.page} {imageGridCurrentPage}/{imageGridTotalPages}
                    </span>
                    <div className="flex items-center gap-2">
                      <span>{t.itemsPerPage}</span>
                      <select
                        value={imageGridPageSize}
                        onChange={(event) => changeImageGridPageSize(Number(event.target.value))}
                        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-zinc-500"
                      >
                        {[25, 50, 100, 200].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setImageGridPage((page) => Math.max(1, page - 1))}
                        disabled={imageGridCurrentPage <= 1}
                        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        {t.previousPage}
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageGridPage((page) => Math.min(imageGridTotalPages, page + 1))}
                        disabled={imageGridCurrentPage >= imageGridTotalPages}
                        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        {t.nextPage}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                  {imageGridPageImages.map((image) => (
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
                {imageGridTotalPages > 1 ? (
                  <div className="mt-4 flex justify-end gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setImageGridPage((page) => Math.max(1, page - 1))}
                      disabled={imageGridCurrentPage <= 1}
                      className="h-8 rounded-md border border-zinc-200 bg-white px-3 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {t.previousPage}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageGridPage((page) => Math.min(imageGridTotalPages, page + 1))}
                      disabled={imageGridCurrentPage >= imageGridTotalPages}
                      className="h-8 rounded-md border border-zinc-200 bg-white px-3 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {t.nextPage}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {data?.images.length === 0 ? (
              <div className="grid h-72 place-items-center rounded-md border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                {t.noImages}
              </div>
            ) : null}
          </div>
        </section>

        {!isBrowseMode ? (
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
                <button
                  type="button"
                  onClick={() => setPendingDeleteImage(selectedImage)}
                  disabled={deletingImageId === selectedImage.id}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingImageId === selectedImage.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  <span>{deletingImageId === selectedImage.id ? t.deleting : t.deleteImage}</span>
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
                      onClick={() => setPendingUndoBatchId(batch.id)}
                      disabled={undoingBatchId === batch.id}
                      className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {undoingBatchId === batch.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Undo2 className="h-3.5 w-3.5" />
                      )}
                      <span>{undoingBatchId === batch.id ? t.undoing : t.undoBatch}</span>
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
        ) : null}
      </div>
      {indexContextMenu && !isBrowseMode ? (
        <div
          className="fixed z-40 w-56 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-xl"
          style={{ left: indexContextMenu.x, top: indexContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => openIndexAction({ mode: "rename", node: indexContextMenu.node })}
            className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-zinc-700 hover:bg-zinc-100"
          >
            <PencilLine className="h-4 w-4" />
            <span>{t.renameIndex}</span>
          </button>
          <button
            type="button"
            onClick={() => openIndexAction({ mode: "delete", node: indexContextMenu.node })}
            disabled={indexContextImageCount > 0}
            className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent"
            title={indexContextImageCount > 0 ? t.deleteIndexDisabled : t.deleteIndex}
          >
            <Trash2 className="h-4 w-4" />
            <span>{t.deleteIndex}</span>
          </button>
          <button
            type="button"
            onClick={() => openIndexAction({ mode: "clear", node: indexContextMenu.node })}
            disabled={indexContextImageCount === 0}
            className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent"
            title={indexContextImageCount === 0 ? t.clearIndexImagesDisabled : t.clearIndexImages}
          >
            <AlertTriangle className="h-4 w-4" />
            <span>{t.clearIndexImages}</span>
          </button>
        </div>
      ) : null}
      {indexAction ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/50 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => closeIndexAction()}
        >
          <div
            className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            {indexAction.mode === "rename" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void renameIndexNode();
                }}
              >
                <h2 className="text-base font-semibold text-zinc-950">{t.renameIndex}</h2>
                <p className="mt-1 truncate text-sm text-zinc-500" title={indexAction.node.path}>
                  {indexAction.node.path}
                </p>
                <input
                  autoFocus
                  value={renameIndexName}
                  onChange={(event) => setRenameIndexName(event.target.value)}
                  className="mt-4 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500"
                />
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => closeIndexAction()}
                    disabled={indexActionBusy}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={indexActionBusy || !renameIndexName.trim()}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {indexActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>{indexActionBusy ? t.saving : t.save}</span>
                  </button>
                </div>
              </form>
            ) : null}

            {indexAction.mode === "delete" ? (
              <div>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700">
                    <Trash2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-zinc-950">
                      {t.deleteIndexConfirmTitle}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">
                      {t.deleteIndexConfirmMessage}
                    </p>
                    <p className="mt-3 truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                      {indexAction.node.path}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => closeIndexAction()}
                    disabled={indexActionBusy}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteIndexNode()}
                    disabled={indexActionBusy || indexActionImageCount > 0}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-700 bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {indexActionBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span>{indexActionBusy ? t.deleting : t.deleteIndex}</span>
                  </button>
                </div>
              </div>
            ) : null}

            {indexAction.mode === "clear" ? (
              <div>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-zinc-950">
                      {t.clearIndexImagesTitle}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">
                      {t.clearIndexImagesMessage}
                    </p>
                    <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                      {indexAction.node.path} / {indexActionImageCount} {t.imageUnit}
                    </p>
                  </div>
                </div>
                <label className="mt-4 block">
                  <span className="text-xs font-medium text-zinc-500">
                    {t.clearIndexImagesTyping}
                  </span>
                  <input
                    autoFocus
                    value={clearIndexConfirmText}
                    onChange={(event) => setClearIndexConfirmText(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500"
                    placeholder={destructiveConfirmPhrase}
                  />
                </label>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => closeIndexAction()}
                    disabled={indexActionBusy}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearIndexImages()}
                    disabled={
                      indexActionBusy ||
                      indexActionImageCount === 0 ||
                      clearIndexConfirmText !== destructiveConfirmPhrase
                    }
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-700 bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {indexActionBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    <span>{indexActionBusy ? t.deleting : t.clearIndexImages}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {pendingDeleteImage ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/50 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-image-title"
          onClick={() => {
            if (deletingImageId !== pendingDeleteImage.id) {
              setPendingDeleteImage(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="delete-image-title" className="text-base font-semibold text-zinc-950">
                  {t.deleteImageConfirmTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{t.deleteImageConfirmMessage}</p>
                <p
                  className="mt-3 truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
                  title={pendingDeleteImage.originalName}
                >
                  {pendingDeleteImage.title ?? pendingDeleteImage.originalName}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteImage(null)}
                disabled={deletingImageId === pendingDeleteImage.id}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => void deleteSelectedImage(pendingDeleteImage.id)}
                disabled={deletingImageId === pendingDeleteImage.id}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-700 bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingImageId === pendingDeleteImage.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span>{deletingImageId === pendingDeleteImage.id ? t.deleting : t.deleteImage}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingUndoBatch ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/50 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="undo-batch-title"
          onClick={() => {
            if (undoingBatchId !== pendingUndoBatch.id) {
              setPendingUndoBatchId(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="undo-batch-title" className="text-base font-semibold text-zinc-950">
                  {t.undoConfirmTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{t.undoConfirmMessage}</p>
                <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  {batchStatusLabels[locale][pendingUndoBatch.status] ?? pendingUndoBatch.status} /{" "}
                  {pendingUndoBatch.successCount}/{pendingUndoBatch.totalCount} / {t.duplicates}{" "}
                  {pendingUndoBatch.duplicateCount}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingUndoBatchId(null)}
                disabled={undoingBatchId === pendingUndoBatch.id}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => void undoBatch(pendingUndoBatch.id)}
                disabled={undoingBatchId === pendingUndoBatch.id}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-700 bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {undoingBatchId === pendingUndoBatch.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                <span>{undoingBatchId === pendingUndoBatch.id ? t.undoing : t.confirmUndo}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {importPreviewFile ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/70 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t.previewImage}
          onClick={() => setImportPreviewFile(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-5xl rounded-md bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={importPreviewFile.file.name}>
                  {importPreviewFile.file.name}
                </p>
                <p className="truncate text-xs text-zinc-500" title={importPreviewFile.relativePath}>
                  {importPreviewFile.relativePath}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportPreviewFile(null)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                title={t.closePreview}
                aria-label={t.closePreview}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[78vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-100">
              <img
                src={importPreviewFile.previewUrl}
                alt={importPreviewFile.file.name}
                className="mx-auto max-h-[78vh] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
