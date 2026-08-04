"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  ImageIcon,
  Loader2,
  Maximize2,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Tag as TagIcon,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import ExamMode from "@/app/exam-mode";

type IndexTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: string;
  sortOrder: number;
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
  tags: ImageTag[];
  annotations: ImageAnnotation[];
  indexNode: { id: string; name: string; path: string } | null;
};

type ImageDetailDraft = {
  title: string;
  notes: string;
  ocrText: string;
  indexNodeId: string;
  tagNames: string[];
};

type ImageAnnotation = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  backgroundColor: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type AnnotationResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const annotationResizeHandles: {
  handle: AnnotationResizeHandle;
  className: string;
  cursor: string;
}[] = [
  { handle: "nw", className: "-left-1.5 -top-1.5", cursor: "cursor-nwse-resize" },
  { handle: "n", className: "left-1/2 -top-1.5 -translate-x-1/2", cursor: "cursor-ns-resize" },
  { handle: "ne", className: "-right-1.5 -top-1.5", cursor: "cursor-nesw-resize" },
  { handle: "e", className: "-right-1.5 top-1/2 -translate-y-1/2", cursor: "cursor-ew-resize" },
  { handle: "se", className: "-bottom-1.5 -right-1.5", cursor: "cursor-nwse-resize" },
  { handle: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2", cursor: "cursor-ns-resize" },
  { handle: "sw", className: "-bottom-1.5 -left-1.5", cursor: "cursor-nesw-resize" },
  { handle: "w", className: "-left-1.5 top-1/2 -translate-y-1/2", cursor: "cursor-ew-resize" },
];

const viewerFitSafetyPx = 2;
const imageZoomStep = 10;

let cachedScrollbarThickness: number | null = null;

type ImageTag = {
  id: string;
  name: string;
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
  tags: ImageTag[];
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
  examPapersRestored?: number;
  examAttemptsRestored?: number;
};

type BackupJobSnapshot = {
  id: string;
  kind: "backup" | "restore";
  status: "running" | "completed" | "failed";
  phase: string;
  processedImages: number;
  totalImages: number;
  error: string | null;
  fileName: string | null;
  stats: RestoreStats | null;
};

type DocumentImportJobSnapshot = {
  id: string;
  kind: string;
  status: "running" | "completed" | "failed";
  phase: string;
  processedPages: number;
  totalPages: number;
  imported: number;
  failed: number;
  duplicate: number;
  batchId: string | null;
  error: string | null;
};

type Locale = "zh" | "en";
type ViewMode = "browse" | "manage" | "exam";
type IndexContextMenu = { node: IndexTreeNode; x: number; y: number };
type IndexDropPosition = "before" | "after";
type IndexDropIndicator = { id: string; position: IndexDropPosition };
type IndexAction =
  | { mode: "rename"; node: IndexTreeNode }
  | { mode: "delete"; node: IndexTreeNode }
  | { mode: "clear"; node: IndexTreeNode };
type NoticeDialog = {
  title: string;
  message: string;
  tone: "warning" | "error";
};

type TagSuggestionInputProps = {
  ariaLabel: string;
  className?: string;
  excludedNames?: string[];
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  suggestions: ImageTag[];
  submitOnComma?: boolean;
  value: string;
};

type TagRemovalSelectorProps = {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  options: Array<ImageTag & { count: number }>;
  placeholder: string;
  totalCount: number;
  value: string;
};

type TagFilterSelectorProps = {
  ariaLabel: string;
  className?: string;
  clearLabel: string;
  onClear: () => void;
  onToggle: (id: string) => void;
  options: ImageTag[];
  selectedIds: Set<string>;
};

type IndexTreeSelectorProps = {
  labels: {
    choose: string;
    collapse: string;
    expand: string;
    noResults: string;
    searchPlaceholder: string;
    unclassified: string;
  };
  nodes: IndexTreeNode[];
  onChange: (value: string) => void;
  value: string;
};

const chunkSize = 80;
const destructiveConfirmPhrase = "确认删除";
const collapsedIndexesStorageKey = "brooks-pa-atlas.collapsedIndexes";
const maxTagSuggestions = 8;

const copy = {
  zh: {
    imageUnit: "张图片",
    refresh: "刷新",
    newIndex: "新建索引",
    addIndex: "添加索引",
    renameIndex: "重命名索引",
    exportIndex: "导出索引",
    collapseLeafIndexes: "收缩叶子节点",
    collapseLeafIndexesDisabled: "当前索引没有可收缩的子节点。",
    deleteIndex: "删除索引",
    clearIndexImages: "清空索引图片",
    deleteIndexConfirmTitle: "删除索引？",
    deleteIndexConfirmMessage: "该索引及其空子索引会被删除。只有当前索引和子索引下没有图片时才能执行。",
    deleteIndexDisabled: "当前索引或子索引下仍有图片，不能删除。",
    clearIndexImagesTitle: "清空当前索引下面的所有图片？",
    clearIndexImagesMessage: "此操作会删除当前索引及其所有子索引下的图片文件和记录，无法撤销。",
    clearIndexImagesTyping: "请输入“确认删除”以继续。",
    clearIndexImagesDisabled: "当前索引和子索引下没有图片可清空。",
    clearIndexImagesBlockedTitle: "无法清空索引图片",
    clearIndexImagesBlockedByExam:
      "该索引或其子索引中的图片已被考试题目引用，不能清空。请先从相关试卷中移除题目，或删除对应试卷后再试。",
    clearIndexImagesFailedTitle: "清空索引图片失败",
    indexActionFailedTitle: "索引操作失败",
    indexActionFailed: "索引操作失败，请稍后重试。",
    reorderIndex: "拖动调整顺序",
    reorderIndexMode: "索引排序",
    reorderIndexFailed: "索引排序失败，请稍后重试。",
    allImages: "全部图片",
    searchPlaceholder: "搜索标题、OCR、备注、标注、索引、标签",
    tags: "标签",
    tagPlaceholder: "输入或选择标签",
    addTag: "添加标签",
    removeTag: "移除标签",
    activeTag: "标签筛选",
    clearTagFilter: "清除标签筛选",
    bulkSelected: "已选图片",
    bulkAddTag: "批量添加",
    bulkRemoveTag: "批量移除",
    bulkTagUpdateFailed: "批量更新标签失败，请稍后重试。",
    chooseImages: "选择图片",
    chooseFolder: "选择文件夹",
    importDocuments: "导入资料",
    importingDocuments: "导入资料中",
    runImportOcr: "导入后 OCR",
    backupData: "备份",
    backingUp: "备份中",
    restoreData: "恢复",
    restoring: "恢复中",
    backupFailed: "备份失败，请稍后重试。",
    restoreFailed: "恢复失败，请确认 zip 文件有效后重试。",
    restoreConfirmMessage:
      "恢复会合并备份数据：相同图片会覆盖标题、备注、标签、OCR 和索引归属，不会删除当前系统中备份外的数据。是否继续？",
    backupTaskTitle: "备份进度",
    restoreTaskTitle: "恢复进度",
    taskPreparing: "正在准备任务",
    taskCollectingImages: "正在处理图片",
    taskPacking: "正在打包备份文件",
    taskUploading: "正在上传备份文件",
    taskRestoringIndexes: "正在恢复索引",
    taskRestoringImages: "正在恢复图片",
    taskDownloading: "正在保存备份文件",
    taskCompleted: "已完成",
    taskFailed: "失败",
    taskDismiss: "关闭",
    taskKeepWorking: "可继续使用页面，任务会在后台运行。",
    noSupportedImages: "未找到支持的图片文件。",
    noSupportedDocuments: "未找到支持的资料文件。",
    documentImportCompletedWithErrors: "资料导入完成但有错误",
    documentImportSummary: "成功 {imported}/{total}，失败 {failed}，重复 {duplicate}",
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
    deleteImageBlockedTitle: "无法删除图片",
    deleteImageBlockedByExam: "这张图片已被考试题目引用，不能删除。请先从相关试卷中移除题目，或删除对应试卷后再试。",
    deleteImageFailedTitle: "删除图片失败",
    deleteImageFailed: "删除图片失败，请稍后重试。",
    title: "标题",
    index: "索引",
    chooseIndex: "选择索引",
    searchIndex: "搜索索引名称或路径",
    noMatchingIndex: "没有匹配的索引",
    expandIndex: "展开索引",
    collapseIndex: "收起索引",
    notes: "备注",
    save: "保存",
    retryOcr: "重试 OCR",
    runOcr: "执行 OCR",
    ocrText: "OCR 文本",
    ocrOverwriteConfirm: "当前已有 OCR 文本。重新 OCR 会在完成后覆盖现有内容，是否继续？",
    ocrUpdateFailed: "OCR 操作失败，请稍后重试。",
    noOcrText: "暂无 OCR 文本",
    size: "大小",
    pixels: "像素",
    unknown: "未知",
    hash: "Hash",
    noImageSelected: "请选择一张图片",
    openLargeViewer: "大图查看",
    backToImageGrid: "返回图片列表",
    detailsSaveFailedTitle: "图片详情保存失败",
    detailsSaveFailed: "图片详情保存失败，已停留在当前图片，请稍后重试。",
    duplicates: "重复",
    ocrFailedShort: "OCR 失败",
    browse: "浏览",
    manage: "管理",
    exam: "考试",
    browseMode: "浏览模式",
    manageMode: "管理模式",
    examMode: "考试模式",
    previousImage: "上一张图片",
    nextImage: "下一张图片",
    previousImageShortcut: "上一张图片（快捷键 ←）",
    nextImageShortcut: "下一张图片（快捷键 →）",
    zoomIn: "放大",
    zoomOut: "缩小",
    resetZoom: "重置缩放",
    hideThumbnails: "隐藏缩略图",
    showThumbnails: "显示缩略图",
    hideAnnotations: "隐藏标注",
    showAnnotations: "显示标注",
    editAnnotations: "编辑标注",
    stopEditAnnotations: "完成标注",
    annotationStyle: "标注样式",
    annotationFontSize: "字号",
    annotationColor: "颜色",
    addAnnotationHint: "点击图片添加文字标注",
    annotationTextPlaceholder: "输入标注",
    deleteAnnotation: "删除标注",
    annotationsSaving: "标注保存中",
    annotationsSaveFailed: "标注自动保存失败",
    hideBrowseNotes: "隐藏备注",
    showBrowseNotes: "显示备注",
    browseNotesTitle: "备注",
    noBrowseNotes: "暂无备注",
    resizeViewer: "拖动调整查看区高度",
    language: "EN",
  },
  en: {
    imageUnit: "images",
    refresh: "Refresh",
    newIndex: "New index",
    addIndex: "Add index",
    renameIndex: "Rename index",
    exportIndex: "Export index",
    collapseLeafIndexes: "Collapse leaf nodes",
    collapseLeafIndexesDisabled: "This index has no child nodes to collapse.",
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
    clearIndexImagesBlockedTitle: "Index images cannot be cleared",
    clearIndexImagesBlockedByExam:
      "This index or its child indexes contain images used by exam questions. Remove those questions from the related paper, or delete that paper, then try again.",
    clearIndexImagesFailedTitle: "Clear index images failed",
    indexActionFailedTitle: "Index action failed",
    indexActionFailed: "Index action failed. Please try again.",
    reorderIndex: "Drag to reorder",
    reorderIndexMode: "Reorder",
    reorderIndexFailed: "Index reorder failed. Please try again.",
    allImages: "All images",
    searchPlaceholder: "Search title, OCR, notes, annotations, index, tags",
    tags: "Tags",
    tagPlaceholder: "Enter or select a tag",
    addTag: "Add tag",
    removeTag: "Remove tag",
    activeTag: "Tag filter",
    clearTagFilter: "Clear tag filter",
    bulkSelected: "Selected images",
    bulkAddTag: "Add to selected",
    bulkRemoveTag: "Remove from selected",
    bulkTagUpdateFailed: "Bulk tag update failed. Please try again.",
    chooseImages: "Choose images",
    chooseFolder: "Choose folder",
    importDocuments: "Import materials",
    importingDocuments: "Importing materials",
    runImportOcr: "Run OCR after import",
    backupData: "Backup",
    backingUp: "Backing up",
    restoreData: "Restore",
    restoring: "Restoring",
    backupFailed: "Backup failed. Please try again.",
    restoreFailed: "Restore failed. Please confirm the zip file is valid and try again.",
    restoreConfirmMessage:
      "Restore will merge backup data: matching images overwrite title, notes, tags, OCR, and index assignment, and data outside the backup will not be deleted. Continue?",
    backupTaskTitle: "Backup progress",
    restoreTaskTitle: "Restore progress",
    taskPreparing: "Preparing task",
    taskCollectingImages: "Processing images",
    taskPacking: "Packing backup file",
    taskUploading: "Uploading backup file",
    taskRestoringIndexes: "Restoring indexes",
    taskRestoringImages: "Restoring images",
    taskDownloading: "Saving backup file",
    taskCompleted: "Completed",
    taskFailed: "Failed",
    taskDismiss: "Close",
    taskKeepWorking: "You can keep using the page while this runs in the background.",
    noSupportedImages: "No supported image files found.",
    noSupportedDocuments: "No supported material files found.",
    documentImportCompletedWithErrors: "Material import completed with errors",
    documentImportSummary: "Imported {imported}/{total}, failed {failed}, duplicates {duplicate}",
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
    deleteImageBlockedTitle: "Image cannot be deleted",
    deleteImageBlockedByExam:
      "This image is used by exam questions and cannot be deleted. Remove it from the related paper, or delete that paper, then try again.",
    deleteImageFailedTitle: "Image deletion failed",
    deleteImageFailed: "Image deletion failed. Please try again.",
    title: "Title",
    index: "Index",
    chooseIndex: "Choose index",
    searchIndex: "Search index name or path",
    noMatchingIndex: "No matching indexes",
    expandIndex: "Expand index",
    collapseIndex: "Collapse index",
    notes: "Notes",
    save: "Save",
    retryOcr: "Retry OCR",
    runOcr: "Run OCR",
    ocrText: "OCR text",
    ocrOverwriteConfirm: "This image already has OCR text. Running OCR again will overwrite it when completed. Continue?",
    ocrUpdateFailed: "OCR update failed. Please try again.",
    noOcrText: "No OCR text",
    size: "Size",
    pixels: "Pixels",
    unknown: "Unknown",
    hash: "Hash",
    noImageSelected: "No image selected",
    openLargeViewer: "Open large viewer",
    backToImageGrid: "Back to image grid",
    detailsSaveFailedTitle: "Image details could not be saved",
    detailsSaveFailed: "Image details could not be saved. You are still on the current image. Please try again.",
    duplicates: "duplicates",
    ocrFailedShort: "OCR failed",
    browse: "Browse",
    manage: "Manage",
    exam: "Exam",
    browseMode: "Browse mode",
    manageMode: "Manage mode",
    examMode: "Exam mode",
    previousImage: "Previous image",
    nextImage: "Next image",
    previousImageShortcut: "Previous image (shortcut ←)",
    nextImageShortcut: "Next image (shortcut →)",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetZoom: "Reset zoom",
    hideThumbnails: "Hide thumbnails",
    showThumbnails: "Show thumbnails",
    hideAnnotations: "Hide annotations",
    showAnnotations: "Show annotations",
    editAnnotations: "Edit annotations",
    stopEditAnnotations: "Done editing",
    annotationStyle: "Annotation style",
    annotationFontSize: "Size",
    annotationColor: "Color",
    addAnnotationHint: "Click the image to add a text note",
    annotationTextPlaceholder: "Enter annotation",
    deleteAnnotation: "Delete annotation",
    annotationsSaving: "Saving annotations",
    annotationsSaveFailed: "Annotation autosave failed",
    hideBrowseNotes: "Hide notes",
    showBrowseNotes: "Show notes",
    browseNotesTitle: "Notes",
    noBrowseNotes: "No notes yet",
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

function expandedIndexIdsForSelection(nodes: IndexTreeNode[], selectedId: string) {
  const expanded = new Set(nodes.map((node) => node.id));

  function visit(node: IndexTreeNode, ancestors: string[]): boolean {
    if (node.id === selectedId) {
      ancestors.forEach((id) => expanded.add(id));
      return true;
    }

    return node.children.some((child) => visit(child, [...ancestors, node.id]));
  }

  nodes.some((node) => visit(node, []));
  return expanded;
}

function IndexTreeSelector({ labels, nodes, onChange, value }: IndexTreeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    expandedIndexIdsForSelection(nodes, value),
  );
  const [popoverStyle, setPopoverStyle] = useState<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const treeId = useId();
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);
  const selectedNode = flatNodes.find((node) => node.id === value) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingNodes = useMemo(
    () =>
      normalizedQuery
        ? flatNodes.filter((node) =>
            `${node.name}\n${node.path}`.toLocaleLowerCase().includes(normalizedQuery),
          )
        : [],
    [flatNodes, normalizedQuery],
  );
  const visibleNodes = useMemo(() => {
    const result: Array<{ node: IndexTreeNode; displayDepth: number }> = [];

    function visit(branch: IndexTreeNode[], displayDepth: number) {
      branch.forEach((node) => {
        result.push({ node, displayDepth });
        if (node.children.length > 0 && expandedIds.has(node.id)) {
          visit(node.children, displayDepth + 1);
        }
      });
    }

    visit(nodes, 0);
    return result;
  }, [expandedIds, nodes]);
  const navigableIds = normalizedQuery
    ? matchingNodes.map((node) => node.id)
    : ["", ...visibleNodes.map(({ node }) => node.id)];

  const closePopover = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setQuery("");
    setActiveId(null);
    setPopoverStyle(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        closePopover();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopover(true);
      }
    }

    function handleViewportScroll(event: Event) {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) {
        return;
      }

      closePopover();
    }

    function handleViewportResize() {
      closePopover();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("scroll", handleViewportScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("scroll", handleViewportScroll, true);
    };
  }, [closePopover, isOpen]);

  function openPopover() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const viewportPadding = 8;
    const gap = 6;
    const desiredWidth = Math.max(rect.width, 360);
    const width = Math.min(desiredWidth, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      window.innerWidth - width - viewportPadding,
    );
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const openAbove = spaceBelow < 360 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(430, Math.max(220, openAbove ? spaceAbove : spaceBelow));
    const top = openAbove ? rect.top - maxHeight - gap : rect.bottom + gap;

    setExpandedIds(expandedIndexIdsForSelection(nodes, value));
    setActiveId(value);
    setPopoverStyle({ left, maxHeight, top, width });
    setIsOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }

  function choose(id: string) {
    onChange(id);
    closePopover(true);
  }

  function moveActive(direction: 1 | -1) {
    if (navigableIds.length === 0) {
      return;
    }

    const currentIndex = activeId === null ? -1 : navigableIds.indexOf(activeId);
    const nextIndex =
      currentIndex < 0
        ? direction === 1
          ? 0
          : navigableIds.length - 1
        : (currentIndex + direction + navigableIds.length) % navigableIds.length;
    setActiveId(navigableIds[nextIndex]);
    window.requestAnimationFrame(() => {
      document.getElementById(`${treeId}-${navigableIds[nextIndex] || "unclassified"}`)?.scrollIntoView({
        block: "nearest",
      });
    });
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" && activeId !== null && navigableIds.includes(activeId)) {
      event.preventDefault();
      choose(activeId);
    }
  }

  const popover =
    isOpen && popoverStyle && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[80] flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/15"
            style={popoverStyle}
          >
            <div className="flex min-h-0 w-full flex-col">
              <div className="border-b border-zinc-100 p-2.5">
                <div className="flex h-9 items-center rounded-lg border border-zinc-200 bg-zinc-50 transition focus-within:border-cyan-600 focus-within:bg-white focus-within:ring-2 focus-within:ring-cyan-100">
                  <Search className="ml-2.5 h-4 w-4 shrink-0 text-zinc-400" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => {
                      const nextQuery = event.target.value;
                      const normalized = nextQuery.trim().toLocaleLowerCase();
                      const firstMatch = normalized
                        ? flatNodes.find((node) =>
                            `${node.name}\n${node.path}`.toLocaleLowerCase().includes(normalized),
                          )
                        : null;
                      setQuery(nextQuery);
                      setActiveId(normalized ? (firstMatch?.id ?? null) : value);
                    }}
                    onKeyDown={handleSearchKeyDown}
                    className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                    placeholder={labels.searchPlaceholder}
                    aria-label={labels.searchPlaceholder}
                    aria-controls={treeId}
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setActiveId(value);
                        searchRef.current?.focus();
                      }}
                      className="mr-1 grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      aria-label={labels.searchPlaceholder}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div id={treeId} role="tree" className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {!normalizedQuery ? (
                  <button
                    id={`${treeId}-unclassified`}
                    type="button"
                    role="treeitem"
                    aria-selected={value === ""}
                    onMouseEnter={() => setActiveId("")}
                    onClick={() => choose("")}
                    className={`mb-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition ${
                      activeId === "" || value === ""
                        ? "bg-cyan-50 text-cyan-900"
                        : "text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-zinc-100 text-zinc-500">
                      <ImageIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{labels.unclassified}</span>
                    {value === "" ? <Check className="h-4 w-4 shrink-0 text-cyan-700" /> : null}
                  </button>
                ) : null}

                {normalizedQuery ? (
                  matchingNodes.length > 0 ? (
                    <div className="space-y-0.5">
                      {matchingNodes.map((node) => (
                        <button
                          id={`${treeId}-${node.id}`}
                          type="button"
                          role="treeitem"
                          aria-level={node.depth + 1}
                          aria-selected={node.id === value}
                          key={node.id}
                          onMouseEnter={() => setActiveId(node.id)}
                          onClick={() => choose(node.id)}
                          className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                            activeId === node.id || value === node.id
                              ? "bg-cyan-50 text-cyan-950"
                              : "text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          <Folder className="h-4 w-4 shrink-0 text-cyan-700" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{node.name}</span>
                            <span className="block truncate text-[11px] text-zinc-400">{node.path}</span>
                          </span>
                          <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                            {node.imageCount}
                          </span>
                          {value === node.id ? <Check className="h-4 w-4 shrink-0 text-cyan-700" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-28 place-items-center px-4 text-center text-sm text-zinc-400">
                      <div>
                        <Search className="mx-auto mb-2 h-5 w-5 opacity-60" />
                        <p>{labels.noResults}</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-0.5">
                    {visibleNodes.map(({ node, displayDepth }) => {
                      const hasChildren = node.children.length > 0;
                      const isExpanded = expandedIds.has(node.id);
                      const isSelected = node.id === value;
                      return (
                        <div
                          id={`${treeId}-${node.id}`}
                          key={node.id}
                          role="treeitem"
                          aria-level={displayDepth + 1}
                          aria-expanded={hasChildren ? isExpanded : undefined}
                          aria-selected={isSelected}
                          className={`group flex h-9 items-center rounded-lg transition ${
                            activeId === node.id || isSelected
                              ? "bg-cyan-50 text-cyan-950"
                              : "text-zinc-700 hover:bg-zinc-50"
                          }`}
                          style={{ paddingLeft: 4 + displayDepth * 16 }}
                          onMouseEnter={() => setActiveId(node.id)}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (!hasChildren) {
                                return;
                              }
                              setExpandedIds((current) => {
                                const next = new Set(current);
                                if (next.has(node.id)) {
                                  next.delete(node.id);
                                } else {
                                  next.add(node.id);
                                }
                                return next;
                              });
                            }}
                            disabled={!hasChildren}
                            className="grid h-7 w-6 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-cyan-100 hover:text-cyan-800 disabled:opacity-0"
                            aria-label={isExpanded ? labels.collapse : labels.expand}
                            tabIndex={-1}
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition ${isExpanded ? "rotate-90" : ""}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => choose(node.id)}
                            className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
                            tabIndex={-1}
                          >
                            {hasChildren && isExpanded ? (
                              <FolderOpen className="h-4 w-4 shrink-0 text-cyan-700" />
                            ) : (
                              <Folder className="h-4 w-4 shrink-0 text-cyan-700" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
                            <span className="mr-1 shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                              {node.imageCount}
                            </span>
                            {isSelected ? <Check className="mr-1 h-4 w-4 shrink-0 text-cyan-700" /> : null}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? closePopover() : openPopover())}
        onKeyDown={(event) => {
          if (!isOpen && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            openPopover();
          }
        }}
        className={`flex min-h-12 w-full items-center gap-2 rounded-lg border bg-white px-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-100 ${
          isOpen ? "border-cyan-600 ring-2 ring-cyan-100" : "border-zinc-200 hover:border-cyan-300"
        }`}
        aria-controls={treeId}
        aria-expanded={isOpen}
        aria-haspopup="tree"
        aria-label={labels.choose}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-cyan-50 text-cyan-700">
          {selectedNode ? <Folder className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-800">
            {selectedNode?.name ?? labels.unclassified}
          </span>
          <span className="block truncate text-[11px] text-zinc-400">
            {selectedNode?.path ?? labels.choose}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-400 transition ${isOpen ? "rotate-180 text-cyan-700" : ""}`}
        />
      </button>
      {popover}
    </div>
  );
}

function indexBranchImageCount(node: IndexTreeNode): number {
  return node.imageCount;
}

function orderedIndexSiblings(nodes: IndexTreeNode[], orderedIds: string[]) {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  return [...nodes]
    .sort((left, right) => {
      const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.name.localeCompare(right.name);
    })
    .map((node, sortOrder) => ({ ...node, sortOrder }));
}

function applyIndexSiblingOrder(
  nodes: IndexTreeNode[],
  parentId: string | null,
  orderedIds: string[],
): IndexTreeNode[] {
  if (parentId === null) {
    return orderedIndexSiblings(nodes, orderedIds);
  }

  return nodes.map((node) => ({
    ...node,
    children:
      node.id === parentId
        ? orderedIndexSiblings(node.children, orderedIds)
        : applyIndexSiblingOrder(node.children, parentId, orderedIds),
  }));
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function addTagName(names: string[], value: string) {
  const name = value.trim();
  if (!name || names.some((item) => item.toLowerCase() === name.toLowerCase())) {
    return names;
  }

  return [...names, name].sort((left, right) => left.localeCompare(right));
}

function removeTagName(names: string[], value: string) {
  const normalizedName = value.toLowerCase();
  return names.filter((item) => item.toLowerCase() !== normalizedName);
}

function TagSuggestionInput({
  ariaLabel,
  className = "",
  excludedNames = [],
  onChange,
  onSubmit,
  placeholder,
  suggestions,
  submitOnComma = false,
  value,
}: TagSuggestionInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const normalizedQuery = value.trim().toLowerCase();
  const excluded = new Set(excludedNames.map((name) => name.toLowerCase()));
  const filteredSuggestions = suggestions
    .filter((tag) => !excluded.has(tag.name.toLowerCase()))
    .filter((tag) => !normalizedQuery || tag.name.toLowerCase().includes(normalizedQuery))
    .slice(0, maxTagSuggestions);

  function chooseSuggestion(name: string) {
    onChange(name);
    setActiveIndex(-1);
    setIsOpen(false);
  }

  function closeWhenFocusLeaves() {
    window.setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setActiveIndex(-1);
        setIsOpen(false);
      }
    }, 0);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex h-full items-center rounded-md border border-zinc-200 bg-white transition focus-within:border-cyan-600 focus-within:ring-2 focus-within:ring-cyan-100">
        <TagIcon className="ml-2.5 h-3.5 w-3.5 shrink-0 text-cyan-700" />
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(-1);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={closeWhenFocusLeaves}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && filteredSuggestions.length > 0) {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => (current + 1) % filteredSuggestions.length);
              return;
            }

            if (event.key === "ArrowUp" && filteredSuggestions.length > 0) {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) =>
                current <= 0 ? filteredSuggestions.length - 1 : current - 1,
              );
              return;
            }

            if (event.key === "Escape") {
              setActiveIndex(-1);
              setIsOpen(false);
              return;
            }

            if (event.key === "Enter" || (submitOnComma && event.key === ",")) {
              event.preventDefault();
              if (activeIndex >= 0) {
                chooseSuggestion(filteredSuggestions[activeIndex].name);
              } else {
                onSubmit();
                setIsOpen(false);
              }
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-inherit outline-none"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-controls={listboxId}
          aria-expanded={isOpen && filteredSuggestions.length > 0}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          role="combobox"
        />
        <button
          type="button"
          onClick={() => {
            setActiveIndex(-1);
            setIsOpen((current) => !current);
          }}
          onBlur={closeWhenFocusLeaves}
          className="grid h-full w-8 shrink-0 place-items-center text-zinc-400 transition hover:text-cyan-700"
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {isOpen && filteredSuggestions.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-full overflow-hidden rounded-md border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-950/10"
        >
          {filteredSuggestions.map((tag, index) => (
            <button
              type="button"
              key={tag.id}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseSuggestion(tag.name)}
              className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs transition ${
                activeIndex === index
                  ? "bg-cyan-50 text-cyan-900"
                  : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <TagIcon className="h-3.5 w-3.5 shrink-0 text-cyan-700" />
              <span className="truncate">{tag.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TagRemovalSelector({
  ariaLabel,
  className = "",
  onChange,
  options,
  placeholder,
  totalCount,
  value,
}: TagRemovalSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selectedOption = options.find((tag) => tag.id === value);

  function chooseOption(id: string) {
    onChange(id);
    setActiveIndex(-1);
    setIsOpen(false);
  }

  function closeWhenFocusLeaves() {
    window.setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setActiveIndex(-1);
        setIsOpen(false);
      }
    }, 0);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setActiveIndex(-1);
          setIsOpen((current) => !current);
        }}
        onBlur={closeWhenFocusLeaves}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && options.length > 0) {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => (current + 1) % options.length);
            return;
          }

          if (event.key === "ArrowUp" && options.length > 0) {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => (current <= 0 ? options.length - 1 : current - 1));
            return;
          }

          if (event.key === "Escape") {
            setActiveIndex(-1);
            setIsOpen(false);
            return;
          }

          if (event.key === "Enter" && isOpen && activeIndex >= 0) {
            event.preventDefault();
            chooseOption(options[activeIndex].id);
          }
        }}
        className={`flex h-full w-full items-center rounded-md border bg-white text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-100 ${
          isOpen ? "border-cyan-600 ring-2 ring-cyan-100" : "border-zinc-200 hover:border-cyan-300"
        }`}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
      >
        <TagIcon className="ml-2.5 h-3.5 w-3.5 shrink-0 text-cyan-700" />
        <span
          className={`min-w-0 flex-1 truncate px-2 ${
            selectedOption ? "text-zinc-700" : "text-zinc-400"
          }`}
        >
          {selectedOption
            ? `${selectedOption.name} (${selectedOption.count}/${totalCount})`
            : placeholder}
        </span>
        <ChevronDown
          className={`mr-2.5 h-3.5 w-3.5 shrink-0 text-zinc-400 transition ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && options.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-64 min-w-full overflow-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-950/10"
        >
          {options.map((tag, index) => (
            <button
              type="button"
              key={tag.id}
              role="option"
              aria-selected={tag.id === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(tag.id)}
              className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs transition ${
                activeIndex === index || tag.id === value
                  ? "bg-cyan-50 text-cyan-900"
                  : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <TagIcon className="h-3.5 w-3.5 shrink-0 text-cyan-700" />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="shrink-0 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-700">
                {tag.count}/{totalCount}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TagFilterSelector({
  ariaLabel,
  className = "",
  clearLabel,
  onClear,
  onToggle,
  options,
  selectedIds,
}: TagFilterSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selectedOptions = options.filter((tag) => selectedIds.has(tag.id));

  function toggleOption(id: string) {
    onToggle(id);
  }

  function closeWhenFocusLeaves() {
    window.setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setActiveIndex(-1);
        setIsOpen(false);
      }
    }, 0);
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" && options.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp" && options.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current <= 0 ? options.length - 1 : current - 1));
      return;
    }

    if (event.key === "Escape") {
      setActiveIndex(-1);
      setIsOpen(false);
      return;
    }

    if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      event.preventDefault();
      toggleOption(options[activeIndex].id);
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`flex h-full items-center rounded-md border bg-white transition focus-within:ring-2 focus-within:ring-cyan-100 ${
          isOpen ? "border-cyan-600 ring-2 ring-cyan-100" : "border-zinc-200 hover:border-cyan-300"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setActiveIndex(-1);
            setIsOpen((current) => !current);
          }}
          onBlur={closeWhenFocusLeaves}
          onKeyDown={handleTriggerKeyDown}
          className="flex h-full min-w-0 flex-1 items-center text-left outline-none"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
        >
          <TagIcon className="ml-2.5 h-3.5 w-3.5 shrink-0 text-cyan-700" />
          <span className={`min-w-0 flex-1 truncate px-2 ${selectedOptions.length > 0 ? "text-zinc-700" : "text-zinc-500"}`}>
            {selectedOptions.length === 1 ? selectedOptions[0].name : ariaLabel}
          </span>
          {selectedOptions.length > 0 ? (
            <span className="mr-1 shrink-0 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700">
              {selectedOptions.length}
            </span>
          ) : null}
        </button>
        {selectedOptions.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            onBlur={closeWhenFocusLeaves}
            className="grid h-full w-7 shrink-0 place-items-center text-zinc-400 transition hover:text-cyan-700"
            aria-label={clearLabel}
            title={clearLabel}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setActiveIndex(-1);
            setIsOpen((current) => !current);
          }}
          onBlur={closeWhenFocusLeaves}
          onKeyDown={handleTriggerKeyDown}
          className="grid h-full w-8 shrink-0 place-items-center text-zinc-400 transition hover:text-cyan-700"
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {isOpen && options.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-72 min-w-full w-60 overflow-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-950/10"
        >
          {options.map((tag, index) => {
            const isSelected = selectedIds.has(tag.id);

            return (
              <button
                type="button"
                key={tag.id}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleOption(tag.id)}
                className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs transition ${
                  activeIndex === index || isSelected
                    ? "bg-cyan-50 text-cyan-900"
                    : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <TagIcon className="h-3.5 w-3.5 shrink-0 text-cyan-700" />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                {isSelected ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-700" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function backupFileNameFromHeader(value: string | null) {
  const match = value?.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? `brooks-pa-atlas-backup-${new Date().toISOString().slice(0, 10)}.zip`;
}

function isSupportedDocumentFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function formatDocumentImportSummary(
  template: string,
  result: { imported: number; totalCount: number; failed: number; duplicate: number },
) {
  return template
    .replace("{imported}", String(result.imported))
    .replace("{total}", String(result.totalCount))
    .replace("{failed}", String(result.failed))
    .replace("{duplicate}", String(result.duplicate));
}

function backupJobPercent(job: Pick<BackupJobSnapshot, "processedImages" | "status" | "totalImages">) {
  if (job.status === "completed") {
    return 100;
  }

  if (job.totalImages <= 0) {
    return 0;
  }

  return Math.min(99, Math.round((job.processedImages / job.totalImages) * 100));
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

function detailDraftFromImage(image: ChartImage): ImageDetailDraft {
  return {
    title: image.title ?? "",
    notes: image.notes ?? "",
    ocrText: image.ocrText ?? "",
    indexNodeId: image.indexNode?.id ?? "",
    tagNames: image.tags.map((tag) => tag.name),
  };
}

function detailDraftFingerprint(draft: ImageDetailDraft) {
  return JSON.stringify({
    title: draft.title,
    notes: draft.notes,
    ocrText: draft.ocrText,
    indexNodeId: draft.indexNodeId,
    tagNames: draft.tagNames
      .map((name) => name.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
  });
}

function collapsibleIndexIds(node: IndexTreeNode) {
  const ids: string[] = [];
  const visit = (current: IndexTreeNode) => {
    if (current.children.length === 0) {
      return;
    }

    ids.push(current.id);
    current.children.forEach(visit);
  };
  visit(node);
  return ids;
}

function persistCollapsedIndexIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(collapsedIndexesStorageKey, JSON.stringify([...ids]));
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function measureScrollbarThickness() {
  if (cachedScrollbarThickness !== null) {
    return cachedScrollbarThickness;
  }

  if (typeof document === "undefined" || !document.body) {
    return 0;
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.top = "-9999px";
  probe.style.width = "100px";
  probe.style.height = "100px";
  probe.style.overflow = "scroll";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  cachedScrollbarThickness = Math.max(0, probe.offsetWidth - probe.clientWidth);
  probe.remove();

  return cachedScrollbarThickness;
}

function cssPixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function measureStableViewerViewport(viewport: HTMLDivElement) {
  const rect = viewport.getBoundingClientRect();
  const styles = window.getComputedStyle(viewport);
  const borderX = cssPixelValue(styles.borderLeftWidth) + cssPixelValue(styles.borderRightWidth);
  const borderY = cssPixelValue(styles.borderTopWidth) + cssPixelValue(styles.borderBottomWidth);
  const scrollbarThickness = measureScrollbarThickness();
  const stableWidth = rect.width - borderX - scrollbarThickness;
  const stableHeight = rect.height - borderY - scrollbarThickness;

  return {
    width: Number.isFinite(stableWidth)
      ? Math.max(1, Math.floor(stableWidth))
      : Math.max(1, viewport.clientWidth || 1),
    height: Number.isFinite(stableHeight)
      ? Math.max(1, Math.floor(stableHeight))
      : Math.max(1, viewport.clientHeight || 1),
  };
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

function clampAnnotationX(x: number, width: number) {
  return Math.min(Math.max(0, 1 - width), Math.max(0, x));
}

function clampAnnotationY(y: number, height: number) {
  return Math.min(Math.max(0, 1 - height), Math.max(0, y));
}

function clampAnnotationWidth(value: number) {
  return Math.min(1, Math.max(0.08, Number.isFinite(value) ? value : 0.24));
}

function clampAnnotationHeight(value: number) {
  return Math.min(1, Math.max(0.04, Number.isFinite(value) ? value : 0.12));
}

function clampAnnotationFontSize(value: number) {
  return Math.min(48, Math.max(10, Math.round(Number.isFinite(value) ? value : 18)));
}

function cleanAnnotations(annotations: ImageAnnotation[]) {
  return annotations
    .map((annotation, index) => {
      const width = clampAnnotationWidth(annotation.width);
      const height = clampAnnotationHeight(annotation.height);

      return {
        ...annotation,
        text: annotation.text.trim(),
        x: clampAnnotationX(annotation.x, width),
        y: clampAnnotationY(annotation.y, height),
        width,
        height,
        fontSize: clampAnnotationFontSize(annotation.fontSize),
        color: annotation.color,
        backgroundColor: null,
        sortOrder: index,
      };
    })
    .filter((annotation) => annotation.text.length > 0);
}

function annotationFingerprint(annotations: ImageAnnotation[]) {
  return JSON.stringify(
    cleanAnnotations(annotations).map((annotation) => ({
      id: annotation.id.startsWith("local-") ? null : annotation.id,
      text: annotation.text,
      x: Number(annotation.x.toFixed(5)),
      y: Number(annotation.y.toFixed(5)),
      width: Number(annotation.width.toFixed(5)),
      height: Number(annotation.height.toFixed(5)),
      fontSize: annotation.fontSize,
      color: annotation.color,
      backgroundColor: null,
    })),
  );
}

function localAnnotationId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resizeAnnotationBox(
  handle: AnnotationResizeHandle,
  start: { x: number; y: number; width: number; height: number },
  deltaX: number,
  deltaY: number,
) {
  const minWidth = 0.08;
  const minHeight = 0.04;
  let nextX = start.x;
  let nextY = start.y;
  let nextWidth = start.width;
  let nextHeight = start.height;

  if (handle.includes("e")) {
    nextWidth = Math.min(1 - start.x, Math.max(minWidth, start.width + deltaX));
  }

  if (handle.includes("s")) {
    nextHeight = Math.min(1 - start.y, Math.max(minHeight, start.height + deltaY));
  }

  if (handle.includes("w")) {
    const right = start.x + start.width;
    nextX = Math.min(right - minWidth, Math.max(0, start.x + deltaX));
    nextWidth = right - nextX;
  }

  if (handle.includes("n")) {
    const bottom = start.y + start.height;
    nextY = Math.min(bottom - minHeight, Math.max(0, start.y + deltaY));
    nextHeight = bottom - nextY;
  }

  return {
    x: clampAnnotationX(nextX, nextWidth),
    y: clampAnnotationY(nextY, nextHeight),
    width: clampAnnotationWidth(nextWidth),
    height: clampAnnotationHeight(nextHeight),
  };
}

function parseCollapsedIndexIds(value: string | null) {
  if (!value) {
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set<string>();
  }
}

function IndexBranch({
  nodes,
  selectedId,
  collapsedIds,
  allowReorder,
  draggedNodeId,
  dropIndicator,
  reorderTitle,
  onSelect,
  onToggleExpanded,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  nodes: IndexTreeNode[];
  selectedId: string | null;
  collapsedIds: Set<string>;
  allowReorder: boolean;
  draggedNodeId: string | null;
  dropIndicator: IndexDropIndicator | null;
  reorderTitle: string;
  onSelect: (id: string | null) => void;
  onToggleExpanded: (id: string) => void;
  onContextMenu?: (node: IndexTreeNode, event: React.MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (node: IndexTreeNode, event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver: (
    node: IndexTreeNode,
    siblings: IndexTreeNode[],
    position: IndexDropPosition,
    event: React.DragEvent<HTMLButtonElement>,
  ) => void;
  onDrop: (
    node: IndexTreeNode,
    siblings: IndexTreeNode[],
    position: IndexDropPosition,
    event: React.DragEvent<HTMLButtonElement>,
  ) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsedIds.has(node.id);
        const isDragging = draggedNodeId === node.id;
        const isDropTarget = dropIndicator?.id === node.id;
        const dropLineTop = dropIndicator?.position === "before" ? 0 : undefined;
        const dropLineBottom = dropIndicator?.position === "after" ? 0 : undefined;

        return (
          <div key={node.id} className="relative">
            {isDropTarget ? (
              <span
                className="pointer-events-none absolute right-2 z-10 h-0.5 rounded-full bg-cyan-600"
                style={{
                  left: 8 + node.depth * 12,
                  top: dropLineTop,
                  bottom: dropLineBottom,
                }}
              />
            ) : null}
            <button
              type="button"
              draggable={allowReorder}
              onDragStart={(event) => {
                if (!allowReorder) {
                  return;
                }

                onDragStart(node, event);
              }}
              onDragOver={(event) => {
                if (!allowReorder || !draggedNodeId || draggedNodeId === node.id) {
                  return;
                }

                const rect = event.currentTarget.getBoundingClientRect();
                const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
                onDragOver(node, nodes, position, event);
              }}
              onDrop={(event) => {
                if (!allowReorder || !draggedNodeId || draggedNodeId === node.id) {
                  return;
                }

                const rect = event.currentTarget.getBoundingClientRect();
                const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
                onDrop(node, nodes, position, event);
              }}
              onDragEnd={allowReorder ? onDragEnd : undefined}
              onClick={() => onSelect(node.id)}
              onContextMenu={(event) => onContextMenu?.(node, event)}
              className={`grid h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition ${
                selectedId === node.id
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              } ${allowReorder ? "grid-cols-[16px_14px_1fr_auto] cursor-grab active:cursor-grabbing" : "grid-cols-[16px_1fr_auto]"} ${
                isDragging ? "opacity-45" : ""
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
              {allowReorder ? (
                <span className="grid h-5 w-3.5 place-items-center" title={reorderTitle}>
                  <GripVertical
                    className="h-3.5 w-3.5 text-current opacity-45"
                    aria-hidden="true"
                  />
                </span>
              ) : null}
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
                allowReorder={allowReorder}
                draggedNodeId={draggedNodeId}
                dropIndicator={dropIndicator}
                reorderTitle={reorderTitle}
                onSelect={onSelect}
                onToggleExpanded={onToggleExpanded}
                onContextMenu={onContextMenu}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
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
  labels: {
    browse: string;
    manage: string;
    exam: string;
    browseMode: string;
    manageMode: string;
    examMode: string;
  };
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="grid h-9 grid-cols-3 rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
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
      <button
        type="button"
        onClick={() => onChange("exam")}
        className={`inline-flex items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition ${
          mode === "exam" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-white"
        }`}
        title={labels.examMode}
      >
        <ClipboardList className="h-3.5 w-3.5" />
        <span>{labels.exam}</span>
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
  const [importOcrEnabled, setImportOcrEnabled] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documentImporting, setDocumentImporting] = useState(false);
  const [documentImportJob, setDocumentImportJob] = useState<DocumentImportJobSnapshot | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupTask, setBackupTask] = useState<BackupJobSnapshot | null>(null);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [newIndexName, setNewIndexName] = useState("");
  const [detailDraft, setDetailDraft] = useState({
    title: "",
    notes: "",
    ocrText: "",
    indexNodeId: "",
    tagNames: [] as string[],
  });
  const [detailTagInput, setDetailTagInput] = useState("");
  const [ocrRunningImageId, setOcrRunningImageId] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(() => new Set());
  const [selectedBulkImageIds, setSelectedBulkImageIds] = useState<Set<string>>(() => new Set());
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkRemoveTagId, setBulkRemoveTagId] = useState("");
  const [bulkTagsBusy, setBulkTagsBusy] = useState(false);
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
  const [noticeDialog, setNoticeDialog] = useState<NoticeDialog | null>(null);
  const [indexContextMenu, setIndexContextMenu] = useState<IndexContextMenu | null>(null);
  const [indexAction, setIndexAction] = useState<IndexAction | null>(null);
  const [indexActionBusy, setIndexActionBusy] = useState(false);
  const [renameIndexName, setRenameIndexName] = useState("");
  const [clearIndexConfirmText, setClearIndexConfirmText] = useState("");
  const [isIndexReorderEnabled, setIsIndexReorderEnabled] = useState(false);
  const [draggedIndexNodeId, setDraggedIndexNodeId] = useState<string | null>(null);
  const [indexDropIndicator, setIndexDropIndicator] = useState<IndexDropIndicator | null>(null);
  const [reorderingIndex, setReorderingIndex] = useState(false);
  const [imageViewerHeight, setImageViewerHeight] = useState(720);
  const [isResizingViewer, setIsResizingViewer] = useState(false);
  const [isManageViewerOpen, setIsManageViewerOpen] = useState(false);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [showBrowseThumbnails, setShowBrowseThumbnails] = useState(true);
  const [showBrowseAnnotations, setShowBrowseAnnotations] = useState(true);
  const [showBrowseNotes, setShowBrowseNotes] = useState(true);
  const [isEditingAnnotations, setIsEditingAnnotations] = useState(false);
  const [annotationDrafts, setAnnotationDrafts] = useState<ImageAnnotation[]>([]);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [draggingAnnotation, setDraggingAnnotation] = useState<{
    id: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    width: number;
    stageWidth: number;
    stageHeight: number;
  } | null>(null);
  const [resizingAnnotation, setResizingAnnotation] = useState<{
    id: string;
    handle: AnnotationResizeHandle;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    stageWidth: number;
    stageHeight: number;
  } | null>(null);
  const [annotationsSaving, setAnnotationsSaving] = useState(false);
  const [annotationSaveFailed, setAnnotationSaveFailed] = useState(false);
  const [viewerViewportSize, setViewerViewportSize] = useState({ width: 0, height: 0 });
  const importTableResizeStartRef = useRef({ height: importTableHeight, y: 0 });
  const importTableHeightRef = useRef(importTableHeight);
  const viewerResizeStartRef = useRef({ height: imageViewerHeight, y: 0 });
  const viewerHeightRef = useRef(imageViewerHeight);
  const selectedImageIdRef = useRef<string | null>(null);
  const annotationDraftsRef = useRef<ImageAnnotation[]>([]);
  const annotationSaveImageIdRef = useRef<string | null>(null);
  const editingAnnotationIdRef = useRef<string | null>(null);
  const annotationDirtyRef = useRef(false);
  const annotationSaveTimerRef = useRef<number | null>(null);
  const annotationStageRef = useRef<HTMLDivElement | null>(null);
  const viewerViewportRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const manageGridScrollTopRef = useRef(0);
  const detailsSavingRef = useRef(false);
  const detailDraftRef = useRef<ImageDetailDraft>(detailDraft);
  const detailTagInputRef = useRef(detailTagInput);
  const imageSelectionPromiseRef = useRef<Promise<boolean> | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const t = copy[locale];
  const isBrowseMode = viewMode === "browse";
  const isExamMode = viewMode === "exam";
  const isManageMode = viewMode === "manage";
  const isLargeViewerActive = isBrowseMode || (isManageMode && isManageViewerOpen);
  const canReorderIndexes = isManageMode && isIndexReorderEnabled && !reorderingIndex;
  const documentImportButtonLabel =
    documentImporting && documentImportJob?.totalPages
      ? `${documentImportJob.processedPages}/${documentImportJob.totalPages}`
      : documentImporting
        ? t.importingDocuments
        : t.importDocuments;
  const backupTaskPercent = backupTask ? backupJobPercent(backupTask) : 0;
  const backupTaskTitle = backupTask?.kind === "restore" ? t.restoreTaskTitle : t.backupTaskTitle;
  const backupTaskPhase = (() => {
    if (!backupTask) {
      return "";
    }

    if (backupTask.status === "completed") {
      return t.taskCompleted;
    }

    if (backupTask.status === "failed") {
      return t.taskFailed;
    }

    switch (backupTask.phase) {
      case "collecting-images":
        return t.taskCollectingImages;
      case "packing":
        return t.taskPacking;
      case "uploading":
        return t.taskUploading;
      case "restoring-indexes":
        return t.taskRestoringIndexes;
      case "restoring-images":
        return t.taskRestoringImages;
      case "downloading":
        return t.taskDownloading;
      default:
        return t.taskPreparing;
    }
  })();

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (selectedIndexId) {
      params.set("indexId", selectedIndexId);
    }
    for (const tagId of selectedTagIds) {
      params.append("tagId", tagId);
    }

    try {
      const response = await fetch(`/api/atlas?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`GET /api/atlas ${response.status}`);
      }

      const nextData = (await response.json()) as AtlasData;
      setData(nextData);
      const availableTagIds = new Set(nextData.tags.map((tag) => tag.id));
      if ([...selectedTagIds].some((tagId) => !availableTagIds.has(tagId))) {
        setSelectedTagIds(new Set([...selectedTagIds].filter((tagId) => availableTagIds.has(tagId))));
      }
      setDataError(null);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    }
  }, [query, selectedIndexId, selectedTagIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setLocale(window.localStorage.getItem("brooks-pa-atlas.locale") === "en" ? "en" : "zh");
        setIsSidebarCollapsed(window.localStorage.getItem("brooks-pa-atlas.sidebar") === "collapsed");
        setIsOverviewCollapsed(window.localStorage.getItem("brooks-pa-atlas.overview") === "collapsed");
        const savedViewMode = window.localStorage.getItem("brooks-pa-atlas.viewMode");
        setViewMode(savedViewMode === "browse" || savedViewMode === "exam" ? savedViewMode : "manage");
        setShowBrowseThumbnails(window.localStorage.getItem("brooks-pa-atlas.browseThumbnails") !== "hidden");
        setShowBrowseAnnotations(window.localStorage.getItem("brooks-pa-atlas.browseAnnotations") !== "hidden");
        setShowBrowseNotes(window.localStorage.getItem("brooks-pa-atlas.browseNotes") !== "hidden");
        setCollapsedIndexIds(parseCollapsedIndexIds(window.localStorage.getItem(collapsedIndexesStorageKey)));

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
    selectedImageIdRef.current = selectedImageId;
  }, [selectedImageId]);

  useEffect(() => {
    editingAnnotationIdRef.current = editingAnnotationId;
  }, [editingAnnotationId]);

  useEffect(() => {
    detailDraftRef.current = detailDraft;
  }, [detailDraft]);

  useEffect(() => {
    detailTagInputRef.current = detailTagInput;
  }, [detailTagInput]);

  useEffect(() => {
    const viewport = viewerViewportRef.current;
    if (!viewport) {
      return;
    }

    let animationFrame = 0;
    const updateSize = () => {
      const nextSize = measureStableViewerViewport(viewport);
      setViewerViewportSize((current) => {
        if (current.width === nextSize.width && current.height === nextSize.height) {
          return current;
        }
        return nextSize;
      });
    };
    const scheduleUpdateSize = () => {
      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        updateSize();
      });
    };
    updateSize();

    const observer = new ResizeObserver(scheduleUpdateSize);
    observer.observe(viewport);
    window.addEventListener("resize", scheduleUpdateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdateSize);
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [isLargeViewerActive, selectedImageId]);

  useEffect(() => {
    if (!draggingAnnotation) {
      return;
    }

    const drag = draggingAnnotation;
    function handlePointerMove(event: PointerEvent) {
      updateAnnotationDrafts(
        (annotations) =>
          annotations.map((annotation) => {
            if (annotation.id !== drag.id) {
              return annotation;
            }

            const nextX = drag.startX + (event.clientX - drag.startClientX) / drag.stageWidth;
            const nextY = drag.startY + (event.clientY - drag.startClientY) / drag.stageHeight;
            return {
              ...annotation,
              x: clampAnnotationX(nextX, drag.width),
              y: clampAnnotationY(nextY, annotation.height),
            };
          }),
        { save: false },
      );
    }

    function handlePointerUp() {
      setDraggingAnnotation(null);
      markAnnotationsDirty(annotationDraftsRef.current);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // Dragging intentionally captures the pointer-start snapshot for this gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingAnnotation]);

  useEffect(() => {
    if (!resizingAnnotation) {
      return;
    }

    const resize = resizingAnnotation;
    function handlePointerMove(event: PointerEvent) {
      const deltaX = (event.clientX - resize.startClientX) / resize.stageWidth;
      const deltaY = (event.clientY - resize.startClientY) / resize.stageHeight;
      const nextBox = resizeAnnotationBox(
        resize.handle,
        {
          x: resize.startX,
          y: resize.startY,
          width: resize.startWidth,
          height: resize.startHeight,
        },
        deltaX,
        deltaY,
      );

      updateAnnotationDrafts(
        (annotations) =>
          annotations.map((annotation) =>
            annotation.id === resize.id
              ? {
                  ...annotation,
                  ...nextBox,
                }
              : annotation,
          ),
        { save: false },
      );
    }

    function handlePointerUp() {
      setResizingAnnotation(null);
      markAnnotationsDirty(annotationDraftsRef.current);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // Resizing intentionally captures the pointer-start snapshot for this gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizingAnnotation]);

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
      if (!Number.isFinite(nextHeight) || nextHeight === viewerHeightRef.current) {
        return;
      }
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
      if (!Number.isFinite(nextHeight) || nextHeight === importTableHeightRef.current) {
        return;
      }
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
  useEffect(() => {
    if (isManageViewerOpen && !selectedImage) {
      setIsManageViewerOpen(false);
      setIsEditingAnnotations(false);
      setEditingAnnotationId(null);
    }
  }, [isManageViewerOpen, selectedImage]);
  const selectedBulkTagStats = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();

    for (const image of data?.images ?? []) {
      if (!selectedBulkImageIds.has(image.id)) {
        continue;
      }

      for (const tag of image.tags) {
        const current = counts.get(tag.id);
        counts.set(tag.id, { ...tag, count: (current?.count ?? 0) + 1 });
      }
    }

    return [...counts.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [data?.images, selectedBulkImageIds]);
  const selectedAnnotation =
    annotationDrafts.find((annotation) => annotation.id === editingAnnotationId) ?? null;
  const pendingUndoBatch = data?.batches.find((batch) => batch.id === pendingUndoBatchId) ?? null;
  const indexContextImageCount = indexContextMenu
    ? indexBranchImageCount(indexContextMenu.node)
    : 0;
  const indexActionImageCount = indexAction ? indexBranchImageCount(indexAction.node) : 0;
  const canNavigateSelectedImage = (data?.images.length ?? 0) > 1;
  const shouldShowImageGrid =
    (isManageMode && !isManageViewerOpen) ||
    (isBrowseMode && (showBrowseThumbnails || !selectedImage));
  const isSelectedImageOcrBusy = selectedImage
    ? selectedImage.ocrStatus === "RUNNING" || ocrRunningImageId === selectedImage.id
    : false;
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
        selectedImage.tags.length > 0 ? `${t.tags}: ${selectedImage.tags.map((tag) => tag.name).join(", ")}` : null,
        selectedImage.notes ? `${t.notes}: ${selectedImage.notes}` : null,
        selectedImage.ocrError ? `${t.ocrFailedShort}: ${selectedImage.ocrError}` : null,
        selectedImage.ocrText ? `OCR: ${selectedImage.ocrText}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const layoutClass = isBrowseMode || isExamMode
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
  const imageStageSize = useMemo(() => {
    if (
      !selectedImage?.width ||
      !selectedImage?.height ||
      !Number.isFinite(viewerViewportSize.width) ||
      !Number.isFinite(viewerViewportSize.height) ||
      viewerViewportSize.width <= 0 ||
      viewerViewportSize.height <= 0
    ) {
      return null;
    }

    const fitWidth = Math.max(1, viewerViewportSize.width - viewerFitSafetyPx);
    const fitHeight = Math.max(1, viewerViewportSize.height - viewerFitSafetyPx);
    const fitScale = Math.min(fitWidth / selectedImage.width, fitHeight / selectedImage.height);
    const scale = fitScale * (imageZoom / 100);
    const width = Math.round(selectedImage.width * scale);
    const height = Math.round(selectedImage.height * scale);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }

    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
    };
  }, [imageZoom, selectedImage?.height, selectedImage?.width, viewerViewportSize.height, viewerViewportSize.width]);

  useEffect(() => {
    const images = data?.images ?? [];
    if (!isLargeViewerActive || images.length < 2) {
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
      if (
        isEditing ||
        detailsSavingRef.current ||
        annotationsSaving ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const currentIndex = selectedImageIndex >= 0 ? selectedImageIndex : 0;
      const nextImage = images[(currentIndex + direction + images.length) % images.length];
      void selectImage(nextImage);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // Keyboard navigation should use the current image list and selected index only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsSaving, data?.images, isLargeViewerActive, selectedImageIndex]);

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
        formData.set("ocrEnabled", importOcrEnabled ? "true" : "false");
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

  async function readDocumentImportJobResponse(response: Response) {
    const result = (await response.json().catch(() => null)) as
      | { error?: string; job?: DocumentImportJobSnapshot }
      | null;

    if (!response.ok || !result?.job) {
      throw new Error(result?.error ?? "Document import failed.");
    }

    return result.job;
  }

  async function pollDocumentImportJob(jobId: string) {
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      const response = await fetch(`/api/import/documents/jobs/${jobId}`, { cache: "no-store" });
      const job = await readDocumentImportJobResponse(response);
      setDocumentImportJob(job);

      if (job.status !== "running") {
        return job;
      }
    }
  }

  async function uploadDocument(file: File | null) {
    if (!file) {
      return;
    }

    if (!isSupportedDocumentFile(file)) {
      window.alert(t.noSupportedDocuments);
      return;
    }

    setDocumentImporting(true);
    setDocumentImportJob(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("baseIndexPath", JSON.stringify(indexPathParts(selectedIndexPath)));
      formData.set("ocrEnabled", importOcrEnabled ? "true" : "false");

      const started = await readDocumentImportJobResponse(await fetch("/api/import/documents/jobs", {
        method: "POST",
        body: formData,
        cache: "no-store",
      }));
      setDocumentImportJob(started);

      const result = await pollDocumentImportJob(started.id);
      if (result.status !== "completed") {
        throw new Error(result.error ?? "Document import failed.");
      }

      if (typeof result.failed === "number" && result.failed > 0) {
        window.alert(
          `${t.documentImportCompletedWithErrors}\n${formatDocumentImportSummary(
            t.documentImportSummary,
            {
              imported: result.imported,
              totalCount: result.totalPages,
              failed: result.failed,
              duplicate: result.duplicate,
            },
          )}`,
        );
      }

      await refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Document import failed.");
    } finally {
      setDocumentImporting(false);
      setDocumentImportJob(null);
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
    if (!isManageMode) {
      return;
    }

    event.preventDefault();
    setSelectedIndexId(node.id);
    setSelectedBulkImageIds(new Set());
    setIndexContextMenu({ node, x: event.clientX, y: event.clientY });
  }

  function startIndexDrag(node: IndexTreeNode, event: React.DragEvent<HTMLButtonElement>) {
    if (!canReorderIndexes) {
      event.preventDefault();
      return;
    }

    setIndexContextMenu(null);
    setDraggedIndexNodeId(node.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.id);
  }

  function updateIndexDropTarget(
    node: IndexTreeNode,
    siblings: IndexTreeNode[],
    position: IndexDropPosition,
    event: React.DragEvent<HTMLButtonElement>,
  ) {
    if (!draggedIndexNodeId || draggedIndexNodeId === node.id) {
      setIndexDropIndicator(null);
      return;
    }

    if (!siblings.some((sibling) => sibling.id === draggedIndexNodeId)) {
      setIndexDropIndicator(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIndexDropIndicator({ id: node.id, position });
  }

  async function dropIndexNode(
    node: IndexTreeNode,
    siblings: IndexTreeNode[],
    position: IndexDropPosition,
    event: React.DragEvent<HTMLButtonElement>,
  ) {
    const sourceId = draggedIndexNodeId;
    setDraggedIndexNodeId(null);
    setIndexDropIndicator(null);

    if (!sourceId || sourceId === node.id || !siblings.some((sibling) => sibling.id === sourceId)) {
      return;
    }

    event.preventDefault();
    const currentIds = siblings.map((sibling) => sibling.id);
    const withoutSource = currentIds.filter((id) => id !== sourceId);
    const targetIndex = withoutSource.indexOf(node.id);

    if (targetIndex < 0) {
      return;
    }

    const nextIds = [...withoutSource];
    nextIds.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, sourceId);

    if (nextIds.every((id, index) => id === currentIds[index])) {
      return;
    }

    const parentId = node.parentId;
    setReorderingIndex(true);
    setData((current) =>
      current ? { ...current, tree: applyIndexSiblingOrder(current.tree, parentId, nextIds) } : current,
    );

    try {
      const response = await fetch("/api/index-nodes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId, orderedIds: nextIds }),
      });

      if (!response.ok) {
        window.alert(t.reorderIndexFailed);
      }

      await refresh();
    } catch {
      window.alert(t.reorderIndexFailed);
      await refresh();
    } finally {
      setReorderingIndex(false);
    }
  }

  function clearIndexDragState() {
    setDraggedIndexNodeId(null);
    setIndexDropIndicator(null);
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
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        closeIndexAction(true);
        setNoticeDialog({
          title: t.indexActionFailedTitle,
          message: result?.error ?? t.indexActionFailed,
          tone: response.status === 409 ? "warning" : "error",
        });
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
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        closeIndexAction(true);
        setNoticeDialog({
          title: t.indexActionFailedTitle,
          message: result?.error ?? t.indexActionFailed,
          tone: response.status === 409 ? "warning" : "error",
        });
        return;
      }

      if (selectedIndexId === indexAction.node.id) {
        setSelectedIndexId(null);
        setSelectedBulkImageIds(new Set());
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
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        closeIndexAction(true);
        setNoticeDialog({
          title:
            response.status === 409 ? t.clearIndexImagesBlockedTitle : t.clearIndexImagesFailedTitle,
          message: response.status === 409 ? t.clearIndexImagesBlockedByExam : result?.error ?? t.indexActionFailed,
          tone: response.status === 409 ? "warning" : "error",
        });
        return;
      }

      setSelectedImageId(null);
      setIsManageViewerOpen(false);
      closeIndexAction(true);
      await refresh();
    } finally {
      setIndexActionBusy(false);
    }
  }

  async function saveImageDetails(image: ChartImage) {
    const currentDraft = detailDraftRef.current;
    const nextDraft: ImageDetailDraft = {
      ...currentDraft,
      tagNames: addTagName(currentDraft.tagNames, detailTagInputRef.current),
    };

    if (detailDraftFingerprint(nextDraft) === detailDraftFingerprint(detailDraftFromImage(image))) {
      return true;
    }

    if (detailsSavingRef.current) {
      return false;
    }

    detailsSavingRef.current = true;
    setDetailsSaving(true);

    try {
      const response = await fetch(`/api/images/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextDraft),
      });
      const result = (await response.json().catch(() => null)) as
        | { image?: ChartImage; error?: string }
        | null;

      if (!response.ok || !result?.image) {
        throw new Error(result?.error ?? t.detailsSaveFailed);
      }

      setData((current) => {
        if (!current) {
          return current;
        }

        const tagsById = new Map(current.tags.map((tag) => [tag.id, tag]));
        result.image!.tags.forEach((tag) => tagsById.set(tag.id, tag));

        return {
          ...current,
          images: current.images.map((item) => (item.id === image.id ? result.image! : item)),
          tags: [...tagsById.values()].sort((left, right) => left.name.localeCompare(right.name)),
        };
      });

      if (selectedImageIdRef.current === image.id) {
        const savedDraft = detailDraftFromImage(result.image);
        detailDraftRef.current = savedDraft;
        detailTagInputRef.current = "";
        setDetailDraft(savedDraft);
        setDetailTagInput("");
      }

      return true;
    } catch (error) {
      setNoticeDialog({
        title: t.detailsSaveFailedTitle,
        message: error instanceof Error ? error.message : t.detailsSaveFailed,
        tone: "error",
      });
      return false;
    } finally {
      detailsSavingRef.current = false;
      setDetailsSaving(false);
    }
  }

  async function saveDetails() {
    if (!selectedImage || !(await saveImageDetails(selectedImage))) {
      return;
    }

    await refresh();
  }

  function addDetailTag() {
    setDetailDraft((draft) => ({
      ...draft,
      tagNames: addTagName(draft.tagNames, detailTagInput),
    }));
    setDetailTagInput("");
  }

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }

      return next;
    });
    setImageGridPage(1);
    setSelectedBulkImageIds(new Set());
  }

  function clearTagFilter() {
    setSelectedTagIds(new Set());
    setImageGridPage(1);
    setSelectedBulkImageIds(new Set());
  }

  function toggleBulkImage(imageId: string) {
    setSelectedBulkImageIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }

      return next;
    });
  }

  async function updateBulkTags(options: { addTagNames?: string[]; removeTagIds?: string[] }) {
    if (selectedBulkImageIds.size === 0) {
      return;
    }

    setBulkTagsBusy(true);
    try {
      const response = await fetch("/api/images/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageIds: [...selectedBulkImageIds],
          addTagNames: options.addTagNames ?? [],
          removeTagIds: options.removeTagIds ?? [],
        }),
      });

      if (!response.ok) {
        window.alert(t.bulkTagUpdateFailed);
        return;
      }

      setBulkTagInput("");
      setBulkRemoveTagId("");
      setSelectedBulkImageIds(new Set());
      await refresh();
    } finally {
      setBulkTagsBusy(false);
    }
  }

  function addBulkTag() {
    if (!bulkTagInput.trim()) {
      return;
    }

    void updateBulkTags({ addTagNames: [bulkTagInput] });
  }

  function removeBulkTag() {
    if (!bulkRemoveTagId) {
      return;
    }

    void updateBulkTags({ removeTagIds: [bulkRemoveTagId] });
  }

  async function retryOcr() {
    if (!selectedImage || selectedImage.ocrStatus === "RUNNING") {
      return;
    }

    if (detailDraft.ocrText.trim() && !window.confirm(t.ocrOverwriteConfirm)) {
      return;
    }

    setOcrRunningImageId(selectedImage.id);
    try {
      const response = await fetch(`/api/ocr/images/${selectedImage.id}`, {
        method: "POST",
      });

      if (!response.ok) {
        window.alert(t.ocrUpdateFailed);
        return;
      }

      await refresh();
    } finally {
      setOcrRunningImageId(null);
    }
  }

  async function readBackupJobResponse(response: Response) {
    const result = (await response.json().catch(() => null)) as
      | { error?: string; job?: BackupJobSnapshot }
      | null;

    if (!response.ok || !result?.job) {
      throw new Error(result?.error ?? t.backupFailed);
    }

    return result.job;
  }

  async function pollBackupJob(kind: BackupJobSnapshot["kind"], jobId: string) {
    const pathKind = kind === "backup" ? "export" : "restore";

    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      const response = await fetch(`/api/backups/${pathKind}/jobs/${jobId}`, { cache: "no-store" });
      const job = await readBackupJobResponse(response);
      setBackupTask(job);

      if (job.status !== "running") {
        return job;
      }
    }
  }

  async function downloadBackup(indexNode?: IndexTreeNode) {
    setIndexContextMenu(null);
    setBackingUp(true);
    setBackupTask({
      id: "backup-starting",
      kind: "backup",
      status: "running",
      phase: "preparing",
      processedImages: 0,
      totalImages: indexNode ? indexBranchImageCount(indexNode) : data?.stats.imageCount ?? 0,
      error: null,
      fileName: null,
      stats: null,
    });

    try {
      const params = new URLSearchParams();
      if (indexNode) {
        params.set("indexId", indexNode.id);
      }
      const started = await readBackupJobResponse(
        await fetch(`/api/backups/export/jobs?${params.toString()}`, { method: "POST", cache: "no-store" }),
      );
      setBackupTask(started);

      const completed = await pollBackupJob("backup", started.id);
      if (completed.status !== "completed") {
        throw new Error(completed.error ?? t.backupFailed);
      }

      setBackupTask({ ...completed, phase: "downloading" });
      const response = await fetch(`/api/backups/export/jobs/${completed.id}/file`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(t.backupFailed);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = completed.fileName ?? backupFileNameFromHeader(response.headers.get("Content-Disposition"));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setBackupTask({ ...completed, phase: "completed" });
    } catch (error) {
      setBackupTask((current) => ({
        id: current?.id ?? "backup-failed",
        kind: "backup",
        status: "failed",
        phase: "failed",
        processedImages: current?.processedImages ?? 0,
        totalImages: current?.totalImages ?? data?.stats.imageCount ?? 0,
        error: error instanceof Error ? error.message : t.backupFailed,
        fileName: current?.fileName ?? null,
        stats: null,
      }));
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
        `试卷：恢复 ${stats.examPapersRestored ?? 0}，考试记录 ${stats.examAttemptsRestored ?? 0}`,
      ].join("\n");
    }

    return [
      "Restore complete.",
      `Indexes: ${stats.indexesCreated} created, ${stats.indexesUpdated} updated`,
      `Images: ${stats.imagesCreated} created, ${stats.imagesUpdated} updated`,
      `Files restored: ${stats.filesRestored}`,
      `Exams restored: ${stats.examPapersRestored ?? 0}, attempts ${stats.examAttemptsRestored ?? 0}`,
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
    setBackupTask({
      id: "restore-uploading",
      kind: "restore",
      status: "running",
      phase: "uploading",
      processedImages: 0,
      totalImages: 0,
      error: null,
      fileName: null,
      stats: null,
    });

    try {
      const started = await readBackupJobResponse(await fetch("/api/backups/restore/jobs", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/zip",
          "X-Backup-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      }));
      setBackupTask(started);

      const completed = await pollBackupJob("restore", started.id);
      if (completed.status !== "completed" || !completed.stats) {
        throw new Error(completed.error ?? t.restoreFailed);
      }

      setBackupTask({ ...completed, phase: "completed" });
      setSelectedImageId(null);
      setIsManageViewerOpen(false);
      await refresh();
    } catch (error) {
      setBackupTask((current) => ({
        id: current?.id ?? "restore-failed",
        kind: "restore",
        status: "failed",
        phase: "failed",
        processedImages: current?.processedImages ?? 0,
        totalImages: current?.totalImages ?? 0,
        error: error instanceof Error ? error.message : t.restoreFailed,
        fileName: null,
        stats: current?.stats ?? null,
      }));
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
      setIsManageViewerOpen(false);
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
        setPendingDeleteImage(null);
        setNoticeDialog({
          title: response.status === 409 ? t.deleteImageBlockedTitle : t.deleteImageFailedTitle,
          message: response.status === 409 ? t.deleteImageBlockedByExam : t.deleteImageFailed,
          tone: response.status === 409 ? "warning" : "error",
        });
        return;
      }

      setPendingDeleteImage(null);
      setSelectedImageId(null);
      setIsManageViewerOpen(false);
      await refresh();
    } finally {
      setDeletingImageId(null);
    }
  }

  function hydrateAnnotationDrafts(image: ChartImage) {
    const annotations = [...(image.annotations ?? [])]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((annotation) => ({
        ...annotation,
        width: clampAnnotationWidth(annotation.width),
        height: clampAnnotationHeight(annotation.height),
        x: clampAnnotationX(annotation.x, clampAnnotationWidth(annotation.width)),
        y: clampAnnotationY(annotation.y, clampAnnotationHeight(annotation.height)),
      }));
    annotationDraftsRef.current = annotations;
    annotationSaveImageIdRef.current = image.id;
    annotationDirtyRef.current = false;
    setAnnotationDrafts(annotations);
    setEditingAnnotationId(null);
    editingAnnotationIdRef.current = null;
    setDraggingAnnotation(null);
    setResizingAnnotation(null);
    setAnnotationSaveFailed(false);
  }

  function markAnnotationsDirty(nextAnnotations: ImageAnnotation[]) {
    annotationDirtyRef.current = true;
    setAnnotationSaveFailed(false);

    if (annotationSaveTimerRef.current) {
      window.clearTimeout(annotationSaveTimerRef.current);
    }

    const imageId = annotationSaveImageIdRef.current;
    annotationSaveTimerRef.current = window.setTimeout(() => {
      void saveAnnotationsNow(imageId, nextAnnotations);
    }, 600);
  }

  function updateAnnotationDrafts(
    updater: (annotations: ImageAnnotation[]) => ImageAnnotation[],
    options: { save: boolean } = { save: true },
  ) {
    setAnnotationDrafts((current) => {
      const nextAnnotations = updater(current).map((annotation, index) => ({
        ...annotation,
        sortOrder: index,
      }));
      annotationDraftsRef.current = nextAnnotations;

      if (options.save) {
        markAnnotationsDirty(nextAnnotations);
      }

      return nextAnnotations;
    });
  }

  async function saveAnnotationsNow(
    imageId = annotationSaveImageIdRef.current,
    annotations = annotationDraftsRef.current,
  ) {
    if (!imageId || !annotationDirtyRef.current) {
      return true;
    }

    if (annotationSaveTimerRef.current) {
      window.clearTimeout(annotationSaveTimerRef.current);
      annotationSaveTimerRef.current = null;
    }

    const cleanedAnnotations = cleanAnnotations(annotations);
    const savedFingerprint = annotationFingerprint(cleanedAnnotations);
    const editingIdBeforeSave = editingAnnotationIdRef.current;
    const editingIndexBeforeSave = editingIdBeforeSave
      ? cleanedAnnotations.findIndex((annotation) => annotation.id === editingIdBeforeSave)
      : -1;
    setAnnotationsSaving(true);

    try {
      const response = await fetch(`/api/images/${imageId}/annotations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: cleanedAnnotations }),
      });
      const result = (await response.json().catch(() => null)) as
        | { annotations?: ImageAnnotation[]; error?: string }
        | null;

      if (!response.ok || !result?.annotations) {
        throw new Error(result?.error ?? t.annotationsSaveFailed);
      }

      setData((current) =>
        current
          ? {
              ...current,
              images: current.images.map((image) =>
                image.id === imageId ? { ...image, annotations: result.annotations! } : image,
              ),
            }
          : current,
      );

      if (annotationSaveImageIdRef.current === imageId) {
        const currentFingerprint = annotationFingerprint(annotationDraftsRef.current);
        if (currentFingerprint === savedFingerprint) {
          annotationDraftsRef.current = result.annotations;
          annotationDirtyRef.current = false;
          setAnnotationDrafts(result.annotations);
          if (editingIndexBeforeSave >= 0) {
            const nextEditingId = result.annotations[editingIndexBeforeSave]?.id ?? null;
            editingAnnotationIdRef.current = nextEditingId;
            setEditingAnnotationId(nextEditingId);
          }
        } else {
          markAnnotationsDirty(annotationDraftsRef.current);
        }
      }
      return true;
    } catch {
      setAnnotationSaveFailed(true);
      return false;
    } finally {
      setAnnotationsSaving(false);
    }
  }

  function addAnnotationAt(event: React.PointerEvent<HTMLDivElement>) {
    if (!isEditingAnnotations || !imageStageSize || event.target !== event.currentTarget) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const width = 0.24;
    const height = 0.12;
    const x = clampAnnotationX((event.clientX - rect.left) / rect.width, width);
    const y = clampAnnotationY((event.clientY - rect.top) / rect.height, height);
    const annotation: ImageAnnotation = {
      id: localAnnotationId(),
      text: locale === "zh" ? "新标注" : "New note",
      x,
      y,
      width,
      height,
      fontSize: 18,
      color: "#111827",
      backgroundColor: null,
      sortOrder: annotationDraftsRef.current.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setEditingAnnotationId(annotation.id);
    updateAnnotationDrafts((annotations) => [...annotations, annotation]);
  }

  function startAnnotationDrag(annotation: ImageAnnotation, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const stage = annotationStageRef.current;
    if (!stage) {
      return;
    }

    setEditingAnnotationId(annotation.id);
    setDraggingAnnotation({
      id: annotation.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: annotation.x,
      startY: annotation.y,
      width: annotation.width,
      stageWidth: stage.clientWidth || 1,
      stageHeight: stage.clientHeight || 1,
    });
  }

  function startAnnotationResize(
    annotation: ImageAnnotation,
    handle: AnnotationResizeHandle,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const stage = annotationStageRef.current;
    if (!stage) {
      return;
    }

    setEditingAnnotationId(annotation.id);
    setResizingAnnotation({
      id: annotation.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: annotation.x,
      startY: annotation.y,
      startWidth: annotation.width,
      startHeight: annotation.height,
      stageWidth: stage.clientWidth || 1,
      stageHeight: stage.clientHeight || 1,
    });
  }

  function deleteAnnotation(annotationId: string) {
    updateAnnotationDrafts((annotations) => annotations.filter((annotation) => annotation.id !== annotationId));
    if (editingAnnotationId === annotationId) {
      setEditingAnnotationId(null);
    }
  }

  async function loadImageDetails(imageId: string) {
    try {
      const response = await fetch(`/api/images/${imageId}`, { cache: "no-store" });
      const result = (await response.json().catch(() => null)) as { image?: ChartImage } | null;
      if (!response.ok || !result?.image || selectedImageIdRef.current !== imageId) {
        return;
      }

      setData((current) =>
        current
          ? {
              ...current,
              images: current.images.map((image) => (image.id === imageId ? result.image! : image)),
            }
          : current,
      );
      if (!annotationDirtyRef.current) {
        hydrateAnnotationDrafts(result.image);
      }
      const loadedDraft = detailDraftFromImage(result.image);
      detailDraftRef.current = loadedDraft;
      setDetailDraft(loadedDraft);
    } catch {
      // Keep the atlas summary visible if the full detail request fails.
    }
  }

  function commitSelectedImage(image: ChartImage) {
    const nextDraft = detailDraftFromImage(image);
    selectedImageIdRef.current = image.id;
    detailDraftRef.current = nextDraft;
    detailTagInputRef.current = "";
    setSelectedImageId(image.id);
    setDetailDraft(nextDraft);
    hydrateAnnotationDrafts(image);
    setDetailTagInput("");
    void loadImageDetails(image.id);
  }

  async function saveCurrentImageChanges() {
    const annotationsSaved = await saveAnnotationsNow();
    if (!annotationsSaved) {
      setNoticeDialog({
        title: t.annotationsSaveFailed,
        message: t.annotationsSaveFailed,
        tone: "error",
      });
      return false;
    }

    if (!isManageMode) {
      return true;
    }

    const currentImage = data?.images.find((image) => image.id === selectedImageIdRef.current);
    return currentImage ? saveImageDetails(currentImage) : true;
  }

  async function selectImage(image: ChartImage) {
    const previousSelection = imageSelectionPromiseRef.current;
    const selectionTask = (async () => {
      if (previousSelection) {
        if (!(await previousSelection)) {
          return false;
        }
      }

      if (image.id === selectedImageIdRef.current) {
        return true;
      }

      if (!(await saveCurrentImageChanges())) {
        return false;
      }

      commitSelectedImage(image);
      return true;
    })();

    imageSelectionPromiseRef.current = selectionTask;
    try {
      return await selectionTask;
    } finally {
      if (imageSelectionPromiseRef.current === selectionTask) {
        imageSelectionPromiseRef.current = null;
      }
    }
  }

  async function openManageViewerForImage(image: ChartImage) {
    if (!(await selectImage(image))) {
      return;
    }

    if (!isManageViewerOpen) {
      manageGridScrollTopRef.current = contentScrollRef.current?.scrollTop ?? 0;
    }
    setIsManageViewerOpen(true);
    window.requestAnimationFrame(() => contentScrollRef.current?.scrollTo({ top: 0 }));
  }

  function closeManageViewer() {
    setIsManageViewerOpen(false);
    setIsEditingAnnotations(false);
    setEditingAnnotationId(null);
    void saveAnnotationsNow();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() =>
        contentScrollRef.current?.scrollTo({ top: manageGridScrollTopRef.current }),
      );
    });
  }

  async function selectAdjacentImage(direction: -1 | 1) {
    const images = data?.images ?? [];
    if (images.length < 2 || detailsSavingRef.current || annotationsSaving) {
      return;
    }

    const currentIndex = selectedImageIndex >= 0 ? selectedImageIndex : 0;
    const nextIndex = (currentIndex + direction + images.length) % images.length;
    await selectImage(images[nextIndex]);
  }

  function selectIndex(id: string | null) {
    setSelectedIndexId(id);
    setImageGridPage(1);
    setSelectedBulkImageIds(new Set());
  }

  function toggleIndexExpanded(id: string) {
    setCollapsedIndexIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      persistCollapsedIndexIds(next);

      return next;
    });
  }

  function collapseLeafIndexes(node: IndexTreeNode) {
    const ids = collapsibleIndexIds(node);
    if (ids.length === 0) {
      return;
    }

    setCollapsedIndexIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      persistCollapsedIndexIds(next);
      return next;
    });
    setIndexContextMenu(null);
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

  function toggleBrowseAnnotations() {
    const nextValue = !showBrowseAnnotations;
    setShowBrowseAnnotations(nextValue);
    window.localStorage.setItem(
      "brooks-pa-atlas.browseAnnotations",
      nextValue ? "visible" : "hidden",
    );
  }

  function toggleBrowseNotes() {
    const nextValue = !showBrowseNotes;
    setShowBrowseNotes(nextValue);
    window.localStorage.setItem(
      "brooks-pa-atlas.browseNotes",
      nextValue ? "visible" : "hidden",
    );
  }

  function toggleAnnotationEditing() {
    setIsEditingAnnotations((current) => {
      const nextValue = !current;
      if (!nextValue) {
        setEditingAnnotationId(null);
        void saveAnnotationsNow();
      } else {
        setShowBrowseAnnotations(true);
        window.localStorage.setItem("brooks-pa-atlas.browseAnnotations", "visible");
      }

      return nextValue;
    });
  }

  function toggleLocale() {
    const nextLocale = locale === "zh" ? "en" : "zh";
    setLocale(nextLocale);
    window.localStorage.setItem("brooks-pa-atlas.locale", nextLocale);
  }

  function setPersistedViewModeWithPagination(mode: ViewMode) {
    setIsManageViewerOpen(false);
    setIsEditingAnnotations(false);
    setEditingAnnotationId(null);
    void saveAnnotationsNow();

    if (mode !== "manage") {
      setIsIndexReorderEnabled(false);
      clearIndexDragState();
    }

    setPersistedViewMode(mode);
    setImageGridPage(1);
    setSelectedBulkImageIds(new Set());
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
                {isExamMode ? (
                  <ClipboardList className="h-4 w-4" />
                ) : isBrowseMode ? (
                  <PencilLine className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
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

              {isManageMode ? (
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
                  <label
                    className={`mt-3 flex h-9 cursor-pointer items-center justify-between rounded-md border px-3 text-xs font-medium transition ${
                      isIndexReorderEnabled
                        ? "border-cyan-700 bg-cyan-50 text-cyan-800"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    } ${reorderingIndex ? "cursor-not-allowed opacity-60" : ""}`}
                    title={t.reorderIndex}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t.reorderIndexMode}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={isIndexReorderEnabled}
                      disabled={reorderingIndex}
                      onChange={(event) => {
                        setIndexContextMenu(null);
                        const nextEnabled = event.target.checked;
                        setIsIndexReorderEnabled(nextEnabled);
                        if (!nextEnabled) {
                          clearIndexDragState();
                        }
                      }}
                      className="h-4 w-4 accent-cyan-700"
                      aria-label={t.reorderIndexMode}
                    />
                  </label>
                </div>
              ) : null}

              <nav
                className={`max-h-96 overflow-auto p-3 xl:max-h-none ${
                  isManageMode ? "xl:h-[calc(100vh-231px)]" : "xl:h-[calc(100vh-119px)]"
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
                  allowReorder={canReorderIndexes}
                  draggedNodeId={draggedIndexNodeId}
                  dropIndicator={indexDropIndicator}
                  reorderTitle={t.reorderIndex}
                  onSelect={selectIndex}
                  onToggleExpanded={toggleIndexExpanded}
                  onContextMenu={openIndexContextMenu}
                  onDragStart={startIndexDrag}
                  onDragOver={updateIndexDropTarget}
                  onDrop={dropIndexNode}
                  onDragEnd={clearIndexDragState}
                />
              </nav>
            </>
          )}
        </aside>

        <section className="min-w-0">
          {!isExamMode ? (
            <div className="flex h-16 items-center gap-3 border-b border-zinc-200 bg-white px-5">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setImageGridPage(1);
                    setSelectedBulkImageIds(new Set());
                  }}
                  className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-zinc-500"
                  placeholder={t.searchPlaceholder}
                />
              </div>
              <TagFilterSelector
                selectedIds={selectedTagIds}
                onToggle={toggleTagFilter}
                onClear={clearTagFilter}
                options={data?.tags ?? []}
                className="h-10 w-36 shrink-0 text-xs"
                ariaLabel={t.activeTag}
                clearLabel={t.clearTagFilter}
              />
              {isManageMode ? (
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
                    onClick={() => documentInputRef.current?.click()}
                    disabled={documentImporting || uploading}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {documentImporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    <span>{documentImportButtonLabel}</span>
                  </button>
                  <input
                    ref={documentInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(event) => {
                      void uploadDocument(event.target.files?.[0] ?? null);
                      event.target.value = "";
                    }}
                  />
                  <label className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700">
                    <input
                      type="checkbox"
                      checked={importOcrEnabled}
                      onChange={(event) => setImportOcrEnabled(event.target.checked)}
                      disabled={uploading || documentImporting}
                      className="h-4 w-4 rounded border-zinc-300 text-cyan-700 focus:ring-cyan-700"
                    />
                    <span>{t.runImportOcr}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void downloadBackup()}
                    disabled={backingUp || restoring || documentImporting}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    <span>{backingUp ? t.backingUp : t.backupData}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreInputRef.current?.click()}
                    disabled={backingUp || restoring || documentImporting}
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
          ) : null}

          {isManageMode && files.length > 0 ? (
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

          <div
            ref={contentScrollRef}
            className={`overflow-auto ${isExamMode ? "p-3 xl:h-screen" : "p-5 xl:h-[calc(100vh-65px)]"}`}
          >
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

            {isExamMode ? (
              <ExamMode
                locale={locale}
                selectedIndexId={selectedIndexId}
              />
            ) : null}

            {isManageMode && !isManageViewerOpen ? (
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

            {isLargeViewerActive && selectedImage ? (
              <div className="mb-4 rounded-md border border-zinc-200 bg-white p-4">
                <div className="mb-3 flex min-h-8 min-w-0 flex-wrap items-center gap-3">
                  {isManageMode ? (
                    <button
                      type="button"
                      onClick={closeManageViewer}
                      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      aria-label={t.backToImageGrid}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      <span>{t.backToImageGrid}</span>
                    </button>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold" title={selectedImageTip}>
                      {selectedImage.title ?? selectedImage.originalName}
                    </h2>
                    {selectedImage.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selectedImage.tags.map((tag) => (
                          <button
                            type="button"
                            key={tag.id}
                            onClick={() => toggleTagFilter(tag.id)}
                            className="inline-flex h-5 items-center rounded-full border border-cyan-200 bg-cyan-50 px-2 text-[11px] font-medium text-cyan-800 hover:bg-cyan-100"
                          >
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className="min-w-0 max-w-[45%] truncate text-sm text-zinc-500" title={selectedImageTip}>
                    {selectedImage.indexNode?.path ?? t.unclassified}
                  </span>
                  {detailsSaving ? (
                    <span className="inline-flex h-8 shrink-0 items-center gap-2 text-xs font-medium text-zinc-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t.saving}
                    </span>
                  ) : null}
                  <div className="ml-auto flex h-8 shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1">
                    {isBrowseMode ? (
                      <button
                        type="button"
                        onClick={toggleBrowseThumbnails}
                        className="inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-zinc-600 hover:bg-white"
                        title={showBrowseThumbnails ? t.hideThumbnails : t.showThumbnails}
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        <span>{showBrowseThumbnails ? t.hideThumbnails : t.showThumbnails}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={toggleBrowseAnnotations}
                      className="inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-zinc-600 hover:bg-white"
                      title={showBrowseAnnotations ? t.hideAnnotations : t.showAnnotations}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      <span>{showBrowseAnnotations ? t.hideAnnotations : t.showAnnotations}</span>
                    </button>
                    <button
                      type="button"
                      onClick={toggleAnnotationEditing}
                      className={`inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium ${
                        isEditingAnnotations ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-white"
                      }`}
                      title={isEditingAnnotations ? t.stopEditAnnotations : t.editAnnotations}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      <span>{isEditingAnnotations ? t.stopEditAnnotations : t.editAnnotations}</span>
                    </button>
                    {isBrowseMode ? (
                      <button
                        type="button"
                        onClick={toggleBrowseNotes}
                        className="inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-zinc-600 hover:bg-white"
                        title={showBrowseNotes ? t.hideBrowseNotes : t.showBrowseNotes}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>{showBrowseNotes ? t.hideBrowseNotes : t.showBrowseNotes}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => adjustImageZoom(-imageZoomStep)}
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
                      onClick={() => adjustImageZoom(imageZoomStep)}
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
                  ref={viewerViewportRef}
                  className={`brooks-image-viewer-scrollport group relative min-h-[420px] overflow-auto rounded-md border border-zinc-200 bg-zinc-100 ${
                    isResizingViewer ? "select-none" : ""
                  }`}
                  style={{ height: imageViewerHeight }}
                >
                  <div
                    className="relative min-h-full min-w-full"
                    style={
                      imageStageSize
                        ? {
                            width: Math.max(imageStageSize.width, viewerViewportSize.width),
                            height: Math.max(imageStageSize.height, viewerViewportSize.height),
                          }
                        : undefined
                    }
                  >
                    {imageStageSize ? (
                      <div
                        ref={annotationStageRef}
                        onPointerDown={addAnnotationAt}
                        className={`absolute left-1/2 top-1/2 bg-white ${
                          isEditingAnnotations ? "cursor-crosshair" : ""
                        }`}
                        style={{
                          width: imageStageSize.width,
                          height: imageStageSize.height,
                          transform: "translate(-50%, -50%)",
                        }}
                        title={isEditingAnnotations ? t.addAnnotationHint : undefined}
                      >
                        <img
                          src={`/api/images/${selectedImage.id}/file`}
                          alt={selectedImage.title ?? selectedImage.originalName}
                          className="pointer-events-none h-full w-full select-none object-contain"
                        />
                        {showBrowseAnnotations
                          ? annotationDrafts.map((annotation) => (
                              <div
                                key={annotation.id}
                                onPointerDown={(event) => event.stopPropagation()}
                                className={`absolute z-10 ${
                                  isEditingAnnotations ? "pointer-events-auto" : "pointer-events-none"
                                } ${
                                  isEditingAnnotations
                                    ? editingAnnotationId === annotation.id
                                      ? "border border-sky-600"
                                      : "border border-zinc-400"
                                    : ""
                                }`}
                                style={{
                                  left: `${annotation.x * 100}%`,
                                  top: `${annotation.y * 100}%`,
                                  width: `${annotation.width * 100}%`,
                                  height: `${annotation.height * 100}%`,
                                  color: annotation.color,
                                  fontSize: `${Math.max(10, annotation.fontSize * (imageZoom / 100))}px`,
                                }}
                              >
                                {isEditingAnnotations ? (
                                  <div className="relative flex h-full items-start gap-1">
                                    <button
                                      type="button"
                                      onPointerDown={(event) => startAnnotationDrag(annotation, event)}
                                      className="absolute -left-6 top-0 grid h-5 w-5 shrink-0 cursor-move place-items-center rounded bg-white/80 text-zinc-500 shadow-sm hover:bg-white"
                                      title={t.editAnnotations}
                                    >
                                      <GripVertical className="h-3.5 w-3.5" />
                                    </button>
                                    <textarea
                                      value={annotation.text}
                                      onFocus={() => setEditingAnnotationId(annotation.id)}
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onChange={(event) =>
                                        updateAnnotationDrafts((annotations) =>
                                          annotations.map((item) =>
                                            item.id === annotation.id
                                              ? { ...item, text: event.target.value }
                                              : item,
                                          ),
                                        )
                                      }
                                      placeholder={t.annotationTextPlaceholder}
                                      className="h-full min-h-0 flex-1 resize-none bg-transparent px-1 py-0.5 font-medium leading-snug text-inherit outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => deleteAnnotation(annotation.id)}
                                      className="absolute -right-6 top-0 grid h-5 w-5 shrink-0 place-items-center rounded bg-white/80 text-zinc-500 shadow-sm hover:bg-white"
                                      title={t.deleteAnnotation}
                                      aria-label={t.deleteAnnotation}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                    {editingAnnotationId === annotation.id
                                      ? annotationResizeHandles.map((item) => (
                                          <button
                                            type="button"
                                            key={item.handle}
                                            onPointerDown={(event) => startAnnotationResize(annotation, item.handle, event)}
                                            className={`absolute h-3 w-3 rounded-sm border border-sky-700 bg-white shadow-sm ${item.className} ${item.cursor}`}
                                            aria-label={`${t.annotationStyle} ${item.handle}`}
                                            title={t.annotationStyle}
                                          />
                                        ))
                                      : null}
                                  </div>
                                ) : (
                                  <div className="whitespace-pre-wrap font-medium leading-snug">
                                    {annotation.text}
                                  </div>
                                )}
                              </div>
                            ))
                          : null}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[420px] min-w-full items-center justify-center">
                        <img
                          src={`/api/images/${selectedImage.id}/file`}
                          alt={selectedImage.title ?? selectedImage.originalName}
                          className={imageZoom === 100 ? "h-full w-full object-contain" : "block max-w-none"}
                          style={imageZoom === 100 ? undefined : { width: `${imageZoom}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {isEditingAnnotations ? (
                    <div className="absolute left-3 top-3 z-20 rounded-md border border-zinc-200 bg-white/90 px-2 py-1 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur">
                      {annotationSaveFailed
                        ? t.annotationsSaveFailed
                        : annotationsSaving
                          ? t.annotationsSaving
                          : t.addAnnotationHint}
                    </div>
                  ) : annotationSaveFailed ? (
                    <div className="absolute left-3 top-3 z-20 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 shadow-sm">
                      {t.annotationsSaveFailed}
                    </div>
                  ) : null}
                  {canNavigateSelectedImage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void selectAdjacentImage(-1)}
                        disabled={detailsSaving || annotationsSaving}
                        className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-zinc-950/55 text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-zinc-950/75 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-30"
                        aria-label={t.previousImage}
                        title={t.previousImageShortcut}
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void selectAdjacentImage(1)}
                        disabled={detailsSaving || annotationsSaving}
                        className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-zinc-950/55 text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-zinc-950/75 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-30"
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
                {isEditingAnnotations && selectedAnnotation ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    <span className="font-semibold text-zinc-700">{t.annotationStyle}</span>
                    <label className="inline-flex items-center gap-2">
                      <span>{t.annotationColor}</span>
                      <input
                        type="color"
                        value={selectedAnnotation.color}
                        onChange={(event) =>
                          updateAnnotationDrafts((annotations) =>
                            annotations.map((annotation) =>
                              annotation.id === selectedAnnotation.id
                                ? { ...annotation, color: event.target.value }
                                : annotation,
                            ),
                          )
                        }
                        className="h-7 w-9 rounded border border-zinc-200 bg-white p-0.5"
                        aria-label={t.annotationColor}
                      />
                    </label>
                    <label className="inline-flex min-w-52 items-center gap-2">
                      <span>{t.annotationFontSize}</span>
                      <input
                        type="range"
                        min="10"
                        max="48"
                        step="1"
                        value={selectedAnnotation.fontSize}
                        onChange={(event) =>
                          updateAnnotationDrafts((annotations) =>
                            annotations.map((annotation) =>
                              annotation.id === selectedAnnotation.id
                                ? { ...annotation, fontSize: clampAnnotationFontSize(Number(event.target.value)) }
                                : annotation,
                            ),
                          )
                        }
                        className="w-28 accent-zinc-950"
                        aria-label={t.annotationFontSize}
                      />
                      <input
                        type="number"
                        min="10"
                        max="48"
                        value={selectedAnnotation.fontSize}
                        onChange={(event) =>
                          updateAnnotationDrafts((annotations) =>
                            annotations.map((annotation) =>
                              annotation.id === selectedAnnotation.id
                                ? { ...annotation, fontSize: clampAnnotationFontSize(Number(event.target.value)) }
                                : annotation,
                            ),
                          )
                        }
                        className="h-7 w-14 rounded border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-zinc-500"
                        aria-label={t.annotationFontSize}
                      />
                    </label>
                  </div>
                ) : null}
                {isBrowseMode && showBrowseNotes ? (
                  <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-600">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{t.browseNotesTitle}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                      {selectedImage.notes?.trim() ? selectedImage.notes : t.noBrowseNotes}
                    </p>
                  </div>
                ) : null}
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
                {isManageMode && selectedBulkImageIds.size > 0 ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-950">
                    <span className="font-semibold">
                      {t.bulkSelected}: {selectedBulkImageIds.size}
                    </span>
                    <TagSuggestionInput
                      value={bulkTagInput}
                      onChange={setBulkTagInput}
                      onSubmit={addBulkTag}
                      suggestions={data?.tags ?? []}
                      className="h-8 min-w-44 text-xs"
                      placeholder={t.tagPlaceholder}
                      ariaLabel={t.tagPlaceholder}
                    />
                    <button
                      type="button"
                      onClick={addBulkTag}
                      disabled={bulkTagsBusy || !bulkTagInput.trim()}
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-cyan-700 px-3 font-medium text-white hover:bg-cyan-800 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.bulkAddTag}
                    </button>
                    <TagRemovalSelector
                      value={bulkRemoveTagId}
                      onChange={setBulkRemoveTagId}
                      options={selectedBulkTagStats}
                      totalCount={selectedBulkImageIds.size}
                      className="h-8 min-w-44 text-xs"
                      placeholder={t.removeTag}
                      ariaLabel={t.removeTag}
                    />
                    <button
                      type="button"
                      onClick={removeBulkTag}
                      disabled={bulkTagsBusy || !bulkRemoveTagId}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-cyan-300 bg-white px-3 font-medium text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t.bulkRemoveTag}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedBulkImageIds(new Set())}
                      disabled={bulkTagsBusy}
                      className="ml-auto h-8 rounded-md border border-cyan-300 bg-white px-3 font-medium text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
                    >
                      {t.clearSelection}
                    </button>
                  </div>
                ) : null}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                  {imageGridPageImages.map((image) => (
                    <div
                      key={image.id}
                      className={`relative overflow-hidden rounded-md border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        selectedImage?.id === image.id ? "border-zinc-950" : "border-zinc-200"
                      }`}
                    >
                      {isManageMode ? (
                        <label className="absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded border border-zinc-200 bg-white/90 shadow-sm">
                          <input
                            type="checkbox"
                            checked={selectedBulkImageIds.has(image.id)}
                            onChange={() => toggleBulkImage(image.id)}
                            className="h-4 w-4 accent-cyan-700"
                            aria-label={`${t.bulkSelected}: ${image.title ?? image.originalName}`}
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void selectImage(image)}
                        onDoubleClick={() => {
                          if (isManageMode) {
                            void openManageViewerForImage(image);
                          }
                        }}
                        className="block w-full text-left"
                      >
                        <div className="aspect-[4/3] bg-zinc-100">
                          <img
                            src={`/api/images/${image.id}/file`}
                            alt={image.title ?? image.originalName}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        </div>
                        <div className="p-3 pb-2">
                          <p className="truncate text-sm font-semibold" title={image.title ?? image.originalName}>
                            {image.title ?? image.originalName}
                          </p>
                          <p className="truncate text-xs text-zinc-500" title={image.indexNode?.path ?? t.unclassified}>
                            {image.indexNode?.path ?? t.unclassified}
                          </p>
                        </div>
                      </button>
                      {isManageMode ? (
                        <button
                          type="button"
                          onClick={() => void openManageViewerForImage(image)}
                          className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-md border border-zinc-200 bg-white/90 text-zinc-600 shadow-sm backdrop-blur hover:bg-white hover:text-zinc-950"
                          title={t.openLargeViewer}
                          aria-label={`${t.openLargeViewer}: ${image.title ?? image.originalName}`}
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {image.tags.length > 0 ? (
                        <div className="flex min-h-5 flex-wrap gap-1 px-3 pb-2">
                          {image.tags.slice(0, 2).map((tag) => (
                            <button
                              type="button"
                              key={tag.id}
                              onClick={() => toggleTagFilter(tag.id)}
                              className="inline-flex h-5 max-w-full items-center truncate rounded-full border border-cyan-200 bg-cyan-50 px-2 text-[11px] font-medium text-cyan-800 hover:bg-cyan-100"
                              title={tag.name}
                            >
                              {tag.name}
                            </button>
                          ))}
                          {image.tags.length > 2 ? (
                            <span className="inline-flex h-5 items-center rounded-full bg-zinc-100 px-2 text-[11px] text-zinc-600">
                              +{image.tags.length - 2}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="px-3 pb-3">
                        <span className={`inline-flex h-6 items-center rounded border px-2 text-xs ${ocrTone(image.ocrStatus)}`}>
                          {ocrStatusLabels[locale][image.ocrStatus]}
                        </span>
                      </div>
                    </div>
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

            {!isExamMode && data?.images.length === 0 ? (
              <div className="grid h-72 place-items-center rounded-md border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                {t.noImages}
              </div>
            ) : null}
          </div>
        </section>

        {isManageMode ? (
          <aside className="border-l border-zinc-200 bg-white">
          <div className="h-16 border-b border-zinc-200 px-4 py-3">
            <p className="text-sm font-semibold">{t.imageDetail}</p>
            <p className="truncate text-xs text-zinc-500">{selectedImage?.originalName ?? t.noSelection}</p>
          </div>

          {selectedImage ? (
            <div className="overflow-auto p-4 xl:h-[calc(100vh-65px)]">
              <div className="group relative mb-4 aspect-[4/3] overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                <img
                  src={`/api/images/${selectedImage.id}/file`}
                  alt={selectedImage.title ?? selectedImage.originalName}
                  className="h-full w-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => void openManageViewerForImage(selectedImage)}
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md border border-white/70 bg-zinc-950/60 text-white opacity-0 shadow-md backdrop-blur transition hover:bg-zinc-950/80 focus-visible:opacity-100 group-hover:opacity-100"
                  title={t.openLargeViewer}
                  aria-label={t.openLargeViewer}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
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

                <div>
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.tags}</span>
                  {detailDraft.tagNames.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {detailDraft.tagNames.map((name) => (
                        <span
                          key={name.toLowerCase()}
                          className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 pl-2 pr-1 text-xs font-medium text-cyan-800"
                        >
                          <span className="truncate">{name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setDetailDraft((draft) => ({
                                ...draft,
                                tagNames: removeTagName(draft.tagNames, name),
                              }))
                            }
                            className="grid h-4 w-4 shrink-0 place-items-center rounded-full hover:bg-cyan-100"
                            title={`${t.removeTag}: ${name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <TagSuggestionInput
                      value={detailTagInput}
                      onChange={setDetailTagInput}
                      onSubmit={addDetailTag}
                      suggestions={data?.tags ?? []}
                      excludedNames={detailDraft.tagNames}
                      submitOnComma
                      className="h-9 min-w-0 flex-1 text-sm"
                      placeholder={t.tagPlaceholder}
                      ariaLabel={t.tagPlaceholder}
                    />
                    <button
                      type="button"
                      onClick={addDetailTag}
                      disabled={!detailTagInput.trim()}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                      title={t.addTag}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.index}</span>
                  <IndexTreeSelector
                    value={detailDraft.indexNodeId}
                    onChange={(indexNodeId) => setDetailDraft((draft) => ({ ...draft, indexNodeId }))}
                    nodes={data?.tree ?? []}
                    labels={{
                      choose: t.chooseIndex,
                      collapse: t.collapseIndex,
                      expand: t.expandIndex,
                      noResults: t.noMatchingIndex,
                      searchPlaceholder: t.searchIndex,
                      unclassified: t.unclassified,
                    }}
                  />
                </div>

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
                  disabled={detailsSaving}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {detailsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>{detailsSaving ? t.saving : t.save}</span>
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
                    disabled={isSelectedImageOcrBusy}
                    className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                    title={selectedImage.ocrStatus === "FAILED" ? t.retryOcr : t.runOcr}
                  >
                    {ocrRunningImageId === selectedImage.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {selectedImage.ocrError ? (
                  <p className="flex gap-2 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
                    <AlertTriangle className="h-4 w-4 flex-none" />
                    <span>{selectedImage.ocrError}</span>
                  </p>
                ) : null}
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.ocrText}</span>
                  <textarea
                    value={detailDraft.ocrText}
                    onChange={(event) => setDetailDraft((draft) => ({ ...draft, ocrText: event.target.value }))}
                    placeholder={t.noOcrText}
                    className="min-h-32 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-xs leading-5 outline-none focus:border-zinc-500"
                  />
                </label>
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
      {backupTask ? (
        <div
          className="fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),24rem)] rounded-md border border-zinc-200 bg-white p-4 text-sm shadow-2xl"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${
                backupTask.status === "failed"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : backupTask.status === "completed"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-cyan-200 bg-cyan-50 text-cyan-700"
              }`}
            >
              {backupTask.status === "failed" ? (
                <AlertTriangle className="h-4 w-4" />
              ) : backupTask.status === "completed" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-950">{backupTaskTitle}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{backupTaskPhase}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums text-zinc-950">
                    {backupTaskPercent}%
                  </span>
                  {backupTask.status !== "running" ? (
                    <button
                      type="button"
                      onClick={() => setBackupTask(null)}
                      className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100"
                      aria-label={t.taskDismiss}
                      title={t.taskDismiss}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className={`h-full transition-all ${
                    backupTask.status === "failed"
                      ? "bg-rose-600"
                      : backupTask.status === "completed"
                        ? "bg-emerald-600"
                        : "bg-cyan-700"
                  }`}
                  style={{ width: `${backupTaskPercent}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                <span>
                  {backupTask.totalImages > 0
                    ? `${backupTask.processedImages}/${backupTask.totalImages} ${t.imageUnit}`
                    : t.taskPreparing}
                </span>
                {backupTask.status === "running" ? <span>{t.taskKeepWorking}</span> : null}
              </div>
              {backupTask.status === "failed" && backupTask.error ? (
                <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                  {backupTask.error}
                </p>
              ) : null}
              {backupTask.status === "completed" && backupTask.kind === "restore" && backupTask.stats ? (
                <p className="mt-3 whitespace-pre-line rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">
                  {restoreCompleteMessage(backupTask.stats)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {indexContextMenu && isManageMode ? (
        <div
          className="fixed z-40 w-56 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-xl"
          style={{ left: indexContextMenu.x, top: indexContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void downloadBackup(indexContextMenu.node)}
            disabled={backingUp}
            className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent"
          >
            <Download className="h-4 w-4" />
            <span>{t.exportIndex}</span>
          </button>
          <button
            type="button"
            onClick={() => collapseLeafIndexes(indexContextMenu.node)}
            disabled={indexContextMenu.node.children.length === 0}
            className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent"
            title={indexContextMenu.node.children.length === 0 ? t.collapseLeafIndexesDisabled : t.collapseLeafIndexes}
          >
            <ChevronRight className="h-4 w-4" />
            <span>{t.collapseLeafIndexes}</span>
          </button>
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
      {noticeDialog ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/50 p-6"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="notice-dialog-title"
          aria-describedby="notice-dialog-message"
          onClick={() => setNoticeDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border ${
                  noticeDialog.tone === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="notice-dialog-title" className="text-base font-semibold text-zinc-950">
                  {noticeDialog.title}
                </h2>
                <p id="notice-dialog-message" className="mt-2 text-sm leading-6 text-zinc-600">
                  {noticeDialog.message}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setNoticeDialog(null)}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                {t.confirm}
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
