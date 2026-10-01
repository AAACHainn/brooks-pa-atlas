"use client";

import { Folder, Loader2, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import IndexTreeSelector, {
  flattenIndexTree,
  type IndexTreeNode,
} from "@/app/index-tree-selector";

export type KnowledgeVersionRow = {
  id: string;
  versionNumber: number;
  sourceFileName: string;
  status: string;
  approvalMode: string;
  chunkCount: number;
  vectorCount: number;
  error: string | null;
};

export type KnowledgeDocumentRow = {
  id: string;
  title: string;
  lessonCode: string | null;
  indexNodeId: string | null;
  indexPathSnapshot: string;
  bindingStatus: string;
  chunkCount: number;
  activeVersionId: string | null;
  versions: KnowledgeVersionRow[];
};

export type KnowledgeMaintenanceJob = {
  id: string;
  status: string;
  totalItems: number;
  processedItems: number;
  error: string | null;
};

type Props = {
  busy: boolean;
  deletingVersionId: string | null;
  documents: KnowledgeDocumentRow[];
  indexTree: IndexTreeNode[];
  initialIndexNodeId: string | null;
  locale: "zh" | "en";
  maintenanceJob: KnowledgeMaintenanceJob | null;
  onActivate: (document: KnowledgeDocumentRow, version: KnowledgeVersionRow) => void;
  onDeleteDocument: (document: KnowledgeDocumentRow) => void;
  onDeleteVersion: (document: KnowledgeDocumentRow, version: KnowledgeVersionRow) => void;
  onPatchDocument: (document: KnowledgeDocumentRow, patch: { indexNodeId?: string; enabled?: boolean }) => void;
  onRunMaintenance: (kind: "fts" | "embeddings") => void;
};

const copy = {
  zh: {
    active: "当前版本",
    activate: "回退/启用此版本",
    all: "全部文档",
    chunks: "片段",
    delete: "删除文档",
    deleteVersion: "删除版本",
    disable: "停用",
    empty: "当前父节点下没有知识文档。",
    enable: "启用",
    mapping: "关联索引",
    noMatchingIndex: "没有匹配的索引",
    noParent: "未关联或父节点缺失",
    parentNodes: "父节点",
    rebuildFts: "重建全文索引",
    rebuildVectors: "重建全部向量",
    search: "搜索标题、课号或路径",
    vectors: "向量",
    collapseIndex: "收起索引",
    expandIndex: "展开索引",
    searchIndex: "搜索索引名称或路径",
  },
  en: {
    active: "Active version",
    activate: "Activate this version",
    all: "All documents",
    chunks: "chunks",
    delete: "Delete document",
    deleteVersion: "Delete version",
    disable: "Disable",
    empty: "No knowledge documents under this parent node.",
    enable: "Enable",
    mapping: "Linked index",
    noMatchingIndex: "No matching index",
    noParent: "Unlinked or missing parent",
    parentNodes: "Parent nodes",
    rebuildFts: "Rebuild full-text index",
    rebuildVectors: "Rebuild all vectors",
    search: "Search title, lesson code, or path",
    vectors: "vectors",
    collapseIndex: "Collapse index",
    expandIndex: "Expand index",
    searchIndex: "Search index name or path",
  },
} as const;

const ALL_GROUP = "__all__";
const UNBOUND_GROUP = "__unbound__";

export default function KnowledgeLibraryPanel({
  busy,
  deletingVersionId,
  documents,
  indexTree,
  initialIndexNodeId,
  locale,
  maintenanceJob,
  onActivate,
  onDeleteDocument,
  onDeleteVersion,
  onPatchDocument,
  onRunMaintenance,
}: Props) {
  const t = copy[locale];
  const indexes = useMemo(() => flattenIndexTree(indexTree), [indexTree]);
  const indexById = useMemo(() => new Map(indexes.map((node) => [node.id, node])), [indexes]);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const groupIdForDocument = useMemo(() => {
    const result = new Map<string, string>();
    for (const document of documents) {
      const node = document.indexNodeId ? indexById.get(document.indexNodeId) : null;
      const parent = node?.parentId ? indexById.get(node.parentId) : node;
      result.set(document.id, parent?.id ?? UNBOUND_GROUP);
    }
    return result;
  }, [documents, indexById]);

  const parentGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      const groupId = groupIdForDocument.get(document.id) ?? UNBOUND_GROUP;
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => {
      const node = indexById.get(id);
      return { id, count, name: node?.name ?? t.noParent, path: node?.path ?? t.noParent };
    }).sort((left, right) => left.path.localeCompare(right.path, locale === "zh" ? "zh-CN" : "en", { numeric: true }));
  }, [documents, groupIdForDocument, indexById, locale, t.noParent]);

  const initialNode = initialIndexNodeId ? indexById.get(initialIndexNodeId) : null;
  const initialParentId = initialNode?.parentId ?? initialNode?.id;
  const effectiveParentId = selectedParentId === ALL_GROUP
    ? ALL_GROUP
    : selectedParentId && parentGroups.some((group) => group.id === selectedParentId)
      ? selectedParentId
      : initialParentId && parentGroups.some((group) => group.id === initialParentId)
        ? initialParentId
        : ALL_GROUP;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleDocuments = useMemo(() => documents.filter((document) => {
    if (effectiveParentId !== ALL_GROUP && groupIdForDocument.get(document.id) !== effectiveParentId) return false;
    if (!normalizedQuery) return true;
    const versionNames = document.versions.map((version) => version.sourceFileName).join("\n");
    return `${document.title}\n${document.lessonCode ?? ""}\n${document.indexPathSnapshot}\n${versionNames}`
      .toLocaleLowerCase().includes(normalizedQuery);
  }), [documents, effectiveParentId, groupIdForDocument, normalizedQuery]);

  const selectedGroup = parentGroups.find((group) => group.id === effectiveParentId);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => onRunMaintenance("fts")} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">{t.rebuildFts}</button>
      <button type="button" disabled={busy || maintenanceJob?.status === "RUNNING"} onClick={() => onRunMaintenance("embeddings")} className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50">{t.rebuildVectors}</button>
      {maintenanceJob ? <span className={`text-xs ${maintenanceJob.status === "FAILED" ? "text-rose-700" : "text-zinc-500"}`}>{maintenanceJob.processedItems}/{maintenanceJob.totalItems} · {maintenanceJob.status}{maintenanceJob.error ? ` · ${maintenanceJob.error}` : ""}</span> : null}
    </div>

    <div className="grid h-[min(38rem,calc(100vh-14rem))] min-h-80 grid-rows-[12rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-zinc-200 bg-white md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1">
      <aside className="flex min-h-0 flex-col border-b border-zinc-200 bg-zinc-50 md:border-b-0 md:border-r md:border-zinc-200">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-800">{t.parentNodes}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">{parentGroups.length} · {documents.length}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          <button type="button" onClick={() => setSelectedParentId(ALL_GROUP)} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${effectiveParentId === ALL_GROUP ? "bg-cyan-100 font-medium text-cyan-900" : "text-zinc-700 hover:bg-white"}`}><Folder className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{t.all}</span><span className="text-xs text-zinc-500">{documents.length}</span></button>
          {parentGroups.map((group) => <button key={group.id} type="button" title={group.path} onClick={() => setSelectedParentId(group.id)} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${effectiveParentId === group.id ? "bg-cyan-100 font-medium text-cyan-900" : "text-zinc-700 hover:bg-white"}`}><Folder className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate">{group.name}</span><span className="block truncate text-[11px] font-normal text-zinc-400">{group.path}</span></span><span className="text-xs text-zinc-500">{group.count}</span></button>)}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
          <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-zinc-800">{selectedGroup?.name ?? t.all}</h3><p className="truncate text-xs text-zinc-500">{selectedGroup?.path ?? `${visibleDocuments.length} / ${documents.length}`}</p></div>
          <label className="relative min-w-56 flex-1 md:max-w-sm"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /></label>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50/40 p-4">
          {visibleDocuments.length ? visibleDocuments.map((document) => <article key={document.id} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1"><h4 className="truncate font-semibold text-zinc-900">{document.lessonCode ? `${document.lessonCode} · ` : ""}{document.title}</h4><p className="mt-1 truncate text-xs text-zinc-500">{document.indexPathSnapshot} · {document.bindingStatus} · {document.chunkCount} {t.chunks}</p><IndexTreeSelector className="mt-3 max-w-xl" value={document.indexNodeId ?? ""} onChange={(indexNodeId) => indexNodeId && onPatchDocument(document, { indexNodeId })} nodes={indexTree} invalid={!document.indexNodeId} labels={{ choose: t.mapping, collapse: t.collapseIndex, expand: t.expandIndex, noResults: t.noMatchingIndex, searchPlaceholder: t.searchIndex, unclassified: t.noParent }} /></div>
              <button type="button" onClick={() => onPatchDocument(document, { enabled: document.bindingStatus === "DISABLED" })} className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50">{document.bindingStatus === "DISABLED" ? t.enable : t.disable}</button>
              <button type="button" onClick={() => onDeleteDocument(document)} className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-100"><Trash2 className="mr-1 inline h-3 w-3" />{t.delete}</button>
            </div>
            <div className="mt-3 space-y-2">{document.versions.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"><span className="min-w-0 flex-1 truncate">v{version.versionNumber} · {version.sourceFileName} · {version.status}</span><span className="rounded-full bg-white px-2 py-0.5 text-zinc-500 ring-1 ring-zinc-200">{version.chunkCount} {t.chunks}</span><span className="rounded-full bg-white px-2 py-0.5 text-zinc-500 ring-1 ring-zinc-200">{version.vectorCount} {t.vectors}</span>{document.activeVersionId === version.id ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">{t.active}</span> : <>{version.status === "INACTIVE" && version.chunkCount > 0 ? <button type="button" className="font-medium text-cyan-700 hover:text-cyan-900" onClick={() => onActivate(document, version)}>{t.activate}</button> : null}{["INACTIVE", "FAILED", "REJECTED"].includes(version.status) ? <button type="button" disabled={deletingVersionId === version.id} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50" onClick={() => onDeleteVersion(document, version)}>{deletingVersionId === version.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}{t.deleteVersion}</button> : null}</>}</div>)}</div>
          </article>) : <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">{t.empty}</div>}
        </div>
      </section>
    </div>
  </div>;
}
