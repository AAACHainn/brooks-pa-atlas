"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  ImageIcon,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type IndexTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: string;
  sortOrder: number;
  imageCount: number;
  children: IndexTreeNode[];
};

type IndexTreeSelectorProps = {
  className?: string;
  invalid?: boolean;
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

export function flattenIndexTree(nodes: IndexTreeNode[]) {
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

export default function IndexTreeSelector({
  className,
  invalid = false,
  labels,
  nodes,
  onChange,
  value,
}: IndexTreeSelectorProps) {
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
  const flatNodes = useMemo(() => flattenIndexTree(nodes), [nodes]);
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
    if (!rect) return;

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
    if (navigableIds.length === 0) return;

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
            className="fixed z-[100] flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/15"
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
                              if (!hasChildren) return;
                              setExpandedIds((current) => {
                                const next = new Set(current);
                                if (next.has(node.id)) next.delete(node.id);
                                else next.add(node.id);
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
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
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
        className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-100 ${
          invalid
            ? "border-amber-400 bg-amber-50 hover:border-amber-500"
            : isOpen
              ? "border-cyan-600 bg-white ring-2 ring-cyan-100"
              : "border-zinc-200 bg-white hover:border-cyan-300"
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
