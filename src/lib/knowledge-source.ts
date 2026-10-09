import path from "node:path";


import type {
  KnowledgeLocator,
  KnowledgeSourceFormat,
  SubtitleKnowledgeLocator,
} from "@/lib/knowledge-types";

import { knowledgeLocatorSchema } from "@/lib/knowledge-locator-schema";
export { knowledgeLocatorSchema } from "@/lib/knowledge-locator-schema";

export function sourceFormatForFileName(fileName: string): KnowledgeSourceFormat {
  switch (path.extname(fileName).toLocaleLowerCase()) {
    case ".srt": return "SRT";
    case ".vtt": return "VTT";
    case ".ass": return "ASS";
    case ".txt": return "TXT";
    case ".md":
    case ".markdown": return "MARKDOWN";
    case ".pdf": return "PDF";
    case ".epub": return "EPUB";
    case ".docx": return "DOCX";
    case ".htm":
    case ".html": return "HTML";
    default: return "OTHER";
  }
}

export function subtitleLocator(input: {
  cueStart: number;
  cueEnd: number;
  startMs: number | null;
  endMs: number | null;
}): SubtitleKnowledgeLocator {
  return { v: 1, kind: "subtitle", ...input };
}

export function serializeKnowledgeLocator(locator: KnowledgeLocator) {
  return JSON.stringify(knowledgeLocatorSchema.parse(locator));
}

export function parseKnowledgeLocator(
  value: string | null | undefined,
  fallback?: Omit<SubtitleKnowledgeLocator, "v" | "kind">,
): KnowledgeLocator {
  try {
    return knowledgeLocatorSchema.parse(JSON.parse(value ?? ""));
  } catch {
    if (!fallback) throw new Error("Knowledge chunk locator is invalid.");
    return subtitleLocator(fallback);
  }
}

export function knowledgeLocatorLabel(locator: KnowledgeLocator) {
  if (locator.kind === "text") {
    const heading = locator.headingPath.filter(Boolean).join(" / ");
    return `${heading ? `${heading}；` : ""}行 ${locator.lineStart}-${locator.lineEnd}`;
  }
  const start = locator.startMs === null ? "?" : `${locator.startMs}ms`;
  const end = locator.endMs === null ? "?" : `${locator.endMs}ms`;
  return `${start}-${end}`;
}

export function knowledgeTextForIndex(locator: KnowledgeLocator, text: string) {
  return locator.kind === "text" && locator.headingPath.length
    ? `${locator.headingPath.join(" / ")}\n${text}`
    : text;
}
