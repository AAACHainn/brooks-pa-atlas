"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  Loader2,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Locale = "zh" | "en";

export type ExamIndexOption = {
  id: string;
  name: string;
  path: string;
  depth: number;
};

type MaskRect = { x: number; y: number; width: number; height: number; color?: string };
type MaskResizeHandle = "nw" | "ne" | "sw" | "se";
type MaskDragState =
  | { kind: "draw"; start: { x: number; y: number } }
  | { kind: "move"; index: number; start: { x: number; y: number }; original: MaskRect }
  | { kind: "resize"; index: number; handle: MaskResizeHandle; original: MaskRect };

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
  prompt: string;
  options: string[];
  correctOption: string | null;
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

type ConfirmDialogState =
  | { kind: "publish"; title: string; message: string; confirmLabel: string }
  | { kind: "delete-paper"; title: string; message: string; confirmLabel: string };

const copy = {
  zh: {
    title: "考试模式",
    subtitle: "用现有图库制作试卷，遮住图表后半段进行价格行为测试。",
    newPaper: "新建试卷",
    untitled: "未命名试卷",
    description: "描述",
    defaultOptions: "默认选项模板",
    savePaper: "保存试卷",
    deletePaper: "删除试卷",
    publish: "发布",
    published: "已发布",
    draft: "草稿",
    questions: "题目",
    attempts: "考试记录",
    addImage: "加入试卷",
    imageSearch: "搜索图片",
    allIndexes: "全部索引",
    previousPage: "上一页",
    nextPage: "下一页",
    prompt: "题干",
    options: "选项",
    correct: "正确答案",
    explanation: "解析",
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
    submitExam: "提交答案",
    result: "考试结果",
    accuracy: "正确率",
    correctCount: "正确题数",
    wrongOnly: "只看错题",
    backToPapers: "返回试卷",
    yourAnswer: "你的答案",
    correctAnswer: "正确答案",
    noPapers: "暂无试卷",
    noQuestions: "先从右侧图片库选择图片加入试卷。",
    locked: "发布后内容已锁定。",
    loadFailed: "加载失败，请稍后重试。",
    publishFailed: "发布失败：请确认每道题都有题干、选项、正确答案、解析和遮罩。",
    cancel: "取消",
    publishConfirmTitle: "发布这套试卷？",
    publishConfirmMessage: "发布后试卷和题目内容会锁定，可用于考试。",
    deletePaperConfirmTitle: "删除这套试卷？",
    deleteDraftPaperConfirmMessage: "此操作会删除试卷草稿和其中所有题目，无法撤销。",
    deletePublishedPaperConfirmMessage: "此操作会删除已发布试卷、题目和相关考试记录，无法撤销。",
    confirmDelete: "确认删除",
  },
  en: {
    title: "Exam Mode",
    subtitle: "Build papers from the existing chart library and mask future price action.",
    newPaper: "New paper",
    untitled: "Untitled paper",
    description: "Description",
    defaultOptions: "Default options",
    savePaper: "Save paper",
    deletePaper: "Delete paper",
    publish: "Publish",
    published: "Published",
    draft: "Draft",
    questions: "Questions",
    attempts: "Attempts",
    addImage: "Add to paper",
    imageSearch: "Search images",
    allIndexes: "All indexes",
    previousPage: "Previous",
    nextPage: "Next",
    prompt: "Prompt",
    options: "Options",
    correct: "Correct answer",
    explanation: "Explanation",
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
    submitExam: "Submit",
    result: "Result",
    accuracy: "Accuracy",
    correctCount: "Correct",
    wrongOnly: "Wrong only",
    backToPapers: "Back",
    yourAnswer: "Your answer",
    correctAnswer: "Correct answer",
    noPapers: "No papers yet",
    noQuestions: "Choose images from the library on the right.",
    locked: "Published content is locked.",
    loadFailed: "Load failed. Please try again.",
    publishFailed: "Publish failed. Make every question ready first.",
    cancel: "Cancel",
    publishConfirmTitle: "Publish this paper?",
    publishConfirmMessage: "After publishing, the paper and questions are locked and can be used for exams.",
    deletePaperConfirmTitle: "Delete this paper?",
    deleteDraftPaperConfirmMessage: "This will delete the draft paper and all of its questions. It cannot be undone.",
    deletePublishedPaperConfirmMessage:
      "This will delete the published paper, questions, and related exam records. It cannot be undone.",
    confirmDelete: "Delete",
  },
};

const defaultOptions = ["上涨延续", "下跌延续", "震荡整理", "反转失败"];
const defaultMaskColor = "#000000";
const minMaskSize = 0.015;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

function optionLines(options: string[]) {
  return options.join("\n");
}

function parseOptionLines(value: string) {
  const options = value
    .split(/\r?\n/)
    .map((option) => option.trim())
    .filter(Boolean);
  return options.length >= 2 ? options.slice(0, 8) : defaultOptions;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function MaskedImage({
  image,
  rects,
  editable,
  color = defaultMaskColor,
  selectedIndex = -1,
  onSelect,
  onChange,
}: {
  image: ExamImage;
  rects: MaskRect[];
  editable?: boolean;
  color?: string;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  onChange?: (rects: MaskRect[]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<MaskDragState | null>(null);
  const [draftRect, setDraftRect] = useState<MaskRect | null>(null);

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

  return (
    <div className="overflow-auto rounded-md border border-zinc-200 bg-zinc-100 p-2">
      <div
        ref={canvasRef}
        className={`relative mx-auto w-fit max-w-full ${editable ? "cursor-crosshair" : ""}`}
        onPointerDown={startDraw}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          src={`/api/images/${image.id}/file`}
          alt={image.title ?? image.originalName}
          className="block max-h-[520px] max-w-full select-none"
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
  );
}

export default function ExamMode({ locale, indexes }: { locale: Locale; indexes: ExamIndexOption[] }) {
  const t = copy[locale];
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<ExamPaper | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [paperDraft, setPaperDraft] = useState({
    title: "",
    description: "",
    defaultOptionsText: optionLines(defaultOptions),
  });
  const [imageQuery, setImageQuery] = useState("");
  const [imageIndexId, setImageIndexId] = useState("");
  const [imagePage, setImagePage] = useState(1);
  const [imageTotal, setImageTotal] = useState(0);
  const [images, setImages] = useState<ExamImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [wrongOnly, setWrongOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const selectedQuestion = selectedPaper?.questions?.find((question) => question.id === selectedQuestionId) ?? null;
  const isLocked = selectedPaper?.status === "PUBLISHED";
  const imageTotalPages = Math.max(1, Math.ceil(imageTotal / 24));
  const visibleResultAnswers = useMemo(
    () => attempt?.answers.filter((answer) => !wrongOnly || !answer.isCorrect) ?? [],
    [attempt?.answers, wrongOnly],
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
        defaultOptionsText: optionLines(result.paper.defaultOptions),
      });
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
    if (imageIndexId) {
      params.set("indexId", imageIndexId);
    }

    const response = await fetch(`/api/images?${params.toString()}`, { cache: "no-store" });
    const result = (await response.json()) as { images?: ExamImage[]; total?: number };
    setImages(result.images ?? []);
    setImageTotal(result.total ?? 0);
  }, [imageIndexId, imagePage, imageQuery]);

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
          defaultOptions: parseOptionLines(paperDraft.defaultOptionsText),
        }),
      });
      await loadPapers();
      await loadPaper(selectedPaper.id);
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
      window.alert(result.error ?? t.loadFailed);
      return;
    }

    await loadPaper(selectedPaper.id);
    setSelectedQuestionId(result.question.id);
  }

  async function saveQuestion(question: ExamQuestion) {
    if (isLocked) {
      return;
    }

    const response = await fetch(`/api/exam/questions/${question.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(question),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      window.alert(result.error ?? t.loadFailed);
      return;
    }

    if (selectedPaper) {
      await loadPaper(selectedPaper.id);
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
      window.alert(result.error ?? t.loadFailed);
      return;
    }

    setSelectedPaper(null);
    setSelectedQuestionId(null);
    setPaperDraft({
      title: "",
      description: "",
      defaultOptionsText: optionLines(defaultOptions),
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
      window.alert(result.error ?? t.publishFailed);
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
      window.alert(result.error ?? t.loadFailed);
      return;
    }

    setAttempt(result.attempt);
    setAnswers({});
    setWrongOnly(false);
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
      window.alert(result.error ?? t.loadFailed);
      return;
    }

    setAttempt(result.attempt);
    await loadPapers();
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

  if (attempt) {
    return (
      <div className="space-y-5">
        <div className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{attempt.paper?.title ?? t.title}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {attempt.status === "SUBMITTED"
                  ? `${t.correctCount} ${attempt.correctCount}/${attempt.totalCount} / ${t.accuracy} ${percent(attempt.accuracy)}`
                  : `${attempt.totalCount} ${t.questions}`}
              </p>
            </div>
            <div className="flex gap-2">
              {attempt.status === "SUBMITTED" ? (
                <label className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700">
                  <input
                    type="checkbox"
                    checked={wrongOnly}
                    onChange={(event) => setWrongOnly(event.target.checked)}
                    className="h-4 w-4 accent-zinc-950"
                  />
                  {t.wrongOnly}
                </label>
              ) : null}
              <button
                type="button"
                onClick={() => setAttempt(null)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <ChevronLeft className="h-4 w-4" />
                {t.backToPapers}
              </button>
              {attempt.status === "IN_PROGRESS" ? (
                <button
                  type="button"
                  onClick={() => void submitExam()}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  <Send className="h-4 w-4" />
                  {t.submitExam}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {attempt.status === "SUBMITTED" ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-md border border-zinc-200 bg-white p-4">
              <p className="text-xs text-zinc-500">{t.accuracy}</p>
              <p className="mt-1 text-2xl font-semibold">{percent(attempt.accuracy)}</p>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs text-emerald-700">{t.correctCount}</p>
              <p className="mt-1 text-2xl font-semibold">
                {attempt.correctCount}/{attempt.totalCount}
              </p>
            </div>
          </div>
        ) : null}

        {visibleResultAnswers.map((answer, index) => (
          <div key={answer.id} className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  {index + 1}. {answer.question.prompt}
                </p>
                <p className="mt-1 text-xs text-zinc-500">{answer.question.image.originalName}</p>
              </div>
              {attempt.status === "SUBMITTED" ? (
                <span
                  className={`inline-flex h-7 items-center rounded border px-2 text-xs font-medium ${
                    answer.isCorrect
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {answer.isCorrect ? "OK" : "Wrong"}
                </span>
              ) : null}
            </div>
            <MaskedImage image={answer.question.image} rects={answer.question.maskRects} />
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {answer.question.options.map((option) => (
                <label
                  key={option}
                  className={`flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm ${
                    answers[answer.questionId] === option
                      ? "border-zinc-950 bg-zinc-50"
                      : "border-zinc-200 bg-white"
                  } ${attempt.status === "SUBMITTED" ? "cursor-default" : "cursor-pointer hover:bg-zinc-50"}`}
                >
                  <input
                    type="radio"
                    name={answer.questionId}
                    value={option}
                    disabled={attempt.status === "SUBMITTED"}
                    checked={
                      attempt.status === "SUBMITTED"
                        ? answer.userAnswer === option
                        : answers[answer.questionId] === option
                    }
                    onChange={() => setAnswers((current) => ({ ...current, [answer.questionId]: option }))}
                    className="h-4 w-4 accent-zinc-950"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {attempt.status === "SUBMITTED" ? (
              <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6">
                <p>
                  {t.yourAnswer}: <strong>{answer.userAnswer ?? "-"}</strong> / {t.correctAnswer}:{" "}
                  <strong>{answer.question.correctOption}</strong>
                </p>
                <p className="mt-1 text-zinc-600">{answer.question.explanation}</p>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <aside className="rounded-md border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t.title}</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{t.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => void createPaper()}
              disabled={loading}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-60"
              title={t.newPaper}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
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
              onClick={() => {
                setAttempt(null);
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

      <section className="min-w-0 space-y-4">
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
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.description}</span>
                  <textarea
                    value={paperDraft.description}
                    disabled={isLocked}
                    onChange={(event) => setPaperDraft((draft) => ({ ...draft, description: event.target.value }))}
                    className="min-h-20 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-500">{t.defaultOptions}</span>
                  <textarea
                    value={paperDraft.defaultOptionsText}
                    disabled={isLocked}
                    onChange={(event) =>
                      setPaperDraft((draft) => ({ ...draft, defaultOptionsText: event.target.value }))
                    }
                    className="min-h-20 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
                  />
                </label>
              </div>
              {isLocked ? <p className="mt-3 text-xs text-zinc-500">{t.locked}</p> : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
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
                  onPatch={(patch) => patchQuestion(selectedQuestion.id, patch)}
                  onSave={() => void saveQuestion(selectedQuestion)}
                  onRemove={() => void removeQuestion(selectedQuestion.id)}
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
          <select
            value={imageIndexId}
            onChange={(event) => {
              setImageIndexId(event.target.value);
              setImagePage(1);
            }}
            className="mt-2 h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-500"
          >
            <option value="">{t.allIndexes}</option>
            {indexes.map((node) => (
              <option key={node.id} value={node.id}>
                {"- ".repeat(node.depth)}
                {node.name}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[calc(100vh-250px)] overflow-auto p-3">
          <div className="grid grid-cols-2 gap-3">
            {images.map((image) => (
              <button
                type="button"
                key={image.id}
                onClick={() => void addImage(image)}
                disabled={!selectedPaper || isLocked}
                className="overflow-hidden rounded-md border border-zinc-200 bg-white text-left transition hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="aspect-[4/3] bg-zinc-100">
                  <img
                    src={`/api/images/${image.id}/file`}
                    alt={image.title ?? image.originalName}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-semibold">{image.title ?? image.originalName}</p>
                  <p className="mt-1 truncate text-[11px] text-zinc-500">{t.addImage}</p>
                </div>
              </button>
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
    </>
  );
}

function QuestionEditor({
  question,
  locked,
  t,
  onPatch,
  onSave,
  onRemove,
}: {
  question: ExamQuestion;
  locked: boolean;
  t: (typeof copy)["zh"];
  onPatch: (patch: Partial<ExamQuestion>) => void;
  onSave: () => void;
  onRemove: () => void;
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
        color={activeMaskColor}
        selectedIndex={activeMaskIndex}
        onSelect={setSelectedMaskIndex}
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
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t.prompt}</span>
          <input
            value={question.prompt}
            disabled={locked}
            onChange={(event) => onPatch({ prompt: event.target.value })}
            className="h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t.options}</span>
          <textarea
            value={optionLines(question.options)}
            disabled={locked}
            onChange={(event) => {
              const options = parseOptionLines(event.target.value);
              onPatch({
                options,
                correctOption: options.includes(question.correctOption ?? "") ? question.correctOption : options[0],
              });
            }}
            className="min-h-32 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
          />
        </label>
        <div className="space-y-3">
          <label>
            <span className="mb-1 block text-xs font-medium text-zinc-500">{t.correct}</span>
            <select
              value={question.correctOption ?? ""}
              disabled={locked}
              onChange={(event) => onPatch({ correctOption: event.target.value })}
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
            >
              <option value="">-</option>
              {question.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-zinc-500">{t.explanation}</span>
            <textarea
              value={question.explanation}
              disabled={locked}
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
