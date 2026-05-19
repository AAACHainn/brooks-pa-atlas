"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { DragEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Locale = "zh" | "en";
type ExamQuestionType = "SINGLE" | "MULTIPLE";

type MaskRect = { x: number; y: number; width: number; height: number; color?: string };
type MaskResizeHandle = "nw" | "ne" | "sw" | "se";
type MaskDragState =
  | { kind: "draw"; start: { x: number; y: number } }
  | { kind: "move"; index: number; start: { x: number; y: number }; original: MaskRect }
  | { kind: "resize"; index: number; handle: MaskResizeHandle; original: MaskRect };
type ImagePanState = {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
};

type ExamImage = {
  id: string;
  originalName: string;
  title: string | null;
  width: number | null;
  height: number | null;
  hash: string;
  indexNode: { id: string; name: string; path: string } | null;
};

type ExamQuestion = {
  id: string;
  paperId: string;
  chartImageId: string;
  questionType: ExamQuestionType;
  prompt: string;
  options: string[];
  correctOption: string | null;
  correctOptions: string[];
  explanation: string;
  maskRects: MaskRect[];
  status: "DRAFT" | "READY";
  sortOrder: number;
  image: ExamImage;
};

type ExamPaper = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED";
  defaultOptions: string[];
  publishedAt: string | null;
  questionCount: number;
  attemptCount: number;
  questions?: ExamQuestion[];
};

type AttemptAnswer = {
  id: string;
  questionId: string;
  order: number;
  userAnswer: string | null;
  userAnswers: string[];
  isCorrect: boolean;
  question: ExamQuestion;
};

type ExamAttempt = {
  id: string;
  paperId: string;
  status: "IN_PROGRESS" | "SUBMITTED";
  startedAt: string;
  submittedAt: string | null;
  durationSeconds: number | null;
  totalCount: number;
  correctCount: number;
  accuracy: number;
  paper: { id: string; title: string; description: string | null; status: string } | null;
  answers: AttemptAnswer[];
};

type ExamAttemptSummary = Omit<ExamAttempt, "answers"> & {
  answers?: AttemptAnswer[];
};

type ConfirmDialogState =
  | { kind: "publish"; title: string; message: string; confirmLabel: string }
  | { kind: "delete-paper"; title: string; message: string; confirmLabel: string };

type NoticeDialogState = {
  title: string;
  message: string;
  items: string[];
  tone?: "success" | "warning";
};

type PaperMenuState = {
  paper: ExamPaper;
  x: number;
  y: number;
};

const copy = {
  zh: {
    title: "考试模式",
    subtitle: "用现有图库制作试卷，遮住图表后半段进行价格行为测试。",
    newPaper: "新建试卷",
    untitled: "未命名试卷",
    description: "描述",
    defaultOptions: "默认选项模板",
    addOption: "添加选项",
    removeOption: "删除选项",
    savePaper: "保存试卷",
    deletePaper: "删除试卷",
    copyPaper: "拷贝试卷",
    createPaper: "创建新试卷",
    importPaper: "导入试卷",
    exportPaper: "导出试卷",
    publish: "发布",
    published: "已发布",
    draft: "草稿",
    questions: "题目",
    attempts: "考试记录",
    addImage: "拖入试卷",
    dragImageToPaper: "拖到左侧加入试卷",
    dropImageToPaper: "松开后加入试卷",
    imageSearch: "搜索图片",
    examImage: "考试图片",
    allIndexes: "全部索引",
    previousPage: "上一页",
    nextPage: "下一页",
    previousQuestion: "上一题",
    nextQuestion: "下一题",
    previousQuestionShortcut: "上一题（快捷键 ←）",
    nextQuestionShortcut: "下一题（快捷键 →）",
    prompt: "题干",
    options: "选项",
    questionType: "题型",
    singleChoice: "单选题",
    multipleChoice: "多选题",
    correct: "正确答案",
    explanation: "解析",
    explanationOptional: "解析（可选）",
    explanationPlaceholder: "可留空；需要复盘时再补充你的分析。",
    mask: "遮罩",
    maskColor: "遮罩颜色",
    saveQuestion: "保存题目草稿",
    removeQuestion: "移除题目",
    clearMask: "清空遮罩",
    undoMask: "撤销遮罩",
    drawHint: "拖空白处新增遮罩；点击遮罩后可拖动，拉四角可调整大小。",
    ready: "已就绪",
    notReady: "草稿",
    startExam: "开始测试",
    continueExam: "继续",
    submitExam: "提交答案",
    result: "考试结果",
    accuracy: "正确率",
    correctCount: "正确题数",
    wrongOnly: "只看错题",
    hideMask: "隐藏遮罩",
    showMask: "显示遮罩",
    backToPapers: "返回试卷",
    yourAnswer: "你的答案",
    correctAnswer: "正确答案",
    noPapers: "暂无试卷",
    noAttempts: "还没有考试记录。",
    attemptHistory: "考试记录",
    refreshAttempts: "刷新记录",
    attemptInProgress: "未提交",
    viewAttempt: "查看",
    duration: "用时",
    submittedAt: "提交时间",
    noQuestions: "把右侧图片拖到左侧区域加入试卷。",
    locked: "发布后内容已锁定。",
    loadFailed: "加载失败，请稍后重试。",
    publishFailed: "发布失败：请确认每道题都有题干、选项、正确答案和遮罩。",
    errorTitle: "操作没有完成",
    duplicateImage: "这张图片已经在当前试卷中。",
    paperAlreadyPublished: "这套试卷已经发布。",
    attemptAlreadySubmitted: "这次考试已经提交。",
    exportPublishedOnly: "只有已发布试卷可以导出。",
    importMissingImages: "导入失败：当前图库缺少试卷引用的图片。",
    importInvalid: "导入失败：试卷文件格式不正确。",
    questionDraftTitle: "题目仍是草稿",
    questionDraftMessage: "已保存，但发布前还需要补充：",
    questionSavedTitle: "修改成功",
    questionSavedMessage: "题目已保存。",
    missingPrompt: "题干",
    missingOptions: "至少 2 个选项",
    missingCorrect: "正确答案",
    missingMask: "至少 1 个遮罩",
    gotIt: "知道了",
    cancel: "取消",
    publishConfirmTitle: "发布这套试卷？",
    publishConfirmMessage: "发布后试卷和题目内容会锁定，可用于考试。",
    deletePaperConfirmTitle: "删除这套试卷？",
    deleteDraftPaperConfirmMessage: "此操作会删除试卷草稿和其中所有题目，无法撤销。",
    deletePublishedPaperConfirmMessage: "此操作会删除已发布试卷、题目和相关考试记录，无法撤销。",
    confirmDelete: "确认删除",
    zoomIn: "放大",
    zoomOut: "缩小",
    resetZoom: "重置缩放",
    resizeImageWindow: "拖动调整看图窗口高度",
  },
  en: {
    title: "Exam Mode",
    subtitle: "Build papers from the existing chart library and mask future price action.",
    newPaper: "New paper",
    untitled: "Untitled paper",
    description: "Description",
    defaultOptions: "Default options",
    addOption: "Add option",
    removeOption: "Remove option",
    savePaper: "Save paper",
    deletePaper: "Delete paper",
    copyPaper: "Copy paper",
    createPaper: "Create paper",
    importPaper: "Import paper",
    exportPaper: "Export paper",
    publish: "Publish",
    published: "Published",
    draft: "Draft",
    questions: "Questions",
    attempts: "Attempts",
    addImage: "Drag to paper",
    dragImageToPaper: "Drag to the left area to add",
    dropImageToPaper: "Release to add to paper",
    imageSearch: "Search images",
    examImage: "Exam image",
    allIndexes: "All indexes",
    previousPage: "Previous",
    nextPage: "Next",
    previousQuestion: "Previous question",
    nextQuestion: "Next question",
    previousQuestionShortcut: "Previous question (shortcut ←)",
    nextQuestionShortcut: "Next question (shortcut →)",
    prompt: "Prompt",
    options: "Options",
    questionType: "Type",
    singleChoice: "Single choice",
    multipleChoice: "Multiple choice",
    correct: "Correct answer",
    explanation: "Explanation",
    explanationOptional: "Explanation (optional)",
    explanationPlaceholder: "Optional. Add notes later if you want review context.",
    mask: "Mask",
    maskColor: "Mask color",
    saveQuestion: "Save draft",
    removeQuestion: "Remove",
    clearMask: "Clear mask",
    undoMask: "Undo mask",
    drawHint: "Drag empty image space to add a mask; click a mask to move it or drag corners to resize.",
    ready: "Ready",
    notReady: "Draft",
    startExam: "Start exam",
    continueExam: "Continue",
    submitExam: "Submit",
    result: "Result",
    accuracy: "Accuracy",
    correctCount: "Correct",
    wrongOnly: "Wrong only",
    hideMask: "Hide mask",
    showMask: "Show mask",
    backToPapers: "Back",
    yourAnswer: "Your answer",
    correctAnswer: "Correct answer",
    noPapers: "No papers yet",
    noAttempts: "No exam records yet.",
    attemptHistory: "Attempts",
    refreshAttempts: "Refresh",
    attemptInProgress: "In progress",
    viewAttempt: "View",
    duration: "Duration",
    submittedAt: "Submitted",
    noQuestions: "Drag images from the right library into the left area.",
    locked: "Published content is locked.",
    loadFailed: "Load failed. Please try again.",
    publishFailed: "Publish failed. Make every question ready first.",
    errorTitle: "Action did not finish",
    duplicateImage: "This image is already in the paper.",
    paperAlreadyPublished: "This paper is already published.",
    attemptAlreadySubmitted: "This attempt has already been submitted.",
    exportPublishedOnly: "Only published papers can be exported.",
    importMissingImages: "Import failed: the current library is missing images referenced by this paper.",
    importInvalid: "Import failed: invalid paper file.",
    questionDraftTitle: "Question is still a draft",
    questionDraftMessage: "Saved, but add these before publishing:",
    questionSavedTitle: "Saved",
    questionSavedMessage: "Question changes were saved.",
    missingPrompt: "Prompt",
    missingOptions: "At least 2 options",
    missingCorrect: "Correct answer",
    missingMask: "At least 1 mask",
    gotIt: "Got it",
    cancel: "Cancel",
    publishConfirmTitle: "Publish this paper?",
    publishConfirmMessage: "After publishing, the paper and questions are locked and can be used for exams.",
    deletePaperConfirmTitle: "Delete this paper?",
    deleteDraftPaperConfirmMessage: "This will delete the draft paper and all of its questions. It cannot be undone.",
    deletePublishedPaperConfirmMessage:
      "This will delete the published paper, questions, and related exam records. It cannot be undone.",
    confirmDelete: "Delete",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetZoom: "Reset zoom",
    resizeImageWindow: "Drag to resize image window",
  },
};

const defaultOptions = ["上涨延续", "下跌延续", "震荡整理", "反转失败"];
const defaultMaskColor = "#000000";
const minMaskSize = 0.015;
const defaultExamViewerHeight = 520;
const examImageDragType = "application/x-brooks-exam-image";
const minExamImageZoom = 20;
const maxExamImageZoom = 240;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampExamViewerHeight(value: number) {
  return clamp(value, 320, 2000);
}

function maskStyle(rect: MaskRect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
    backgroundColor: rect.color ?? defaultMaskColor,
  };
}

function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }, color = defaultMaskColor) {
  const x = Math.max(0, Math.min(start.x, end.x));
  const y = Math.max(0, Math.min(start.y, end.y));
  const width = Math.min(1 - x, Math.abs(end.x - start.x));
  const height = Math.min(1 - y, Math.abs(end.y - start.y));
  return { x, y, width, height, color };
}

function pointInElement(element: HTMLElement, event: React.PointerEvent<HTMLElement>) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function moveMaskRect(
  original: MaskRect,
  start: { x: number; y: number },
  current: { x: number; y: number },
) {
  const nextX = clamp(original.x + current.x - start.x, 0, 1 - original.width);
  const nextY = clamp(original.y + current.y - start.y, 0, 1 - original.height);
  return { ...original, x: nextX, y: nextY };
}

function resizeMaskRect(original: MaskRect, current: { x: number; y: number }, handle: MaskResizeHandle) {
  let left = original.x;
  let top = original.y;
  let right = original.x + original.width;
  let bottom = original.y + original.height;

  if (handle.includes("w")) {
    left = clamp(current.x, 0, right - minMaskSize);
  } else {
    right = clamp(current.x, left + minMaskSize, 1);
  }

  if (handle.includes("n")) {
    top = clamp(current.y, 0, bottom - minMaskSize);
  } else {
    bottom = clamp(current.y, top + minMaskSize, 1);
  }

  return {
    ...original,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function replaceMaskRect(rects: MaskRect[], index: number, rect: MaskRect) {
  return rects.map((item, itemIndex) => (itemIndex === index ? rect : item));
}

function normalizeOptions(options: string[]) {
  const normalized = options.map((option) => option.trim()).filter(Boolean);
  return normalized.length >= 2 ? normalized.slice(0, 8) : defaultOptions;
}

function normalizeSelectedOptions(options: string[], selected: string[], questionType: ExamQuestionType) {
  const selectedSet = new Set(selected.map((option) => option.trim()).filter(Boolean));
  const values = options.filter((option) => selectedSet.has(option));
  return questionType === "SINGLE" ? values.slice(0, 1) : values;
}

function formatSelectedOptions(options: string[]) {
  return options.length > 0 ? options.join(" / ") : "-";
}

function questionFingerprint(question: ExamQuestion) {
  return JSON.stringify({
    questionType: question.questionType,
    prompt: question.prompt,
    options: normalizeOptions(question.options),
    correctOptions: normalizeSelectedOptions(
      normalizeOptions(question.options),
      question.correctOptions,
      question.questionType,
    ),
    explanation: question.explanation,
    maskRects: question.maskRects,
    sortOrder: question.sortOrder,
  });
}

function missingQuestionFields(
  question: Pick<ExamQuestion, "correctOptions" | "maskRects" | "options" | "prompt" | "questionType">,
  labels: (typeof copy)["zh"],
) {
  const options = normalizeOptions(question.options);
  const correctOptions = normalizeSelectedOptions(options, question.correctOptions, question.questionType);
  const missing: string[] = [];

  if (!question.prompt.trim()) {
    missing.push(labels.missingPrompt);
  }

  if (options.length < 2) {
    missing.push(labels.missingOptions);
  }

  if (
    (question.questionType === "SINGLE" && correctOptions.length !== 1) ||
    (question.questionType === "MULTIPLE" && correctOptions.length < 2)
  ) {
    missing.push(labels.missingCorrect);
  }

  if (question.maskRects.length === 0) {
    missing.push(labels.missingMask);
  }

  return missing;
}

function localizedErrorMessage(message: string | undefined, labels: (typeof copy)["zh"]) {
  switch (message) {
    case "This image is already in the paper.":
      return labels.duplicateImage;
    case "Paper is already published.":
      return labels.paperAlreadyPublished;
    case "Exam attempt has already been submitted.":
      return labels.attemptAlreadySubmitted;
    case "All questions must be ready before publishing.":
      return labels.publishFailed;
    case "Only published papers can be exported.":
      return labels.exportPublishedOnly;
    case "Imported exam paper references missing images.":
      return labels.importMissingImages;
    case "Invalid exam paper file.":
    case "Exam paper file is required.":
      return labels.importInvalid;
    default:
      return message || labels.loadFailed;
  }
}

async function readJsonResult<T>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text();
  if (!text) {
    return {} as T & { error?: string };
  }

  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    return { error: response.ok ? undefined : text } as T & { error?: string };
  }
}

function optionLabel(index: number) {
  return String.fromCharCode(65 + index);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function fileNameFromContentDisposition(value: string | null) {
  const encodedMatch = value?.match(/filename\*=UTF-8''([^;]+)/);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

function formatDateTime(value: string | null, locale: Locale) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds < 0) {
    return "-";
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${restSeconds}s` : `${restSeconds}s`;
}

function OptionsEditor({
  label,
  options,
  locked,
  t,
  onChange,
}: {
  label: string;
  options: string[];
  locked: boolean;
  t: (typeof copy)["zh"];
  onChange: (options: string[]) => void;
}) {
  const visibleOptions = options.length > 0 ? options : defaultOptions;

  function updateOption(index: number, value: string) {
    onChange(visibleOptions.map((option, optionIndex) => (optionIndex === index ? value : option)));
  }

  function removeOption(index: number) {
    if (visibleOptions.length <= 2) {
      return;
    }

    onChange(visibleOptions.filter((_, optionIndex) => optionIndex !== index));
  }

  function addOption() {
    if (visibleOptions.length >= 8) {
      return;
    }

    onChange([...visibleOptions, ""]);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="block text-xs font-medium text-zinc-500">{label}</span>
        {!locked ? (
          <button
            type="button"
            onClick={addOption}
            disabled={visibleOptions.length >= 8}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.addOption}
          </button>
        ) : null}
      </div>
      <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
        {visibleOptions.map((option, index) => (
          <div key={index} className="grid grid-cols-[28px_minmax(0,1fr)_32px] items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-950 text-xs font-semibold text-white">
              {optionLabel(index)}
            </span>
            <input
              value={option}
              disabled={locked}
              onChange={(event) => updateOption(index, event.target.value)}
              className="h-9 min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-100"
            />
            {!locked ? (
              <button
                type="button"
                onClick={() => removeOption(index)}
                disabled={visibleOptions.length <= 2}
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 hover:bg-white hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30"
                title={t.removeOption}
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MaskedImage({
  image,
  rects,
  editable,
  zoomable,
  color = defaultMaskColor,
  selectedIndex = -1,
  zoom = 100,
  zoomLabels,
  altText,
  onSelect,
  onChange,
  onZoomChange,
}: {
  image: ExamImage;
  rects: MaskRect[];
  editable?: boolean;
  zoomable?: boolean;
  color?: string;
  selectedIndex?: number;
  zoom?: number;
  zoomLabels?: { zoomIn: string; zoomOut: string; resetZoom: string; resizeImageWindow: string };
  altText?: string;
  onSelect?: (index: number) => void;
  onChange?: (rects: MaskRect[]) => void;
  onZoomChange?: (zoom: number) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef<ImagePanState | null>(null);
  const resizeStartRef = useRef({ height: defaultExamViewerHeight, y: 0 });
  const viewerHeightRef = useRef(defaultExamViewerHeight);
  const [dragState, setDragState] = useState<MaskDragState | null>(null);
  const [draftRect, setDraftRect] = useState<MaskRect | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [viewerHeight, setViewerHeight] = useState(defaultExamViewerHeight);
  const [isResizingViewer, setIsResizingViewer] = useState(false);
  const canPanImage = Boolean(zoomable && !editable && zoom > 100);

  useEffect(() => {
    if (!zoomable) {
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        const savedHeight = Number(window.localStorage.getItem("brooks-pa-atlas.examViewerHeight"));
        const nextHeight =
          Number.isFinite(savedHeight) && savedHeight > 0
            ? clampExamViewerHeight(savedHeight)
            : defaultExamViewerHeight;
        viewerHeightRef.current = nextHeight;
        setViewerHeight(nextHeight);
      } catch {
        // localStorage can be unavailable in restricted browser contexts.
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [zoomable]);

  useEffect(() => {
    if (!isResizingViewer) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const nextHeight = clampExamViewerHeight(
        resizeStartRef.current.height + event.clientY - resizeStartRef.current.y,
      );
      viewerHeightRef.current = nextHeight;
      setViewerHeight(nextHeight);
    }

    function handlePointerUp() {
      setIsResizingViewer(false);
      try {
        window.localStorage.setItem("brooks-pa-atlas.examViewerHeight", String(viewerHeightRef.current));
      } catch {
        // localStorage can be unavailable in restricted browser contexts.
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingViewer, zoomable]);

  function pointInCanvas(event: React.PointerEvent<HTMLElement>) {
    return canvasRef.current ? pointInElement(canvasRef.current, event) : { x: 0, y: 0 };
  }

  function startDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!editable) {
      return;
    }

    event.preventDefault();
    const point = pointInCanvas(event);
    onSelect?.(-1);
    setDragState({ kind: "draw", start: point });
    setDraftRect({ x: point.x, y: point.y, width: 0.001, height: 0.001, color });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startMove(index: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!editable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelect?.(index);
    setDragState({ kind: "move", index, start: pointInCanvas(event), original: rects[index] });
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function startResize(index: number, handle: MaskResizeHandle, event: React.PointerEvent<HTMLDivElement>) {
    if (!editable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelect?.(index);
    setDragState({ kind: "resize", index, handle, original: rects[index] });
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragState) {
      return;
    }

    const point = pointInCanvas(event);

    if (dragState.kind === "draw") {
      setDraftRect(normalizeRect(dragState.start, point, color));
      return;
    }

    if (dragState.kind === "move") {
      onChange?.(replaceMaskRect(rects, dragState.index, moveMaskRect(dragState.original, dragState.start, point)));
      return;
    }

    onChange?.(replaceMaskRect(rects, dragState.index, resizeMaskRect(dragState.original, point, dragState.handle)));
  }

  function endDrag() {
    if (dragState?.kind === "draw" && draftRect && draftRect.width > 0.01 && draftRect.height > 0.01) {
      const nextRects = [...rects, draftRect];
      onChange?.(nextRects);
      onSelect?.(nextRects.length - 1);
    }

    setDragState(null);
    setDraftRect(null);
  }

  function updateZoom(delta: number) {
    onZoomChange?.(clamp(zoom + delta, minExamImageZoom, maxExamImageZoom));
  }

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    if (!canPanImage || event.button !== 0 || !scrollRef.current) {
      return;
    }

    event.preventDefault();
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: scrollRef.current.scrollLeft,
      scrollTop: scrollRef.current.scrollTop,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updatePan(event: React.PointerEvent<HTMLDivElement>) {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId || !scrollRef.current) {
      return;
    }

    scrollRef.current.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
    scrollRef.current.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (panStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    panStateRef.current = null;
    setIsPanning(false);
  }

  function startViewerResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!zoomable) {
      return;
    }

    event.preventDefault();
    resizeStartRef.current = { height: viewerHeight, y: event.clientY };
    viewerHeightRef.current = viewerHeight;
    setIsResizingViewer(true);
  }

  return (
    <div className={`group relative rounded-md border border-zinc-200 bg-zinc-100 ${isResizingViewer ? "select-none" : ""}`}>
      {zoomable ? (
        <div
          className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-white/70 bg-white/90 p-1 shadow-sm backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => updateZoom(-10)}
            disabled={zoom <= minExamImageZoom}
            className="grid h-7 w-7 place-items-center rounded text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
            title={zoomLabels?.zoomOut}
            aria-label={zoomLabels?.zoomOut}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-11 text-center text-xs font-medium text-zinc-600">{zoom}%</span>
          <button
            type="button"
            onClick={() => updateZoom(10)}
            disabled={zoom >= maxExamImageZoom}
            className="grid h-7 w-7 place-items-center rounded text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
            title={zoomLabels?.zoomIn}
            aria-label={zoomLabels?.zoomIn}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onZoomChange?.(100)}
            className="grid h-7 w-7 place-items-center rounded text-zinc-700 hover:bg-zinc-100"
            title={zoomLabels?.resetZoom}
            aria-label={zoomLabels?.resetZoom}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className={`overflow-auto p-2 ${
          zoomable ? "select-none pb-5" : ""
        } ${canPanImage ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""}`}
        style={zoomable ? { height: viewerHeight } : undefined}
        onPointerDown={startPan}
        onPointerMove={updatePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          ref={canvasRef}
          className={`relative mx-auto ${zoomable ? "w-full max-w-none" : "w-fit max-w-full"} ${
            editable ? "cursor-crosshair" : ""
          }`}
          style={zoomable ? { width: `${zoom}%` } : undefined}
          onPointerDown={startDraw}
          onPointerMove={updateDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            src={`/api/images/${image.id}/file`}
            alt={altText ?? image.title ?? image.originalName}
            className={
              zoomable
                ? "block h-auto w-full max-w-none select-none"
                : "block max-h-[520px] max-w-full select-none"
            }
            draggable={false}
          />
          {rects.map((rect, index) => (
            <div
              key={`${rect.x}-${rect.y}-${index}`}
              className={`absolute border ${
                editable ? "cursor-move" : ""
              } ${selectedIndex === index ? "border-cyan-300 ring-2 ring-cyan-300/80" : "border-white/40"}`}
              style={maskStyle(rect)}
              onPointerDown={(event) => startMove(index, event)}
            />
          ))}
          {draftRect ? (
            <div
              className="absolute border border-cyan-300 ring-2 ring-cyan-300/80"
              style={maskStyle(draftRect)}
            />
          ) : null}
          {editable && selectedIndex >= 0 && rects[selectedIndex] ? (
            <>
              {(["nw", "ne", "sw", "se"] as MaskResizeHandle[]).map((handle) => (
                <div
                  key={handle}
                  className={`absolute h-3 w-3 rounded-sm border border-zinc-950 bg-white shadow ${
                    handle === "nw" || handle === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize"
                  }`}
                  style={{
                    left: `${(handle.includes("w") ? rects[selectedIndex].x : rects[selectedIndex].x + rects[selectedIndex].width) * 100}%`,
                    top: `${(handle.includes("n") ? rects[selectedIndex].y : rects[selectedIndex].y + rects[selectedIndex].height) * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                  onPointerDown={(event) => startResize(selectedIndex, handle, event)}
                />
              ))}
            </>
          ) : null}
        </div>
      </div>
      {zoomable ? (
        <button
          type="button"
          onPointerDown={startViewerResize}
          className="absolute bottom-0 left-1/2 z-20 flex h-5 w-28 -translate-x-1/2 cursor-row-resize items-center justify-center rounded-t-md border border-zinc-300 bg-white/90 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 group-hover:bg-white"
          title={zoomLabels?.resizeImageWindow}
          aria-label={zoomLabels?.resizeImageWindow}
        >
          <span className="h-1 w-12 rounded-full bg-zinc-400" />
        </button>
      ) : null}
    </div>
  );
}

export default function ExamMode({
  locale,
  selectedIndexId,
}: {
  locale: Locale;
  selectedIndexId: string | null;
}) {
  const t = copy[locale];
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<ExamPaper | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [paperDraft, setPaperDraft] = useState({
    title: "",
    description: "",
    defaultOptions,
  });
  const [imageQuery, setImageQuery] = useState("");
  const [imagePageState, setImagePageState] = useState<{ indexId: string | null; page: number }>({
    indexId: selectedIndexId,
    page: 1,
  });
  const [imageTotal, setImageTotal] = useState(0);
  const [images, setImages] = useState<ExamImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [attempts, setAttempts] = useState<ExamAttemptSummary[]>([]);
  const [attemptPageIndex, setAttemptPageIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [wrongOnly, setWrongOnly] = useState(false);
  const [isMaskHidden, setIsMaskHidden] = useState(false);
  const [attemptImageZoom, setAttemptImageZoom] = useState(100);
  const [editorImageZoom, setEditorImageZoom] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [noticeDialog, setNoticeDialog] = useState<NoticeDialogState | null>(null);
  const [paperMenu, setPaperMenu] = useState<PaperMenuState | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [savedQuestionFingerprints, setSavedQuestionFingerprints] = useState<Record<string, string>>({});
  const importPaperInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPaperId = selectedPaper?.id ?? null;
  const selectedQuestion = selectedPaper?.questions?.find((question) => question.id === selectedQuestionId) ?? null;
  const isLocked = selectedPaper?.status === "PUBLISHED";
  const canDropImage = Boolean(selectedPaper && !isLocked);
  const imagePage = imagePageState.indexId === selectedIndexId ? imagePageState.page : 1;
  const imageTotalPages = Math.max(1, Math.ceil(imageTotal / 24));
  const visibleResultAnswers = useMemo(
    () => attempt?.answers.filter((answer) => !wrongOnly || !answer.isCorrect) ?? [],
    [attempt?.answers, wrongOnly],
  );
  const attemptTotalPages = Math.max(1, visibleResultAnswers.length);
  const attemptCurrentPageIndex = Math.min(attemptPageIndex, attemptTotalPages - 1);
  const currentAttemptAnswer = visibleResultAnswers[attemptCurrentPageIndex] ?? null;
  const setImagePage = useCallback(
    (nextPage: number | ((page: number) => number)) => {
      setImagePageState((current) => {
        const currentPage = current.indexId === selectedIndexId ? current.page : 1;
        return {
          indexId: selectedIndexId,
          page: typeof nextPage === "function" ? nextPage(currentPage) : nextPage,
        };
      });
    },
    [selectedIndexId],
  );

  const loadPapers = useCallback(async () => {
    const response = await fetch("/api/exam/papers", { cache: "no-store" });
    const result = (await response.json()) as { papers?: ExamPaper[]; error?: string };
    if (!response.ok || !result.papers) {
      throw new Error(result.error ?? t.loadFailed);
    }

    setPapers(result.papers);
  }, [t.loadFailed]);

  const loadPaper = useCallback(
    async (paperId: string) => {
      const response = await fetch(`/api/exam/papers/${paperId}`, { cache: "no-store" });
      const result = (await response.json()) as { paper?: ExamPaper; error?: string };
      if (!response.ok || !result.paper) {
        throw new Error(result.error ?? t.loadFailed);
      }

      setSelectedPaper(result.paper);
      setSelectedQuestionId((current) => current ?? result.paper?.questions?.[0]?.id ?? null);
      setPaperDraft({
        title: result.paper.title,
        description: result.paper.description ?? "",
        defaultOptions: result.paper.defaultOptions,
      });
      setSavedQuestionFingerprints(
        Object.fromEntries(
          result.paper.questions?.map((question) => [question.id, questionFingerprint(question)]) ?? [],
        ),
      );
    },
    [t.loadFailed],
  );

  const loadAttempts = useCallback(
    async (paperId: string) => {
      const response = await fetch(`/api/exam/papers/${paperId}/attempts`, { cache: "no-store" });
      const result = (await response.json()) as { attempts?: ExamAttemptSummary[]; error?: string };
      if (!response.ok || !result.attempts) {
        throw new Error(result.error ?? t.loadFailed);
      }

      setAttempts(result.attempts);
    },
    [t.loadFailed],
  );

  const loadAttempt = useCallback(
    async (attemptId: string) => {
      const response = await fetch(`/api/exam/attempts/${attemptId}`, { cache: "no-store" });
      const result = (await response.json()) as { attempt?: ExamAttempt; error?: string };
      if (!response.ok || !result.attempt) {
        throw new Error(result.error ?? t.loadFailed);
      }

      setAttempt(result.attempt);
      setAttemptPageIndex(0);
      setWrongOnly(false);
      setIsMaskHidden(false);
      setAnswers(
        Object.fromEntries(
          result.attempt.answers
            .filter((answer) => answer.userAnswers.length > 0)
            .map((answer) => [answer.questionId, answer.userAnswers]),
        ),
      );
    },
    [t.loadFailed],
  );

  const loadImages = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(imagePage),
      pageSize: "24",
    });
    if (imageQuery.trim()) {
      params.set("q", imageQuery.trim());
    }
    if (selectedIndexId) {
      params.set("indexId", selectedIndexId);
    }

    const response = await fetch(`/api/images?${params.toString()}`, { cache: "no-store" });
    const result = (await response.json()) as { images?: ExamImage[]; total?: number };
    setImages(result.images ?? []);
    setImageTotal(result.total ?? 0);
  }, [imagePage, imageQuery, selectedIndexId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPapers().catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t.loadFailed),
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadPapers, t.loadFailed]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadImages();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadImages]);

  useEffect(() => {
    if (!selectedPaperId) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadAttempts(selectedPaperId).catch((loadError) =>
        setError(loadError instanceof Error ? localizedErrorMessage(loadError.message, t) : t.loadFailed),
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadAttempts, selectedPaperId, t, t.loadFailed]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAttemptPageIndex((index) => Math.min(index, Math.max(0, visibleResultAnswers.length - 1)));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [visibleResultAnswers.length]);

  useEffect(() => {
    if (!paperMenu) {
      return;
    }

    function closeMenu() {
      setPaperMenu(null);
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
  }, [paperMenu]);

  useEffect(() => {
    if (!createMenuOpen) {
      return;
    }

    function closeMenu() {
      setCreateMenuOpen(false);
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
  }, [createMenuOpen]);

  useEffect(() => {
    if (!attempt || visibleResultAnswers.length < 2) {
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
      setAttemptPageIndex((index) => {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        return (index + direction + visibleResultAnswers.length) % visibleResultAnswers.length;
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attempt, visibleResultAnswers.length]);

  async function createPaper() {
    setLoading(true);
    try {
      const response = await fetch("/api/exam/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t.untitled,
          defaultOptions,
        }),
      });
      const result = (await response.json()) as { paper?: ExamPaper };
      if (result.paper) {
        await loadPapers();
        await loadPaper(result.paper.id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function savePaper() {
    if (!selectedPaper || isLocked) {
      return;
    }

    setLoading(true);
    try {
      await fetch(`/api/exam/papers/${selectedPaper.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: paperDraft.title,
          description: paperDraft.description,
          defaultOptions: normalizeOptions(paperDraft.defaultOptions),
        }),
      });
      await loadPapers();
      await loadPaper(selectedPaper.id);
    } finally {
      setLoading(false);
    }
  }

  async function copyPaper(paper: ExamPaper) {
    setPaperMenu(null);
    setLoading(true);
    try {
      const response = await fetch(`/api/exam/papers/${paper.id}/copy`, {
        method: "POST",
      });
      const result = await readJsonResult<{ paper?: ExamPaper }>(response);
      if (!response.ok || !result.paper) {
        setNoticeDialog({
          title: t.errorTitle,
          message: localizedErrorMessage(result.error, t),
          items: [],
        });
        return;
      }

      await loadPapers();
      await loadPaper(result.paper.id);
      setSelectedQuestionId(result.paper.questions?.[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function exportPaper(paper: ExamPaper) {
    setPaperMenu(null);
    const response = await fetch(`/api/exam/papers/${paper.id}/export`, { cache: "no-store" });
    if (!response.ok) {
      const result = await readJsonResult<{ error?: string }>(response);
      setNoticeDialog({
        title: t.errorTitle,
        message: localizedErrorMessage(result.error, t),
        items: [],
      });
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      fileNameFromContentDisposition(response.headers.get("Content-Disposition")) ||
      `${paper.title}.exam-paper.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importPaper(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    setLoading(true);
    try {
      const response = await fetch("/api/exam/papers/import", {
        method: "POST",
        body: formData,
      });
      const result = await readJsonResult<{
        paper?: ExamPaper;
        missingImages?: Array<{ imageHash: string; imageOriginalName: string; indexPath: string | null }>;
      }>(response);
      if (!response.ok || !result.paper) {
        setNoticeDialog({
          title: t.errorTitle,
          message: localizedErrorMessage(result.error, t),
          items:
            result.missingImages
              ?.slice(0, 12)
              .map(
                (image) =>
                  `${image.imageOriginalName} / ${image.indexPath ?? image.imageHash.slice(0, 12)}`,
              ) ?? [],
        });
        return;
      }

      await loadPapers();
      await loadPaper(result.paper.id);
      setSelectedQuestionId(result.paper.questions?.[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function addImage(image: ExamImage) {
    if (!selectedPaper || isLocked) {
      return;
    }

    const response = await fetch(`/api/exam/papers/${selectedPaper.id}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chartImageId: image.id }),
    });
    const result = (await response.json()) as { question?: ExamQuestion; error?: string };
    if (!response.ok || !result.question) {
      setNoticeDialog({
        title: t.errorTitle,
        message: localizedErrorMessage(result.error, t),
        items: [],
      });
      return;
    }

    await loadPaper(selectedPaper.id);
    setSelectedQuestionId(result.question.id);
  }

  function hasExamImageDrag(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes(examImageDragType);
  }

  function startImageDrag(event: DragEvent<HTMLElement>, image: ExamImage) {
    if (!canDropImage) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(examImageDragType, image.id);
    event.dataTransfer.setData("text/plain", image.id);
    setDraggedImageId(image.id);
  }

  function finishImageDrag() {
    setDraggedImageId(null);
    setIsDropTargetActive(false);
  }

  function handleImageDropTargetDragEnter(event: DragEvent<HTMLElement>) {
    if (!canDropImage || !hasExamImageDrag(event)) {
      return;
    }

    event.preventDefault();
    setIsDropTargetActive(true);
  }

  function handleImageDropTargetDragOver(event: DragEvent<HTMLElement>) {
    if (!canDropImage || !hasExamImageDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTargetActive(true);
  }

  function handleImageDropTargetDragLeave(event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDropTargetActive(false);
  }

  async function handleImageDrop(event: DragEvent<HTMLElement>) {
    if (!canDropImage || !hasExamImageDrag(event)) {
      return;
    }

    event.preventDefault();
    setIsDropTargetActive(false);
    const imageId = event.dataTransfer.getData(examImageDragType);
    const image = images.find((candidate) => candidate.id === imageId);
    if (!image) {
      return;
    }

    await addImage(image);
    setDraggedImageId(null);
  }

  async function saveQuestion(question: ExamQuestion) {
    if (isLocked) {
      return;
    }

    const options = normalizeOptions(question.options);
    const correctOptions = normalizeSelectedOptions(options, question.correctOptions, question.questionType);
    const missing = missingQuestionFields({ ...question, options, correctOptions }, t);
    const hadChanges = savedQuestionFingerprints[question.id] !== questionFingerprint(question);
    const wasReady = question.status === "READY";
    const response = await fetch(`/api/exam/questions/${question.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...question,
        options,
        correctOptions:
          correctOptions.length > 0
            ? correctOptions
            : question.questionType === "SINGLE" && options.length > 0
              ? [options[0]]
              : [],
      }),
    });
    const result = await readJsonResult<{ error?: string }>(response);
    if (!response.ok) {
      setNoticeDialog({
        title: t.errorTitle,
        message: localizedErrorMessage(result.error, t),
        items: [],
      });
      return;
    }

    if (selectedPaper) {
      await loadPaper(selectedPaper.id);
    }

    if (missing.length > 0) {
      setNoticeDialog({
        title: t.questionDraftTitle,
        message: t.questionDraftMessage,
        items: missing,
      });
    } else if (wasReady && hadChanges) {
      setNoticeDialog({
        title: t.questionSavedTitle,
        message: t.questionSavedMessage,
        items: [],
        tone: "success",
      });
    }
  }

  async function removeQuestion(questionId: string) {
    if (!selectedPaper || isLocked) {
      return;
    }

    await fetch(`/api/exam/questions/${questionId}`, { method: "DELETE" });
    await loadPaper(selectedPaper.id);
    setSelectedQuestionId(null);
  }

  async function deletePaper() {
    if (!selectedPaper) {
      return;
    }

    const paperId = selectedPaper.id;
    const response = await fetch(`/api/exam/papers/${paperId}`, { method: "DELETE" });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setNoticeDialog({
        title: t.errorTitle,
        message: localizedErrorMessage(result.error, t),
        items: [],
      });
      return;
    }

    setSelectedPaper(null);
    setSelectedQuestionId(null);
    setPaperDraft({
      title: "",
      description: "",
      defaultOptions,
    });
    await loadPapers();
  }

  async function publishPaper() {
    if (!selectedPaper) {
      return;
    }

    const response = await fetch(`/api/exam/papers/${selectedPaper.id}/publish`, { method: "POST" });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setNoticeDialog({
        title: t.errorTitle,
        message: localizedErrorMessage(result.error, t),
        items: [],
      });
      return;
    }

    await loadPapers();
    await loadPaper(selectedPaper.id);
  }

  function requestPublishPaper() {
    if (!selectedPaper) {
      return;
    }

    setConfirmDialog({
      kind: "publish",
      title: t.publishConfirmTitle,
      message: t.publishConfirmMessage,
      confirmLabel: t.publish,
    });
  }

  function requestDeletePaper() {
    if (!selectedPaper) {
      return;
    }

    setConfirmDialog({
      kind: "delete-paper",
      title: t.deletePaperConfirmTitle,
      message:
        selectedPaper.status === "PUBLISHED"
          ? t.deletePublishedPaperConfirmMessage
          : t.deleteDraftPaperConfirmMessage,
      confirmLabel: t.confirmDelete,
    });
  }

  async function confirmDialogAction() {
    const action = confirmDialog?.kind;
    setConfirmDialog(null);

    if (action === "publish") {
      await publishPaper();
      return;
    }

    if (action === "delete-paper") {
      await deletePaper();
    }
  }

  async function startExam(paperId: string) {
    const response = await fetch("/api/exam/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId }),
    });
    const result = (await response.json()) as { attempt?: ExamAttempt; error?: string };
    if (!response.ok || !result.attempt) {
      setNoticeDialog({
        title: t.errorTitle,
        message: localizedErrorMessage(result.error, t),
        items: [],
      });
      return;
    }

    setAttempt(result.attempt);
    setAttemptPageIndex(0);
    setAnswers({});
    setWrongOnly(false);
    setIsMaskHidden(false);
    await loadPapers();
    await loadAttempts(paperId);
  }

  async function submitExam() {
    if (!attempt) {
      return;
    }

    const response = await fetch(`/api/exam/attempts/${attempt.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const result = (await response.json()) as { attempt?: ExamAttempt; error?: string };
    if (!response.ok || !result.attempt) {
      setNoticeDialog({
        title: t.errorTitle,
        message: localizedErrorMessage(result.error, t),
        items: [],
      });
      return;
    }

    setAttempt(result.attempt);
    await loadPapers();
    await loadAttempts(result.attempt.paperId);
  }

  function selectAdjacentAttemptAnswer(direction: -1 | 1) {
    if (visibleResultAnswers.length < 2) {
      return;
    }

    setAttemptPageIndex(
      (index) => (index + direction + visibleResultAnswers.length) % visibleResultAnswers.length,
    );
  }

  function patchQuestion(questionId: string, patch: Partial<ExamQuestion>) {
    setSelectedPaper((current) =>
      current
        ? {
            ...current,
            questions: current.questions?.map((question) =>
              question.id === questionId ? { ...question, ...patch } : question,
            ),
          }
        : current,
    );
  }

  function patchAttemptAnswer(question: ExamQuestion, option: string, checked: boolean) {
    setAnswers((current) => {
      const currentAnswer = current[question.id] ?? [];
      const nextAnswer =
        question.questionType === "SINGLE"
          ? [option]
          : checked
            ? normalizeSelectedOptions(question.options, [...currentAnswer, option], "MULTIPLE")
            : currentAnswer.filter((item) => item !== option);

      if (nextAnswer.length === 0) {
        const rest = { ...current };
        delete rest[question.id];
        return rest;
      }

      return { ...current, [question.id]: nextAnswer };
    });
  }

  const imageDropTargetHandlers = {
    onDragEnter: handleImageDropTargetDragEnter,
    onDragOver: handleImageDropTargetDragOver,
    onDragLeave: handleImageDropTargetDragLeave,
    onDrop: (event: DragEvent<HTMLElement>) => void handleImageDrop(event),
  };
  const imageDropTargetClass =
    canDropImage && isDropTargetActive ? "ring-2 ring-cyan-500 ring-offset-2 ring-offset-zinc-50" : "";

  if (attempt) {
    return (
      <div className="space-y-3">
        {currentAttemptAnswer ? (
          <div key={currentAttemptAnswer.id} className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-zinc-100 pb-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className="max-w-48 shrink-0 truncate text-sm font-semibold"
                  title={attempt.paper?.title ?? t.title}
                >
                  {attempt.paper?.title ?? t.title}
                </span>
                <span className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600">
                  {attemptCurrentPageIndex + 1}/{visibleResultAnswers.length}
                </span>
                {attempt.status === "SUBMITTED" ? (
                  <span
                    className={`inline-flex h-6 shrink-0 items-center rounded border px-2 text-xs font-medium ${
                      currentAttemptAnswer.isCorrect
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {currentAttemptAnswer.isCorrect ? "OK" : "Wrong"}
                  </span>
                ) : null}
                <span className="min-w-0 truncate text-sm text-zinc-700" title={currentAttemptAnswer.question.prompt}>
                  {currentAttemptAnswer.question.prompt}
                </span>
                {attempt.status === "SUBMITTED" ? (
                  <>
                    <span className="shrink-0 text-xs text-zinc-300">/</span>
                    <span
                      className="max-w-40 shrink-0 truncate text-xs text-zinc-500"
                      title={currentAttemptAnswer.question.image.originalName}
                    >
                      {currentAttemptAnswer.question.image.originalName}
                    </span>
                  </>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2">
                {attempt.status === "SUBMITTED" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsMaskHidden((current) => !current)}
                      className={`inline-flex h-8 items-center gap-2 rounded-md border px-2 text-xs font-medium ${
                        isMaskHidden
                          ? "border-cyan-200 bg-cyan-50 text-cyan-800"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {isMaskHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      {isMaskHidden ? t.showMask : t.hideMask}
                    </button>
                    <label className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700">
                      <input
                        type="checkbox"
                        checked={wrongOnly}
                        onChange={(event) => {
                          setWrongOnly(event.target.checked);
                          setAttemptPageIndex(0);
                        }}
                        className="h-4 w-4 accent-zinc-950"
                      />
                      {t.wrongOnly}
                    </label>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => selectAdjacentAttemptAnswer(-1)}
                  disabled={visibleResultAnswers.length < 2}
                  className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  title={t.previousQuestionShortcut}
                  aria-label={t.previousQuestion}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => selectAdjacentAttemptAnswer(1)}
                  disabled={visibleResultAnswers.length < 2}
                  className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  title={t.nextQuestionShortcut}
                  aria-label={t.nextQuestion}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAttempt(null);
                    setIsMaskHidden(false);
                  }}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {t.backToPapers}
                </button>
                {attempt.status === "IN_PROGRESS" ? (
                  <button
                    type="button"
                    onClick={() => void submitExam()}
                    className="inline-flex h-8 items-center gap-2 rounded-md bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {t.submitExam}
                  </button>
                ) : null}
              </div>
            </div>
            <MaskedImage
              image={currentAttemptAnswer.question.image}
              rects={attempt.status === "SUBMITTED" && isMaskHidden ? [] : currentAttemptAnswer.question.maskRects}
              zoomable
              zoom={attemptImageZoom}
              altText={attempt.status === "IN_PROGRESS" ? t.examImage : undefined}
              onZoomChange={setAttemptImageZoom}
              zoomLabels={{
                zoomIn: t.zoomIn,
                zoomOut: t.zoomOut,
                resetZoom: t.resetZoom,
                resizeImageWindow: t.resizeImageWindow,
              }}
            />
            {attempt.status === "SUBMITTED" ? (
              <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div className="rounded-md border border-zinc-200 bg-white p-3">
                  <p className="text-xs text-zinc-500">{t.accuracy}</p>
                  <p className="mt-1 text-xl font-semibold">{percent(attempt.accuracy)}</p>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs text-emerald-700">{t.correctCount}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {attempt.correctCount}/{attempt.totalCount}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {currentAttemptAnswer.question.options.map((option) => {
                const selectedOptions =
                  attempt.status === "SUBMITTED"
                    ? currentAttemptAnswer.userAnswers
                    : answers[currentAttemptAnswer.questionId] ?? [];
                const checked = selectedOptions.includes(option);

                return (
                  <label
                    key={option}
                    className={`flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm ${
                      checked ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 bg-white"
                    } ${attempt.status === "SUBMITTED" ? "cursor-default" : "cursor-pointer hover:bg-zinc-50"}`}
                  >
                    <input
                      type={currentAttemptAnswer.question.questionType === "MULTIPLE" ? "checkbox" : "radio"}
                      name={currentAttemptAnswer.questionId}
                      value={option}
                      disabled={attempt.status === "SUBMITTED"}
                      checked={checked}
                      onChange={(event) =>
                        patchAttemptAnswer(currentAttemptAnswer.question, option, event.target.checked)
                      }
                      className="h-4 w-4 accent-zinc-950"
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </div>
            {attempt.status === "SUBMITTED" ? (
              <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6">
                <p>
                  {t.yourAnswer}: <strong>{formatSelectedOptions(currentAttemptAnswer.userAnswers)}</strong> /{" "}
                  {t.correctAnswer}:{" "}
                  <strong>{formatSelectedOptions(currentAttemptAnswer.question.correctOptions)}</strong>
                </p>
                {currentAttemptAnswer.question.explanation ? (
                  <p className="mt-1 text-zinc-600">{currentAttemptAnswer.question.explanation}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <aside
        {...imageDropTargetHandlers}
        className={`rounded-md border border-zinc-200 bg-white transition ${imageDropTargetClass}`}
      >
        <div className="border-b border-zinc-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t.title}</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{t.subtitle}</p>
            </div>
            <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                onClick={() => setCreateMenuOpen((open) => !open)}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1 rounded-md bg-zinc-950 px-2.5 text-white hover:bg-zinc-800 disabled:opacity-60"
                title={t.newPaper}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {createMenuOpen ? (
                <div className="absolute right-0 top-11 z-40 w-44 rounded-md border border-zinc-200 bg-white p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      void createPaper();
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <Plus className="h-4 w-4" />
                    {t.createPaper}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      importPaperInputRef.current?.click();
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <Upload className="h-4 w-4" />
                    {t.importPaper}
                  </button>
                </div>
              ) : null}
              <input
                ref={importPaperInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    void importPaper(file);
                  }
                }}
              />
            </div>
          </div>
        </div>
        <div className="max-h-[calc(100vh-190px)] overflow-auto p-2">
          {error ? (
            <p className="m-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>
          ) : null}
          {papers.length === 0 ? <p className="p-4 text-sm text-zinc-500">{t.noPapers}</p> : null}
          {papers.map((paper) => (
            <button
              type="button"
              key={paper.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setPaperMenu({ paper, x: event.clientX, y: event.clientY });
              }}
              onClick={() => {
                setPaperMenu(null);
                setAttempt(null);
                setIsMaskHidden(false);
                setSelectedQuestionId(null);
                void loadPaper(paper.id);
              }}
              className={`mb-2 w-full rounded-md border p-3 text-left text-sm transition hover:bg-zinc-50 ${
                selectedPaper?.id === paper.id ? "border-zinc-950" : "border-zinc-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-semibold">{paper.title}</p>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${
                    paper.status === "PUBLISHED"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {paper.status === "PUBLISHED" ? t.published : t.draft}
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {paper.questionCount} {t.questions} / {paper.attemptCount} {t.attempts}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section
        {...imageDropTargetHandlers}
        className={`min-w-0 space-y-4 rounded-md transition ${imageDropTargetClass}`}
      >
        {selectedPaper ? (
          <>
            <div className="rounded-md border border-zinc-200 bg-white p-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.title}</span>
                  <input
                    value={paperDraft.title}
                    disabled={isLocked}
                    onChange={(event) => setPaperDraft((draft) => ({ ...draft, title: event.target.value }))}
                    className="h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
                  />
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  {selectedPaper.status === "PUBLISHED" ? (
                    <button
                      type="button"
                      onClick={() => void startExam(selectedPaper.id)}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                      <ClipboardList className="h-4 w-4" />
                      {t.startExam}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void savePaper()}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {t.savePaper}
                      </button>
                      <button
                        type="button"
                        onClick={requestPublishPaper}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
                      >
                        <Send className="h-4 w-4" />
                        {t.publish}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={requestDeletePaper}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-700 hover:bg-rose-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t.deletePaper}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 2xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.description}</span>
                  <textarea
                    value={paperDraft.description}
                    disabled={isLocked}
                    onChange={(event) => setPaperDraft((draft) => ({ ...draft, description: event.target.value }))}
                    className="min-h-20 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
                  />
                </label>
                <OptionsEditor
                  label={t.defaultOptions}
                  options={paperDraft.defaultOptions}
                  locked={isLocked}
                  t={t}
                  onChange={(defaultOptions) => setPaperDraft((draft) => ({ ...draft, defaultOptions }))}
                />
              </div>
              {isLocked ? <p className="mt-3 text-xs text-zinc-500">{t.locked}</p> : null}
            </div>

            {selectedPaper.status === "PUBLISHED" ? (
              <div className="rounded-md border border-zinc-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{t.attemptHistory}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {attempts.length} {t.attempts}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAttempts(selectedPaper.id)}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    {t.refreshAttempts}
                  </button>
                </div>
                {attempts.length === 0 ? (
                  <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
                    {t.noAttempts}
                  </p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {attempts.map((attemptItem) => (
                      <button
                        type="button"
                        key={attemptItem.id}
                        onClick={() =>
                          void loadAttempt(attemptItem.id).catch((loadError) =>
                            setNoticeDialog({
                              title: t.errorTitle,
                              message:
                                loadError instanceof Error
                                  ? localizedErrorMessage(loadError.message, t)
                                  : t.loadFailed,
                              items: [],
                            }),
                          )
                        }
                        className="rounded-md border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-950 hover:bg-zinc-50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold">
                            {attemptItem.status === "SUBMITTED"
                              ? formatDateTime(attemptItem.submittedAt, locale)
                              : t.attemptInProgress}
                          </span>
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                              attemptItem.status === "SUBMITTED"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {attemptItem.status === "SUBMITTED" ? percent(attemptItem.accuracy) : t.attemptInProgress}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                          <span>
                            {attemptItem.correctCount}/{attemptItem.totalCount}
                          </span>
                          <span>
                            {t.duration}: {formatDuration(attemptItem.durationSeconds)}
                          </span>
                          <span>
                            {t.submittedAt}: {formatDateTime(attemptItem.submittedAt ?? attemptItem.startedAt, locale)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-medium text-zinc-700">
                          {attemptItem.status === "SUBMITTED" ? t.viewAttempt : t.continueExam}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-4 2xl:grid-cols-[220px_minmax(0,1fr)]">
              <div className="rounded-md border border-zinc-200 bg-white p-2">
                {selectedPaper.questions?.length ? null : (
                  <p className="p-3 text-sm text-zinc-500">{t.noQuestions}</p>
                )}
                {selectedPaper.questions?.map((question, index) => (
                  <button
                    type="button"
                    key={question.id}
                    onClick={() => setSelectedQuestionId(question.id)}
                    className={`mb-2 w-full rounded-md border p-3 text-left text-sm hover:bg-zinc-50 ${
                      selectedQuestionId === question.id ? "border-zinc-950" : "border-zinc-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">#{index + 1}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] ${
                          question.status === "READY"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {question.status === "READY" ? t.ready : t.notReady}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-xs text-zinc-500">{question.image.originalName}</p>
                  </button>
                ))}
              </div>

              {selectedQuestion ? (
                <QuestionEditor
                  key={selectedQuestion.id}
                  question={selectedQuestion}
                  locked={isLocked}
                  t={t}
                  imageZoom={editorImageZoom}
                  onPatch={(patch) => patchQuestion(selectedQuestion.id, patch)}
                  onSave={() => void saveQuestion(selectedQuestion)}
                  onRemove={() => void removeQuestion(selectedQuestion.id)}
                  onImageZoomChange={setEditorImageZoom}
                />
              ) : (
                <div className="grid min-h-80 place-items-center rounded-md border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                  {t.noQuestions}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="grid min-h-96 place-items-center rounded-md border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
            {t.noPapers}
          </div>
        )}
      </section>

      <aside className="rounded-md border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={imageQuery}
              onChange={(event) => {
                setImageQuery(event.target.value);
                setImagePage(1);
              }}
              className="h-9 w-full rounded-md border border-zinc-200 pl-9 pr-3 text-sm outline-none focus:border-zinc-500"
              placeholder={t.imageSearch}
            />
          </div>
        </div>
        <div className="max-h-[calc(100vh-250px)] overflow-auto p-3">
          <div className="grid grid-cols-2 gap-3">
            {images.map((image) => (
              <div
                role="listitem"
                key={image.id}
                draggable={canDropImage}
                onDragStart={(event) => startImageDrag(event, image)}
                onDragEnd={finishImageDrag}
                aria-label={`${t.dragImageToPaper}: ${image.title ?? image.originalName}`}
                title={t.dragImageToPaper}
                className={`overflow-hidden rounded-md border bg-white text-left transition ${
                  canDropImage
                    ? "cursor-grab border-zinc-200 hover:border-zinc-950 active:cursor-grabbing"
                    : "cursor-not-allowed border-zinc-200 opacity-50"
                } ${draggedImageId === image.id ? "border-cyan-500 ring-2 ring-cyan-200" : ""}`}
              >
                <div className="aspect-[4/3] bg-zinc-100">
                  <img
                    src={`/api/images/${image.id}/file`}
                    alt={image.title ?? image.originalName}
                    className="h-full w-full object-contain"
                    loading="lazy"
                    draggable={false}
                  />
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-semibold">{image.title ?? image.originalName}</p>
                  <p className="mt-1 truncate text-[11px] text-zinc-500">
                    {isDropTargetActive && draggedImageId === image.id ? t.dropImageToPaper : t.addImage}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 p-3 text-xs text-zinc-500">
          <button
            type="button"
            onClick={() => setImagePage((page) => Math.max(1, page - 1))}
            disabled={imagePage <= 1}
            className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            title={t.previousPage}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>
            {imagePage}/{imageTotalPages}
          </span>
          <button
            type="button"
            onClick={() => setImagePage((page) => Math.min(imageTotalPages, page + 1))}
            disabled={imagePage >= imageTotalPages}
            className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            title={t.nextPage}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </div>
    {paperMenu ? (
      <div
        className="fixed z-50 w-44 rounded-md border border-zinc-200 bg-white p-1 shadow-xl"
        style={{ left: paperMenu.x, top: paperMenu.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button
          type="button"
          onClick={() => void copyPaper(paperMenu.paper)}
          className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
        >
          <Copy className="h-4 w-4" />
          {t.copyPaper}
        </button>
        {paperMenu.paper.status === "PUBLISHED" ? (
          <button
            type="button"
            onClick={() => void exportPaper(paperMenu.paper)}
            className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <Download className="h-4 w-4" />
            {t.exportPaper}
          </button>
        ) : null}
      </div>
    ) : null}
    {confirmDialog ? (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/50 p-6"
        role="dialog"
        aria-modal="true"
        onClick={() => setConfirmDialog(null)}
      >
        <div
          className="w-full max-w-md rounded-md border border-zinc-200 bg-white p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border ${
                confirmDialog.kind === "delete-paper"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-cyan-200 bg-cyan-50 text-cyan-700"
              }`}
            >
              {confirmDialog.kind === "delete-paper" ? (
                <Trash2 className="h-5 w-5" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-zinc-950">{confirmDialog.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{confirmDialog.message}</p>
              {selectedPaper ? (
                <p className="mt-3 truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  {selectedPaper.title}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDialog(null)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => void confirmDialogAction()}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-white ${
                confirmDialog.kind === "delete-paper"
                  ? "bg-rose-700 hover:bg-rose-800"
                  : "bg-zinc-950 hover:bg-zinc-800"
              }`}
            >
              {confirmDialog.kind === "delete-paper" ? (
                <Trash2 className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {confirmDialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {noticeDialog ? (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/50 p-6"
        role="dialog"
        aria-modal="true"
        onClick={() => setNoticeDialog(null)}
      >
        <div
          className="w-full max-w-md rounded-md border border-zinc-200 bg-white p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border ${
                noticeDialog.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {noticeDialog.tone === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-zinc-950">{noticeDialog.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{noticeDialog.message}</p>
              {noticeDialog.items.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {noticeDialog.items.map((item) => (
                    <span
                      key={item}
                      className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium ${
                        noticeDialog.tone === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setNoticeDialog(null)}
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              {t.gotIt}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function QuestionEditor({
  question,
  locked,
  t,
  imageZoom,
  onPatch,
  onSave,
  onRemove,
  onImageZoomChange,
}: {
  question: ExamQuestion;
  locked: boolean;
  t: (typeof copy)["zh"];
  imageZoom: number;
  onPatch: (patch: Partial<ExamQuestion>) => void;
  onSave: () => void;
  onRemove: () => void;
  onImageZoomChange: (zoom: number) => void;
}) {
  const [selectedMaskIndex, setSelectedMaskIndex] = useState(Math.max(0, question.maskRects.length - 1));
  const activeMaskIndex =
    question.maskRects.length > 0 ? clamp(selectedMaskIndex, 0, question.maskRects.length - 1) : -1;
  const activeMaskColor =
    activeMaskIndex >= 0 ? question.maskRects[activeMaskIndex]?.color ?? defaultMaskColor : defaultMaskColor;

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{question.image.title ?? question.image.originalName}</p>
          <p className="mt-1 text-xs text-zinc-500">{t.drawHint}</p>
        </div>
        {!locked ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSave}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
            >
              <CheckCircle2 className="h-4 w-4" />
              {t.saveQuestion}
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="grid h-9 w-9 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              title={t.removeQuestion}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <MaskedImage
        image={question.image}
        rects={question.maskRects}
        editable={!locked}
        zoomable
        zoom={imageZoom}
        zoomLabels={{
          zoomIn: t.zoomIn,
          zoomOut: t.zoomOut,
          resetZoom: t.resetZoom,
          resizeImageWindow: t.resizeImageWindow,
        }}
        color={activeMaskColor}
        selectedIndex={activeMaskIndex}
        onSelect={setSelectedMaskIndex}
        onZoomChange={onImageZoomChange}
        onChange={(maskRects) => onPatch({ maskRects })}
      />
      {!locked ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700">
            <span>{t.maskColor}</span>
            <input
              type="color"
              value={activeMaskColor}
              onChange={(event) => {
                const color = event.target.value;
                onPatch({
                  maskRects:
                    question.maskRects.length > 0
                      ? question.maskRects.map((rect, index) =>
                          index === activeMaskIndex ? { ...rect, color } : rect,
                        )
                      : [{ x: 0.5, y: 0, width: 0.5, height: 1, color }],
                });
                if (question.maskRects.length === 0) {
                  setSelectedMaskIndex(0);
                }
              }}
              className="h-5 w-8 cursor-pointer rounded border border-zinc-200 bg-transparent p-0"
              aria-label={t.maskColor}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onPatch({ maskRects: question.maskRects.slice(0, -1) });
              setSelectedMaskIndex((index) => Math.max(0, index - 1));
            }}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <X className="h-3.5 w-3.5" />
            {t.undoMask}
          </button>
          <button
            type="button"
            onClick={() => {
              onPatch({ maskRects: [] });
              setSelectedMaskIndex(-1);
            }}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {t.clearMask}
          </button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 2xl:grid-cols-2">
        <label className="2xl:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t.prompt}</span>
          <input
            value={question.prompt}
            disabled={locked}
            onChange={(event) => onPatch({ prompt: event.target.value })}
            className="h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
          />
        </label>
        <OptionsEditor
          label={t.options}
          options={question.options}
          locked={locked}
          t={t}
          onChange={(options) => {
            const normalizedCorrectOptions = normalizeSelectedOptions(
              options,
              question.correctOptions,
              question.questionType,
            );
            onPatch({
              options,
              correctOption: question.questionType === "SINGLE" ? (normalizedCorrectOptions[0] ?? null) : null,
              correctOptions: normalizedCorrectOptions,
            });
          }}
        />
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-500">{t.questionType}</span>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1">
              {(["SINGLE", "MULTIPLE"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    const correctOptions = normalizeSelectedOptions(
                      question.options,
                      question.correctOptions,
                      type,
                    );
                    onPatch({
                      questionType: type,
                      correctOptions,
                      correctOption: type === "SINGLE" ? (correctOptions[0] ?? null) : null,
                    });
                  }}
                  className={`h-9 rounded text-xs font-medium transition disabled:cursor-not-allowed ${
                    question.questionType === type
                      ? "bg-zinc-950 text-white"
                      : "text-zinc-600 hover:bg-white disabled:hover:bg-transparent"
                  }`}
                >
                  {type === "SINGLE" ? t.singleChoice : t.multipleChoice}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className="mb-1 block text-xs font-medium text-zinc-500">{t.correct}</span>
            {question.questionType === "SINGLE" ? (
              <select
                value={question.correctOptions[0] ?? question.correctOption ?? ""}
                disabled={locked}
                onChange={(event) =>
                  onPatch({
                    correctOption: event.target.value || null,
                    correctOptions: event.target.value ? [event.target.value] : [],
                  })
                }
                className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
              >
                <option value="">-</option>
                {question.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                {question.options.map((option) => {
                  const checked = question.correctOptions.includes(option);
                  return (
                    <label
                      key={option}
                      className="flex min-h-9 items-center gap-2 rounded-md bg-white px-2 text-sm text-zinc-700"
                    >
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={checked}
                        onChange={(event) => {
                          const correctOptions = event.target.checked
                            ? normalizeSelectedOptions(
                                question.options,
                                [...question.correctOptions, option],
                                "MULTIPLE",
                              )
                            : question.correctOptions.filter((item) => item !== option);
                          onPatch({ correctOption: null, correctOptions });
                        }}
                        className="h-4 w-4 accent-zinc-950"
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-zinc-500">{t.explanationOptional}</span>
            <textarea
              value={question.explanation}
              disabled={locked}
              placeholder={t.explanationPlaceholder}
              onChange={(event) => onPatch({ explanation: event.target.value })}
              className="min-h-20 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
            />
          </label>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
        <Eye className="h-3.5 w-3.5" />
        {t.mask}: {question.maskRects.length}
      </div>
    </div>
  );
}
