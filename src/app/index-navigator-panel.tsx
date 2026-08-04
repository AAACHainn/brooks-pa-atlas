"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderTree,
  GripVertical,
  Layers3,
  Loader2,
  PencilLine,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAppDialog } from "@/app/app-dialog";

type Locale = "zh" | "en";

export type NavigatorIndexNode = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: string;
  imageCount: number;
  children: NavigatorIndexNode[];
};

type NavigatorOption = {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  assignmentCount: number;
  matchCount: number;
};

type NavigatorCategory = {
  id: string;
  name: string;
  sortOrder: number;
  assignmentCount: number;
  options: NavigatorOption[];
};

type NavigatorResult = {
  id: string;
  name: string;
  path: string;
  depth: number;
  imageCount: number;
};

type NavigatorResponse = {
  categories: NavigatorCategory[];
  results: NavigatorResult[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  error?: string;
};

type Props = {
  locale: Locale;
  isManageMode: boolean;
  nodes: NavigatorIndexNode[];
  selectedIndexId: string | null;
  selectedOptionIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onSelectResult: (nodeId: string) => void;
  requestedEditNode: NavigatorIndexNode | null;
  onRequestedEditNodeHandled: () => void;
};

const labels = {
  zh: {
    title: "索引导航器",
    subtitle: "组合属性，快速定位目录",
    selected: "已选条件",
    matched: "匹配目录",
    filterRule: "每个分类单选，分类之间同时满足",
    resultTitle: "目录结果",
    expand: "展开导航器",
    collapse: "收起导航器",
    settings: "导航器设置",
    clear: "清除条件",
    emptyTitle: "尚未配置导航器",
    emptyManage: "创建分类和选项后，即可为索引节点配置导航属性。",
    emptyBrowse: "请在管理模式中创建导航分类和选项。",
    start: "开始设置",
    resultSearch: "搜索匹配目录名称或路径",
    chooseCondition: "请选择导航条件，或输入目录名称。",
    allMatched: "查看全部匹配目录的图片",
    images: "张图片",
    previous: "上一页",
    next: "下一页",
    taxonomy: "分类与选项",
    assignments: "批量配置",
    categoriesTitle: "导航分类",
    categoriesHelp: "拖动调整分类顺序，点击分类后管理右侧选项。",
    optionsTitle: "分类选项",
    optionsHelp: "选项用于描述索引节点，可拖动调整展示顺序。",
    noCategories: "还没有分类，请先创建一个分类。",
    chooseCategory: "请选择左侧分类后添加选项。",
    nodePanelTitle: "选择索引节点",
    assignmentPanelTitle: "选择导航属性",
    categoryName: "新分类名称",
    optionName: "新选项名称",
    addCategory: "添加分类",
    addOption: "添加选项",
    rename: "重命名",
    delete: "删除",
    cancel: "取消",
    confirm: "确认",
    renameCategoryTitle: "重命名导航分类",
    renameOptionTitle: "重命名分类选项",
    deleteCategoryTitle: "删除导航分类？",
    deleteOptionTitle: "删除分类选项？",
    close: "关闭",
    nodeSearch: "搜索索引节点名称或路径",
    selectedNodes: "已选节点",
    totalNodes: "全部节点",
    expandAllNodes: "全部展开",
    collapseAllNodes: "全部收起",
    expandNode: "展开节点",
    collapseNode: "收起节点",
    noNodes: "没有匹配的索引节点。",
    selectNodesHint: "选择父节点会同时选择全部后代；取消父节点也会取消全部后代。",
    optionOperation: "选择要批量操作的选项",
    addToNodes: "添加到所选节点",
    removeFromNodes: "从所选节点移除",
    saving: "保存中",
    loadFailed: "导航器加载失败",
    updateFailed: "导航器更新失败",
    confirmDeleteCategory: "删除该分类会同时删除其选项和所有节点关联。是否继续？",
    confirmDeleteOption: "删除该选项会同时删除所有节点关联。是否继续？",
    assigned: "已配置",
    matches: "个匹配目录",
    unavailable: "与当前已选分类组合后没有匹配目录",
  },
  en: {
    title: "Index navigator",
    subtitle: "Combine attributes to find indexes",
    selected: "Selected filters",
    matched: "Matched indexes",
    filterRule: "Choose one per category; categories are combined with AND",
    resultTitle: "Index results",
    expand: "Expand navigator",
    collapse: "Collapse navigator",
    settings: "Navigator settings",
    clear: "Clear filters",
    emptyTitle: "Navigator is not configured",
    emptyManage: "Create categories and options, then assign them to index nodes.",
    emptyBrowse: "Create navigator categories and options in Manage mode.",
    start: "Start setup",
    resultSearch: "Search matched index names or paths",
    chooseCondition: "Choose a navigator filter or enter an index name.",
    allMatched: "View images from all matched indexes",
    images: "images",
    previous: "Previous",
    next: "Next",
    taxonomy: "Categories & options",
    assignments: "Bulk assignment",
    categoriesTitle: "Navigator categories",
    categoriesHelp: "Drag to reorder categories, then select one to manage its options.",
    optionsTitle: "Category options",
    optionsHelp: "Options describe index nodes and can be reordered by dragging.",
    noCategories: "No categories yet. Create the first category above.",
    chooseCategory: "Select a category on the left before adding options.",
    nodePanelTitle: "Select index nodes",
    assignmentPanelTitle: "Select navigator attributes",
    categoryName: "New category name",
    optionName: "New option name",
    addCategory: "Add category",
    addOption: "Add option",
    rename: "Rename",
    delete: "Delete",
    cancel: "Cancel",
    confirm: "Confirm",
    renameCategoryTitle: "Rename navigator category",
    renameOptionTitle: "Rename category option",
    deleteCategoryTitle: "Delete navigator category?",
    deleteOptionTitle: "Delete category option?",
    close: "Close",
    nodeSearch: "Search index name or path",
    selectedNodes: "Selected nodes",
    totalNodes: "Total nodes",
    expandAllNodes: "Expand all",
    collapseAllNodes: "Collapse all",
    expandNode: "Expand node",
    collapseNode: "Collapse node",
    noNodes: "No matching index nodes.",
    selectNodesHint: "Selecting or clearing a parent also selects or clears all descendants.",
    optionOperation: "Choose options to update",
    addToNodes: "Add to selected nodes",
    removeFromNodes: "Remove from selected nodes",
    saving: "Saving",
    loadFailed: "Failed to load navigator",
    updateFailed: "Failed to update navigator",
    confirmDeleteCategory: "Deleting this category also removes its options and node assignments. Continue?",
    confirmDeleteOption: "Deleting this option also removes all node assignments. Continue?",
    assigned: "assigned",
    matches: "matched indexes",
    unavailable: "No indexes match this option with the selected categories",
  },
} as const;

const expandedStorageKey = "brooks-pa-atlas.indexNavigatorExpanded";

function flattenNodes(nodes: NavigatorIndexNode[]): NavigatorIndexNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function collectSubtreeNodeIds(
  nodes: NavigatorIndexNode[],
  target: Map<string, string[]>,
): string[] {
  return nodes.flatMap((node) => {
    const ids = [node.id, ...collectSubtreeNodeIds(node.children, target)];
    target.set(node.id, ids);
    return ids;
  });
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function filterNodeTree(nodes: NavigatorIndexNode[], term: string): NavigatorIndexNode[] {
  if (!term) return nodes;
  return nodes.flatMap((node) => {
    const children = filterNodeTree(node.children, term);
    if (!node.path.toLowerCase().includes(term) && children.length === 0) return [];
    return [{ ...node, children }];
  });
}

function flattenVisibleNodes(
  nodes: NavigatorIndexNode[],
  expandedNodeIds: Set<string>,
  forceExpand: boolean,
): NavigatorIndexNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(forceExpand || expandedNodeIds.has(node.id)
      ? flattenVisibleNodes(node.children, expandedNodeIds, forceExpand)
      : []),
  ]);
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `${response.status}`);
  }
  return payload;
}

export default function IndexNavigatorPanel({
  locale,
  isManageMode,
  nodes,
  selectedIndexId,
  selectedOptionIds,
  onSelectionChange,
  onSelectResult,
  requestedEditNode,
  onRequestedEditNodeHandled,
}: Props) {
  const t = labels[locale];
  const [expanded, setExpanded] = useState(false);
  const [nodeQuery, setNodeQuery] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const [data, setData] = useState<NavigatorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"taxonomy" | "assignments">("taxonomy");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState("");
  const [optionInput, setOptionInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [draggedOptionId, setDraggedOptionId] = useState<string | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [expandedAssignmentNodeIds, setExpandedAssignmentNodeIds] = useState<Set<string>>(new Set());
  const [operationOptionIds, setOperationOptionIds] = useState<Set<string>>(new Set());
  const [assignmentCounts, setAssignmentCounts] = useState<Map<string, number>>(new Map());
  const appDialog = useAppDialog({ confirm: t.confirm, cancel: t.cancel });

  const allNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);
  const subtreeNodeIds = useMemo(() => {
    const result = new Map<string, string[]>();
    collectSubtreeNodeIds(nodes, result);
    return result;
  }, [nodes]);
  const selectedCategory = data?.categories.find((category) => category.id === selectedCategoryId) ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExpanded(window.localStorage.getItem(expandedStorageKey) === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    selectedOptionIds.forEach((id) => params.append("optionId", id));
    if (nodeQuery.trim()) params.set("nodeQ", nodeQuery.trim());
    params.set("resultPage", String(resultPage));
    params.set("revision", String(revision));
    setLoading(true);
    try {
      const response = await fetch(`/api/index-navigator?${params}`, { cache: "no-store" });
      const next = (await response.json()) as NavigatorResponse;
      if (!response.ok) throw new Error(next.error ?? `${response.status}`);
      setData(next);
      setSelectedCategoryId((current) =>
        current && next.categories.some((category) => category.id === current)
          ? current
          : next.categories[0]?.id ?? null,
      );
      const normalizedSelection = new Set<string>();
      for (const category of next.categories) {
        const selectedInCategory = category.options.find((option) =>
          selectedOptionIds.has(option.id),
        );
        if (selectedInCategory) normalizedSelection.add(selectedInCategory.id);
      }
      if (
        normalizedSelection.size !== selectedOptionIds.size ||
        [...normalizedSelection].some((id) => !selectedOptionIds.has(id))
      ) {
        onSelectionChange(normalizedSelection);
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [nodeQuery, onSelectionChange, resultPage, revision, selectedOptionIds, t.loadFailed]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 120);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!requestedEditNode) return;
    const timer = window.setTimeout(() => {
      setSelectedNodeIds(new Set([requestedEditNode.id]));
      setExpandedAssignmentNodeIds((current) => {
        const next = new Set(current);
        let parentId = requestedEditNode.parentId;
        while (parentId) {
          next.add(parentId);
          parentId = nodeById.get(parentId)?.parentId ?? null;
        }
        return next;
      });
      setSettingsTab("assignments");
      setSettingsOpen(true);
      onRequestedEditNodeHandled();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [nodeById, onRequestedEditNodeHandled, requestedEditNode]);

  useEffect(() => {
    if (!settingsOpen || settingsTab !== "assignments" || selectedNodeIds.size === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      chunkItems([...selectedNodeIds], 1000).map(async (nodeIds) => {
        const response = await fetch("/api/index-navigator/assignments", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeIds }),
        });
        const payload = (await response.json()) as {
          nodes?: Array<{ nodeId: string; optionIds: string[] }>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? `${response.status}`);
        return payload.nodes ?? [];
      }),
    )
      .then((batches) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        batches.flat().forEach((node) =>
          node.optionIds.forEach((optionId) => counts.set(optionId, (counts.get(optionId) ?? 0) + 1)),
        );
        setAssignmentCounts(counts);
      })
      .catch((assignmentError) => {
        if (!cancelled) setError(assignmentError instanceof Error ? assignmentError.message : t.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, selectedNodeIds, settingsOpen, settingsTab, t.loadFailed]);

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      window.localStorage.setItem(expandedStorageKey, String(next));
      return next;
    });
  }

  function toggleFilter(option: NavigatorOption) {
    const selected = selectedOptionIds.has(option.id);
    if (!selected && option.matchCount === 0) return;
    const next = new Set(selectedOptionIds);
    const category = data?.categories.find((candidate) => candidate.id === option.categoryId);
    category?.options.forEach((candidate) => next.delete(candidate.id));
    if (!selected) next.add(option.id);
    setLoading(true);
    setResultPage(1);
    onSelectionChange(next);
  }

  async function mutate(url: string, method: string, body: unknown) {
    setBusy(true);
    try {
      await jsonRequest(url, { method, body: JSON.stringify(body) });
      setRevision((current) => current + 1);
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t.updateFailed);
      throw updateError;
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    if (!categoryInput.trim()) return;
    await mutate("/api/index-navigator/categories", "POST", { name: categoryInput });
    setCategoryInput("");
  }

  async function addOption() {
    if (!selectedCategoryId || !optionInput.trim()) return;
    await mutate("/api/index-navigator/options", "POST", { categoryId: selectedCategoryId, name: optionInput });
    setOptionInput("");
  }

  async function reorderCategories(targetId: string) {
    if (!data || !draggedCategoryId || draggedCategoryId === targetId) return;
    const ids = data.categories.map((category) => category.id);
    const from = ids.indexOf(draggedCategoryId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await mutate("/api/index-navigator/categories", "PATCH", { orderedIds: ids });
  }

  async function reorderOptions(targetId: string) {
    if (!selectedCategory || !draggedOptionId || draggedOptionId === targetId) return;
    const ids = selectedCategory.options.map((option) => option.id);
    const from = ids.indexOf(draggedOptionId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await mutate("/api/index-navigator/options", "PATCH", {
      categoryId: selectedCategory.id,
      orderedIds: ids,
    });
  }

  async function updateAssignments(mode: "add" | "remove") {
    if (selectedNodeIds.size === 0 || operationOptionIds.size === 0) return;
    setBusy(true);
    try {
      for (const nodeIds of chunkItems([...selectedNodeIds], 1000)) {
        await jsonRequest("/api/index-navigator/assignments", {
          method: "PATCH",
          body: JSON.stringify({
            nodeIds,
            addOptionIds: mode === "add" ? [...operationOptionIds] : [],
            removeOptionIds: mode === "remove" ? [...operationOptionIds] : [],
          }),
        });
      }
      setOperationOptionIds(new Set());
      setRevision((current) => current + 1);
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t.updateFailed);
    } finally {
      setBusy(false);
    }
  }

  const normalizedNodeSearch = nodeSearch.trim().toLowerCase();
  const filteredNodeTree = filterNodeTree(nodes, normalizedNodeSearch);
  const visibleAssignmentNodes = flattenVisibleNodes(
    filteredNodeTree,
    expandedAssignmentNodeIds,
    Boolean(normalizedNodeSearch),
  );

  function toggleAssignmentNode(nodeId: string) {
    setExpandedAssignmentNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  const hasNavigatorQuery = selectedOptionIds.size > 0 || Boolean(nodeQuery.trim());
  const matchedResultCount = hasNavigatorQuery ? (data?.pagination.total ?? 0) : 0;

  return (
    <div className="border-b border-zinc-200 bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div
        className={`flex min-h-12 items-center gap-2 px-4 py-2 transition-colors sm:px-5 ${
          expanded ? "bg-gradient-to-r from-cyan-50/80 via-white to-white" : "bg-white hover:bg-zinc-50/70"
        }`}
      >
        <button
          type="button"
          onClick={toggleExpanded}
          className="group inline-flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500"
          title={expanded ? t.collapse : t.expand}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-cyan-100 bg-cyan-50 text-cyan-700 shadow-sm">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-800">{t.title}</span>
            <span className="hidden truncate text-[11px] text-zinc-500 sm:block">{t.subtitle}</span>
          </span>
          <span className="ml-1 inline-flex shrink-0 items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                selectedOptionIds.size > 0 ? "bg-cyan-100 text-cyan-800" : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {t.selected} {selectedOptionIds.size}
            </span>
            <span className="hidden rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200 sm:inline-flex">
              {t.matched} {matchedResultCount}
            </span>
          </span>
          <span className="ml-auto grid h-7 w-7 place-items-center rounded-full text-zinc-400 transition group-hover:bg-white group-hover:text-zinc-700">
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </span>
        </button>
        {selectedOptionIds.size > 0 ? (
          <button
            type="button"
            onClick={() => onSelectionChange(new Set())}
            className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-zinc-500 transition hover:bg-white hover:text-zinc-800 hover:shadow-sm"
          >
            {t.clear}
          </button>
        ) : null}
        {isManageMode ? (
          <button
            type="button"
            onClick={() => {
              setSettingsTab("taxonomy");
              setSettingsOpen(true);
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-sm outline-none transition hover:border-cyan-200 hover:text-cyan-700 focus-visible:ring-2 focus-visible:ring-cyan-500"
            title={t.settings}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-cyan-100/70 bg-zinc-50/70 px-4 py-4 sm:px-5">
          {error ? (
            <p className="mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          ) : null}
          {(data?.categories.length ?? 0) === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-7 text-center shadow-sm">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                <Layers3 className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-zinc-800">{t.emptyTitle}</p>
              <p className="mt-1 text-xs text-zinc-500">{isManageMode ? t.emptyManage : t.emptyBrowse}</p>
              {isManageMode ? (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="mt-4 h-9 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white shadow-sm transition hover:bg-zinc-800"
                >
                  {t.start}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
              <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 border-b border-zinc-100 pb-3">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-50 text-cyan-700">
                    <Layers3 className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-xs font-medium text-zinc-600">{t.filterRule}</p>
                </div>
                <div className="space-y-2.5">
                  {data?.categories.map((category) => (
                    <div
                      key={category.id}
                      className="grid gap-2 rounded-lg bg-zinc-50/80 px-3 py-2.5 sm:grid-cols-[minmax(100px,140px)_1fr]"
                    >
                      <div className="flex min-w-0 items-center gap-2" title={category.name}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                        <span className="truncate text-xs font-semibold text-zinc-700">{category.name}</span>
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-zinc-400 ring-1 ring-zinc-200">
                          {category.options.length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {category.options.map((option) => {
                          const selected = selectedOptionIds.has(option.id);
                          const unavailable = !selected && option.matchCount === 0;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              aria-label={option.name}
                              aria-pressed={selected}
                              disabled={loading || unavailable}
                              onClick={() => toggleFilter(option)}
                              className={`inline-flex min-h-7 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                                selected
                                  ? "border-cyan-700 bg-cyan-700 text-white shadow-sm"
                                  : unavailable
                                    ? "cursor-not-allowed border-zinc-100 bg-zinc-100 text-zinc-300"
                                    : "border-zinc-200 bg-white text-zinc-600 shadow-[0_1px_0_rgba(0,0,0,0.03)] hover:border-cyan-200 hover:text-cyan-800 disabled:cursor-wait disabled:opacity-60"
                              }`}
                              title={
                                unavailable
                                  ? t.unavailable
                                  : `${option.matchCount} ${t.matches} · ${option.assignmentCount} ${t.assigned}`
                              }
                            >
                              {selected ? <Check className="h-3 w-3" /> : null}
                              <span>{option.name}</span>
                              {selectedOptionIds.size > 0 ? (
                                <span
                                  className={`text-[10px] ${
                                    selected ? "text-cyan-100" : unavailable ? "text-zinc-300" : "text-zinc-400"
                                  }`}
                                >
                                  {option.matchCount}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-100 text-zinc-600">
                      <FolderTree className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-semibold text-zinc-700">{t.resultTitle}</span>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                    {matchedResultCount}
                  </span>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={nodeQuery}
                    onChange={(event) => {
                      setNodeQuery(event.target.value);
                      setResultPage(1);
                    }}
                    className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 pl-8 pr-3 text-xs outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100"
                    placeholder={t.resultSearch}
                  />
                </div>
                {selectedIndexId && data && data.pagination.total > 1 ? (
                  <button
                    type="button"
                    onClick={() => onSelectionChange(new Set(selectedOptionIds))}
                    className="mt-2 w-full rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-2 text-left text-xs font-medium text-cyan-800 transition hover:bg-cyan-100"
                  >
                    {t.allMatched}
                  </button>
                ) : null}
                <div className="mt-2 min-h-16 max-h-52 space-y-1 overflow-y-auto pr-0.5">
                  {data?.results.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => onSelectResult(result.id)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                        selectedIndexId === result.id
                          ? "border-cyan-200 bg-cyan-50 shadow-sm"
                          : "border-transparent hover:border-zinc-200 hover:bg-zinc-50"
                      }`}
                      title={result.path}
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`h-3 w-3 shrink-0 ${selectedIndexId === result.id ? "text-cyan-600" : "text-zinc-300"}`} />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-800">{result.name}</span>
                        <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 ring-1 ring-zinc-200">
                          {result.imageCount}
                        </span>
                      </div>
                      <p className="mt-1 truncate pl-5 text-[10px] text-zinc-400">{result.path}</p>
                    </button>
                  ))}
                  {!loading && data?.results.length === 0 ? (
                    <div className="grid min-h-16 place-items-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-3 text-center">
                      <p className="text-[11px] leading-5 text-zinc-400">{t.chooseCondition}</p>
                    </div>
                  ) : null}
                </div>
                {data && data.pagination.totalPages > 1 ? (
                  <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 text-[11px] text-zinc-500">
                    <span>{data.pagination.page}/{data.pagination.totalPages}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={data.pagination.page <= 1}
                        onClick={() => setResultPage((page) => Math.max(1, page - 1))}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-zinc-200 bg-white transition hover:border-cyan-200 hover:text-cyan-700 disabled:opacity-40"
                        title={t.previous}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={data.pagination.page >= data.pagination.totalPages}
                        onClick={() => setResultPage((page) => page + 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-zinc-200 bg-white transition hover:border-cyan-200 hover:text-cyan-700 disabled:opacity-40"
                        title={t.next}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          )}
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/45 p-3 backdrop-blur-[2px] sm:p-5"
          role="dialog"
          aria-modal="true"
          onClick={() => !busy && setSettingsOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-zinc-950/20"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 bg-gradient-to-r from-cyan-50/80 via-white to-white px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-100 bg-white text-cyan-700 shadow-sm">
                  <Settings2 className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-zinc-950">{t.settings}</h2>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{t.selectNodesHint}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSettingsOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900"
                title={t.close}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-zinc-200 bg-white px-5 py-3 sm:px-6">
              <div className="inline-flex rounded-xl bg-zinc-100 p-1">
              {(["taxonomy", "assignments"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSettingsTab(tab)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                    settingsTab === tab
                      ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
                      : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  {tab === "taxonomy" ? t.taxonomy : t.assignments}
                </button>
              ))}
              </div>
            </div>
            {error ? (
              <p className="mx-5 mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700 sm:mx-6">{error}</p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto bg-zinc-50/70 p-4 sm:p-6">
              {settingsTab === "taxonomy" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <div className="border-b border-zinc-100 px-4 py-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-900">{t.categoriesTitle}</h3>
                          <p className="mt-1 text-[11px] leading-4 text-zinc-500">{t.categoriesHelp}</p>
                        </div>
                        <span className="rounded-full bg-cyan-50 px-2 py-1 text-[11px] font-medium text-cyan-700">
                          {data?.categories.length ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex gap-2">
                        <input
                          value={categoryInput}
                          onChange={(event) => setCategoryInput(event.target.value)}
                          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 text-sm outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100"
                          placeholder={t.categoryName}
                        />
                        <button
                          type="button"
                          disabled={busy || !categoryInput.trim()}
                          onClick={() => void addCategory()}
                          className="grid h-10 w-10 place-items-center rounded-lg bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-40"
                          title={t.addCategory}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-4 max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                        {data?.categories.map((category) => (
                          <div
                            key={category.id}
                            draggable={!busy}
                            onDragStart={() => setDraggedCategoryId(category.id)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => void reorderCategories(category.id)}
                            className={`group flex items-center gap-2 rounded-lg border px-2 py-2 transition ${
                              selectedCategoryId === category.id
                                ? "border-cyan-200 bg-cyan-50 shadow-sm"
                                : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                            }`}
                          >
                            <GripVertical className="h-4 w-4 cursor-grab text-zinc-300 group-hover:text-zinc-500" />
                            <button
                              type="button"
                              onClick={() => setSelectedCategoryId(category.id)}
                              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-800"
                            >
                              {category.name}
                            </button>
                            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 ring-1 ring-zinc-200">
                              {category.assignmentCount}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                const name = await appDialog.showPrompt({
                                  title: t.renameCategoryTitle,
                                  inputLabel: t.categoryName,
                                  initialValue: category.name,
                                  confirmLabel: t.rename,
                                  required: true,
                                });
                                if (name && name !== category.name) {
                                  void mutate("/api/index-navigator/categories", "PATCH", { id: category.id, name })
                                    .catch(() => undefined);
                                }
                              }}
                              className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition hover:bg-white hover:text-zinc-800"
                              title={t.rename}
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const confirmed = await appDialog.showConfirm({
                                  title: t.deleteCategoryTitle,
                                  message: t.confirmDeleteCategory,
                                  tone: "danger",
                                  confirmLabel: t.delete,
                                });
                                if (confirmed) {
                                  void mutate("/api/index-navigator/categories", "DELETE", { id: category.id })
                                    .catch(() => undefined);
                                }
                              }}
                              className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600"
                              title={t.delete}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        {(data?.categories.length ?? 0) === 0 ? (
                          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-8 text-center text-xs text-zinc-400">
                            {t.noCategories}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <div className="border-b border-zinc-100 px-4 py-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-900">{t.optionsTitle}</h3>
                          <p className="mt-1 text-[11px] leading-4 text-zinc-500">{t.optionsHelp}</p>
                        </div>
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-500">
                          {selectedCategory?.options.length ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex gap-2">
                        <input
                          value={optionInput}
                          onChange={(event) => setOptionInput(event.target.value)}
                          disabled={!selectedCategory}
                          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 text-sm outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder={t.optionName}
                        />
                        <button
                          type="button"
                          disabled={busy || !selectedCategory || !optionInput.trim()}
                          onClick={() => void addOption()}
                          className="grid h-10 w-10 place-items-center rounded-lg bg-cyan-700 text-white shadow-sm transition hover:bg-cyan-800 disabled:opacity-40"
                          title={t.addOption}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-4 max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                        {selectedCategory?.options.map((option) => (
                          <div
                            key={option.id}
                            draggable={!busy}
                            onDragStart={() => setDraggedOptionId(option.id)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => void reorderOptions(option.id)}
                            className="group flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-2 transition hover:border-cyan-200 hover:bg-cyan-50/40"
                          >
                            <GripVertical className="h-4 w-4 cursor-grab text-zinc-300 group-hover:text-zinc-500" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-700">{option.name}</span>
                            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                              {option.assignmentCount}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                const name = await appDialog.showPrompt({
                                  title: t.renameOptionTitle,
                                  inputLabel: t.optionName,
                                  initialValue: option.name,
                                  confirmLabel: t.rename,
                                  required: true,
                                });
                                if (name && name !== option.name) {
                                  void mutate("/api/index-navigator/options", "PATCH", { id: option.id, name })
                                    .catch(() => undefined);
                                }
                              }}
                              className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition hover:bg-white hover:text-zinc-800"
                              title={t.rename}
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const confirmed = await appDialog.showConfirm({
                                  title: t.deleteOptionTitle,
                                  message: t.confirmDeleteOption,
                                  tone: "danger",
                                  confirmLabel: t.delete,
                                });
                                if (confirmed) {
                                  void mutate("/api/index-navigator/options", "DELETE", { id: option.id })
                                    .catch(() => undefined);
                                }
                              }}
                              className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600"
                              title={t.delete}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        {!selectedCategory ? (
                          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-8 text-center text-xs text-zinc-400">
                            {t.chooseCategory}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="grid min-h-[500px] gap-4 lg:grid-cols-[minmax(320px,0.92fr)_minmax(0,1.08fr)]">
                  <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">{t.nodePanelTitle}</h3>
                        <p className="mt-1 text-[11px] text-zinc-500">{t.selectNodesHint}</p>
                      </div>
                      <span className="rounded-full bg-cyan-50 px-2 py-1 text-[11px] font-medium text-cyan-700">
                        {selectedNodeIds.size}
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <input
                        value={nodeSearch}
                        onChange={(event) => setNodeSearch(event.target.value)}
                        className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50/60 pl-9 pr-3 text-sm outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100"
                        placeholder={t.nodeSearch}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-zinc-500">
                        {t.selectedNodes}: {selectedNodeIds.size} · {t.totalNodes}: {allNodes.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={Boolean(normalizedNodeSearch)}
                          onClick={() =>
                            setExpandedAssignmentNodeIds(
                              new Set(allNodes.filter((node) => node.children.length > 0).map((node) => node.id)),
                            )
                          }
                          className="h-7 rounded-lg px-2 text-[11px] font-medium text-cyan-700 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t.expandAllNodes}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(normalizedNodeSearch)}
                          onClick={() => setExpandedAssignmentNodeIds(new Set())}
                          className="h-7 rounded-lg px-2 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t.collapseAllNodes}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 max-h-[390px] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50/40 p-1.5">
                      {visibleAssignmentNodes.map((node) => {
                        const hasChildren = node.children.length > 0;
                        const isNodeExpanded = Boolean(normalizedNodeSearch) || expandedAssignmentNodeIds.has(node.id);
                        const nodeSubtreeIds = subtreeNodeIds.get(node.id) ?? [node.id];
                        const selectedSubtreeCount = nodeSubtreeIds.reduce(
                          (count, nodeId) => count + (selectedNodeIds.has(nodeId) ? 1 : 0),
                          0,
                        );
                        const subtreeSelected = selectedSubtreeCount === nodeSubtreeIds.length;
                        const subtreePartiallySelected = selectedSubtreeCount > 0 && !subtreeSelected;
                        return (
                        <div
                          key={node.id}
                          className={`flex items-center rounded-lg py-1 pr-2 text-sm transition ${
                            subtreeSelected || subtreePartiallySelected
                              ? "bg-cyan-50/80 text-zinc-900"
                              : "hover:bg-white hover:shadow-sm"
                          }`}
                          style={{ paddingLeft: 6 + node.depth * 14 }}
                          title={node.path}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              disabled={Boolean(normalizedNodeSearch)}
                              onClick={() => toggleAssignmentNode(node.id)}
                              className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-zinc-400 transition hover:bg-white hover:text-zinc-700 disabled:cursor-default"
                              title={`${isNodeExpanded ? t.collapseNode : t.expandNode}: ${node.name}`}
                              aria-label={`${isNodeExpanded ? t.collapseNode : t.expandNode}: ${node.name}`}
                            >
                              <ChevronRight className={`h-3.5 w-3.5 transition ${isNodeExpanded ? "rotate-90" : ""}`} />
                            </button>
                          ) : (
                            <span className="mr-1 h-6 w-6 shrink-0" />
                          )}
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5">
                            <input
                              type="checkbox"
                              checked={subtreeSelected}
                              ref={(input) => {
                                if (input) input.indeterminate = subtreePartiallySelected;
                              }}
                              onChange={() => {
                                setSelectedNodeIds((current) => {
                                  const next = new Set(current);
                                  if (subtreeSelected) nodeSubtreeIds.forEach((nodeId) => next.delete(nodeId));
                                  else nodeSubtreeIds.forEach((nodeId) => next.add(nodeId));
                                  return next;
                                });
                              }}
                              className="h-4 w-4 shrink-0 rounded accent-cyan-700"
                            />
                            <span className="min-w-0 flex-1 truncate">{node.name}</span>
                            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-zinc-400 ring-1 ring-zinc-200">
                              {node.imageCount}
                            </span>
                          </label>
                        </div>
                        );
                      })}
                      {visibleAssignmentNodes.length === 0 ? (
                        <p className="px-2 py-8 text-center text-xs text-zinc-400">{t.noNodes}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">{t.assignmentPanelTitle}</h3>
                        <p className="mt-1 text-[11px] text-zinc-500">{t.optionOperation}</p>
                      </div>
                      <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-500">
                        {operationOptionIds.size}
                      </span>
                    </div>
                    <div className="mt-3 flex-1 space-y-3 overflow-y-auto">
                      {data?.categories.map((category) => (
                        <div key={category.id} className="rounded-lg bg-zinc-50/80 p-3">
                          <p className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                            {category.name}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {category.options.map((option) => {
                              const selected = operationOptionIds.has(option.id);
                              const count = assignmentCounts.get(option.id) ?? 0;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => {
                                    setOperationOptionIds((current) => {
                                      const next = new Set(current);
                                      if (next.has(option.id)) next.delete(option.id);
                                      else next.add(option.id);
                                      return next;
                                    });
                                  }}
                                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                                    selected
                                      ? "border-cyan-700 bg-cyan-700 text-white shadow-sm"
                                      : "border-zinc-200 bg-white text-zinc-600 hover:border-cyan-200 hover:text-cyan-800"
                                  }`}
                                >
                                  {selected ? <Check className="h-3 w-3" /> : null}
                                  <span>{option.name}</span>
                                  {selectedNodeIds.size > 0 ? (
                                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${selected ? "bg-white/15" : "bg-zinc-100 text-zinc-400"}`}>
                                      {count}/{selectedNodeIds.size}
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-4">
                      <button
                        type="button"
                        disabled={busy || selectedNodeIds.size === 0 || operationOptionIds.size === 0}
                        onClick={() => void updateAssignments("add")}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-700 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-cyan-800 disabled:opacity-40"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {busy ? t.saving : t.addToNodes}
                      </button>
                      <button
                        type="button"
                        disabled={busy || selectedNodeIds.size === 0 || operationOptionIds.size === 0}
                        onClick={() => void updateAssignments("remove")}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t.removeFromNodes}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {appDialog.dialogElement}
    </div>
  );
}
