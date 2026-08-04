"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
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
    selected: "已选条件",
    matched: "匹配目录",
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
    categoryName: "新分类名称",
    optionName: "新选项名称",
    addCategory: "添加分类",
    addOption: "添加选项",
    rename: "重命名",
    delete: "删除",
    close: "关闭",
    nodeSearch: "搜索索引节点名称或路径",
    selectedNodes: "已选节点",
    totalNodes: "全部节点",
    expandAllNodes: "全部展开",
    collapseAllNodes: "全部收起",
    expandNode: "展开节点",
    collapseNode: "收起节点",
    noNodes: "没有匹配的索引节点。",
    selectNodesHint: "选择一个或多个索引节点。父节点不会自动包含后代。",
    optionOperation: "选择要批量操作的选项",
    addToNodes: "添加到所选节点",
    removeFromNodes: "从所选节点移除",
    saving: "保存中",
    loadFailed: "导航器加载失败",
    updateFailed: "导航器更新失败",
    confirmDeleteCategory: "删除该分类会同时删除其选项和所有节点关联。是否继续？",
    confirmDeleteOption: "删除该选项会同时删除所有节点关联。是否继续？",
    assigned: "已配置",
  },
  en: {
    title: "Index navigator",
    selected: "Selected filters",
    matched: "Matched indexes",
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
    categoryName: "New category name",
    optionName: "New option name",
    addCategory: "Add category",
    addOption: "Add option",
    rename: "Rename",
    delete: "Delete",
    close: "Close",
    nodeSearch: "Search index name or path",
    selectedNodes: "Selected nodes",
    totalNodes: "Total nodes",
    expandAllNodes: "Expand all",
    collapseAllNodes: "Collapse all",
    expandNode: "Expand node",
    collapseNode: "Collapse node",
    noNodes: "No matching index nodes.",
    selectNodesHint: "Select one or more nodes. Selecting a parent does not include descendants.",
    optionOperation: "Choose options to update",
    addToNodes: "Add to selected nodes",
    removeFromNodes: "Remove from selected nodes",
    saving: "Saving",
    loadFailed: "Failed to load navigator",
    updateFailed: "Failed to update navigator",
    confirmDeleteCategory: "Deleting this category also removes its options and node assignments. Continue?",
    confirmDeleteOption: "Deleting this option also removes all node assignments. Continue?",
    assigned: "assigned",
  },
} as const;

const expandedStorageKey = "brooks-pa-atlas.indexNavigatorExpanded";

function flattenNodes(nodes: NavigatorIndexNode[]): NavigatorIndexNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
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

  const allNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);
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
      const available = new Set(next.categories.flatMap((category) => category.options.map((option) => option.id)));
      if ([...selectedOptionIds].some((id) => !available.has(id))) {
        onSelectionChange(new Set([...selectedOptionIds].filter((id) => available.has(id))));
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
    const params = new URLSearchParams();
    selectedNodeIds.forEach((id) => params.append("nodeId", id));
    void fetch(`/api/index-navigator/assignments?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          nodes?: Array<{ nodeId: string; optionIds: string[] }>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? `${response.status}`);
        const counts = new Map<string, number>();
        payload.nodes?.forEach((node) =>
          node.optionIds.forEach((optionId) => counts.set(optionId, (counts.get(optionId) ?? 0) + 1)),
        );
        setAssignmentCounts(counts);
      })
      .catch((assignmentError) => setError(assignmentError instanceof Error ? assignmentError.message : t.loadFailed));
  }, [revision, selectedNodeIds, settingsOpen, settingsTab, t.loadFailed]);

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      window.localStorage.setItem(expandedStorageKey, String(next));
      return next;
    });
  }

  function toggleFilter(optionId: string) {
    const next = new Set(selectedOptionIds);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
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
    await mutate("/api/index-navigator/assignments", "PATCH", {
      nodeIds: [...selectedNodeIds],
      addOptionIds: mode === "add" ? [...operationOptionIds] : [],
      removeOptionIds: mode === "remove" ? [...operationOptionIds] : [],
    });
    setOperationOptionIds(new Set());
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

  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="flex min-h-11 items-center gap-2 px-5 py-2">
        <button
          type="button"
          onClick={toggleExpanded}
          className="inline-flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-zinc-700"
          title={expanded ? t.collapse : t.expand}
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-cyan-700" />
          <span>{t.title}</span>
          {selectedOptionIds.size > 0 ? (
            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-800">
              {t.selected} {selectedOptionIds.size}
            </span>
          ) : null}
          {(selectedOptionIds.size > 0 || nodeQuery.trim()) && data ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
              {t.matched} {data.pagination.total}
            </span>
          ) : null}
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : null}
          <ChevronDown className={`ml-auto h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
        </button>
        {selectedOptionIds.size > 0 ? (
          <button
            type="button"
            onClick={() => onSelectionChange(new Set())}
            className="h-7 rounded px-2 text-xs text-zinc-500 hover:bg-zinc-100"
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
            className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            title={t.settings}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-zinc-100 px-5 py-4">
          {error ? <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
          {(data?.categories.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center">
              <p className="text-sm font-semibold text-zinc-800">{t.emptyTitle}</p>
              <p className="mt-1 text-xs text-zinc-500">{isManageMode ? t.emptyManage : t.emptyBrowse}</p>
              {isManageMode ? (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="mt-3 h-8 rounded-md bg-zinc-950 px-3 text-xs font-medium text-white"
                >
                  {t.start}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
              <div className="space-y-3">
                {data?.categories.map((category) => (
                  <div key={category.id} className="grid gap-2 sm:grid-cols-[140px_1fr]">
                    <div className="truncate pt-1.5 text-xs font-semibold text-zinc-600" title={category.name}>
                      {category.name}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {category.options.map((option) => {
                        const selected = selectedOptionIds.has(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleFilter(option.id)}
                            className={`rounded-md border px-2.5 py-1 text-xs transition ${
                              selected
                                ? "border-cyan-700 bg-cyan-700 text-white"
                                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                            }`}
                            title={`${option.assignmentCount} ${t.assigned}`}
                          >
                            {option.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={nodeQuery}
                    onChange={(event) => {
                      setNodeQuery(event.target.value);
                      setResultPage(1);
                    }}
                    className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-zinc-500"
                    placeholder={t.resultSearch}
                  />
                </div>
                {selectedIndexId && data && data.pagination.total > 1 ? (
                  <button
                    type="button"
                    onClick={() => onSelectionChange(new Set(selectedOptionIds))}
                    className="mt-2 w-full rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1.5 text-left text-xs font-medium text-cyan-800 hover:bg-cyan-100"
                  >
                    {t.allMatched}
                  </button>
                ) : null}
                <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                  {data?.results.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => onSelectResult(result.id)}
                      className={`w-full rounded-md px-2 py-2 text-left hover:bg-white ${
                        selectedIndexId === result.id ? "bg-white ring-1 ring-cyan-500" : ""
                      }`}
                      title={result.path}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-800">{result.name}</span>
                        <span className="shrink-0 text-[11px] text-zinc-400">{result.imageCount}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{result.path}</p>
                    </button>
                  ))}
                  {!loading && data?.results.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-zinc-400">{t.chooseCondition}</p>
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
                        className="grid h-7 w-7 place-items-center rounded border border-zinc-200 bg-white disabled:opacity-40"
                        title={t.previous}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={data.pagination.page >= data.pagination.totalPages}
                        onClick={() => setResultPage((page) => page + 1)}
                        className="grid h-7 w-7 place-items-center rounded border border-zinc-200 bg-white disabled:opacity-40"
                        title={t.next}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/55 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !busy && setSettingsOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-md bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">{t.settings}</h2>
                <p className="mt-0.5 text-xs text-zinc-500">{t.selectNodesHint}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSettingsOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                title={t.close}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex border-b border-zinc-200 px-5 pt-3">
              {(["taxonomy", "assignments"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSettingsTab(tab)}
                  className={`border-b-2 px-4 py-2 text-sm font-medium ${
                    settingsTab === tab ? "border-zinc-950 text-zinc-950" : "border-transparent text-zinc-500"
                  }`}
                >
                  {tab === "taxonomy" ? t.taxonomy : t.assignments}
                </button>
              ))}
            </div>
            {error ? <p className="mx-5 mt-3 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {settingsTab === "taxonomy" ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="rounded-md border border-zinc-200 p-4">
                    <div className="flex gap-2">
                      <input
                        value={categoryInput}
                        onChange={(event) => setCategoryInput(event.target.value)}
                        className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500"
                        placeholder={t.categoryName}
                      />
                      <button
                        type="button"
                        disabled={busy || !categoryInput.trim()}
                        onClick={() => void addCategory()}
                        className="grid h-9 w-9 place-items-center rounded-md bg-zinc-950 text-white disabled:opacity-50"
                        title={t.addCategory}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 space-y-1">
                      {data?.categories.map((category) => (
                        <div
                          key={category.id}
                          draggable={!busy}
                          onDragStart={() => setDraggedCategoryId(category.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => void reorderCategories(category.id)}
                          className={`flex items-center gap-2 rounded-md border px-2 py-2 ${
                            selectedCategoryId === category.id ? "border-cyan-500 bg-cyan-50" : "border-zinc-200"
                          }`}
                        >
                          <GripVertical className="h-4 w-4 cursor-grab text-zinc-400" />
                          <button
                            type="button"
                            onClick={() => setSelectedCategoryId(category.id)}
                            className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                          >
                            {category.name}
                          </button>
                          <span className="text-[11px] text-zinc-400">{category.assignmentCount}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const name = window.prompt(t.rename, category.name);
                              if (name?.trim()) void mutate("/api/index-navigator/categories", "PATCH", { id: category.id, name });
                            }}
                            className="grid h-7 w-7 place-items-center rounded hover:bg-white"
                            title={t.rename}
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(t.confirmDeleteCategory)) {
                                void mutate("/api/index-navigator/categories", "DELETE", { id: category.id });
                              }
                            }}
                            className="grid h-7 w-7 place-items-center rounded text-rose-600 hover:bg-rose-50"
                            title={t.delete}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-md border border-zinc-200 p-4">
                    <div className="flex gap-2">
                      <input
                        value={optionInput}
                        onChange={(event) => setOptionInput(event.target.value)}
                        disabled={!selectedCategory}
                        className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
                        placeholder={t.optionName}
                      />
                      <button
                        type="button"
                        disabled={busy || !selectedCategory || !optionInput.trim()}
                        onClick={() => void addOption()}
                        className="grid h-9 w-9 place-items-center rounded-md bg-zinc-950 text-white disabled:opacity-50"
                        title={t.addOption}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 space-y-1">
                      {selectedCategory?.options.map((option) => (
                        <div
                          key={option.id}
                          draggable={!busy}
                          onDragStart={() => setDraggedOptionId(option.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => void reorderOptions(option.id)}
                          className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-2"
                        >
                          <GripVertical className="h-4 w-4 cursor-grab text-zinc-400" />
                          <span className="min-w-0 flex-1 truncate text-sm">{option.name}</span>
                          <span className="text-[11px] text-zinc-400">{option.assignmentCount}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const name = window.prompt(t.rename, option.name);
                              if (name?.trim()) void mutate("/api/index-navigator/options", "PATCH", { id: option.id, name });
                            }}
                            className="grid h-7 w-7 place-items-center rounded hover:bg-zinc-50"
                            title={t.rename}
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(t.confirmDeleteOption)) {
                                void mutate("/api/index-navigator/options", "DELETE", { id: option.id });
                              }
                            }}
                            className="grid h-7 w-7 place-items-center rounded text-rose-600 hover:bg-rose-50"
                            title={t.delete}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid min-h-[480px] gap-5 lg:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.1fr)]">
                  <div className="rounded-md border border-zinc-200 p-4">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <input
                        value={nodeSearch}
                        onChange={(event) => setNodeSearch(event.target.value)}
                        className="h-9 w-full rounded-md border border-zinc-200 pl-9 pr-3 text-sm outline-none focus:border-zinc-500"
                        placeholder={t.nodeSearch}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-zinc-500">
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
                          className="h-7 rounded px-2 text-[11px] text-cyan-700 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t.expandAllNodes}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(normalizedNodeSearch)}
                          onClick={() => setExpandedAssignmentNodeIds(new Set())}
                          className="h-7 rounded px-2 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t.collapseAllNodes}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 max-h-[430px] space-y-1 overflow-y-auto">
                      {visibleAssignmentNodes.map((node) => {
                        const hasChildren = node.children.length > 0;
                        const isNodeExpanded = Boolean(normalizedNodeSearch) || expandedAssignmentNodeIds.has(node.id);
                        return (
                        <div
                          key={node.id}
                          className="flex items-center rounded-md py-1 pr-2 text-sm hover:bg-zinc-50"
                          style={{ paddingLeft: 6 + node.depth * 14 }}
                          title={node.path}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              disabled={Boolean(normalizedNodeSearch)}
                              onClick={() => toggleAssignmentNode(node.id)}
                              className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-500 hover:bg-zinc-200 disabled:cursor-default"
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
                              checked={selectedNodeIds.has(node.id)}
                              onChange={() => {
                                setSelectedNodeIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(node.id)) next.delete(node.id);
                                  else if (next.size < 1000) next.add(node.id);
                                  return next;
                                });
                              }}
                              className="h-4 w-4 shrink-0 accent-cyan-700"
                            />
                            <span className="min-w-0 flex-1 truncate">{node.name}</span>
                            <span className="text-[11px] text-zinc-400">{node.imageCount}</span>
                          </label>
                        </div>
                        );
                      })}
                      {visibleAssignmentNodes.length === 0 ? (
                        <p className="px-2 py-8 text-center text-xs text-zinc-400">{t.noNodes}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-md border border-zinc-200 p-4">
                    <h3 className="text-sm font-semibold text-zinc-800">{t.optionOperation}</h3>
                    <div className="mt-3 space-y-4">
                      {data?.categories.map((category) => (
                        <div key={category.id}>
                          <p className="text-xs font-semibold text-zinc-500">{category.name}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {category.options.map((option) => {
                              const selected = operationOptionIds.has(option.id);
                              const count = assignmentCounts.get(option.id) ?? 0;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    setOperationOptionIds((current) => {
                                      const next = new Set(current);
                                      if (next.has(option.id)) next.delete(option.id);
                                      else next.add(option.id);
                                      return next;
                                    });
                                  }}
                                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                                    selected ? "border-cyan-700 bg-cyan-700 text-white" : "border-zinc-200 text-zinc-600"
                                  }`}
                                >
                                  {selected ? <Check className="h-3 w-3" /> : null}
                                  <span>{option.name}</span>
                                  {selectedNodeIds.size > 0 ? <span className="opacity-70">{count}/{selectedNodeIds.size}</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-200 pt-4">
                      <button
                        type="button"
                        disabled={busy || selectedNodeIds.size === 0 || operationOptionIds.size === 0}
                        onClick={() => void updateAssignments("add")}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {busy ? t.saving : t.addToNodes}
                      </button>
                      <button
                        type="button"
                        disabled={busy || selectedNodeIds.size === 0 || operationOptionIds.size === 0}
                        onClick={() => void updateAssignments("remove")}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-300 bg-white px-4 text-sm font-medium text-rose-700 disabled:opacity-50"
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
    </div>
  );
}
