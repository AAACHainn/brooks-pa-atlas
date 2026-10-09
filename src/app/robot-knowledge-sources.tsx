"use client";
import { memo } from "react";
import type { RobotKnowledgeSnapshot, RobotKnowledgeSource } from "@/lib/robot-knowledge-types";

function location(source: RobotKnowledgeSource, zh: boolean) {
  if (source.locator.kind === "text") return `${source.locator.headingPath.join(" / ")}${source.locator.headingPath.length ? " · " : ""}${zh ? "行" : "Lines"} ${source.locator.lineStart}–${source.locator.lineEnd}`;
  const time = (ms: number | null) => {
    if (ms === null) return "?";
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  return `${time(source.locator.startMs)}–${time(source.locator.endMs)}`;
}
export const RobotKnowledgeSources = memo(function RobotKnowledgeSources({ knowledge, locale }: { knowledge: RobotKnowledgeSnapshot | null | undefined; locale: "zh" | "en" }) {
  if (!knowledge) return null;
  const zh = locale === "zh";
  return <details className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600">
    <summary className="cursor-pointer font-medium text-cyan-800">{zh ? "参考资料" : "Reference materials"} · {knowledge.sources.length}</summary>
    <p className="mt-2 leading-5">{zh ? "以下正文页已提供给模型，回答采用的依据以正文引用为准。历史资料保存当时快照。" : "These text pages were provided to the model; answer citations identify the evidence used. History preserves the original snapshots."}</p>
    {!knowledge.sources.length ? <p className="mt-1 text-amber-800">{zh ? "本次没有读取到相关知识库正文。" : "No relevant knowledge text was read for this answer."}</p> : null}
    {knowledge.warnings.includes("semantic_unavailable") ? <p className="mt-1 text-amber-800">{zh ? "部分检索未使用向量，已使用全文和关键词检索。" : "Some searches used full text and keywords without semantic retrieval."}</p> : null}
    {knowledge.retrieval.embeddingRequests ? <p className="mt-1 text-zinc-500">Embedding {knowledge.retrieval.embeddingRequests} · {zh ? "输入估算" : "Estimated input"} {knowledge.retrieval.estimatedEmbeddingInputTokens.toLocaleString()} Token</p> : null}
    {knowledge.sources.map((source) => <details key={source.citation} className="mt-2 rounded-md border border-zinc-200 bg-white p-2">
      <summary className="cursor-pointer text-cyan-800">[{source.citation}] {source.lessonCode ? `${source.lessonCode} · ` : ""}{source.title} · v{source.versionNumber} · {location(source, zh)}</summary>
      <p className="mt-1 break-words text-[11px] text-zinc-500">{source.indexPath} · {source.page.partial ? (zh ? "部分读取" : "Partial read") : (zh ? "完整片段" : "Complete chunk")} · {source.page.offset + 1}–{source.page.offset + source.page.returned}/{source.page.total} {zh ? "字符" : "characters"}</p>
      <p className="mt-2 whitespace-pre-wrap break-words leading-5">{source.text}</p>
    </details>)}
  </details>;
});
