export type SubtitleCue = {
  id: number;
  startMs: number | null;
  endMs: number | null;
  text: string;
};

export type KnowledgeProcessedSegment = {
  cueIds: number[];
  cleanedText: string;
  topic: string;
  keywords: string[];
};

export type KnowledgeSource = {
  id: string;
  documentId: string;
  versionId: string;
  title: string;
  lessonCode: string | null;
  indexNodeId: string | null;
  indexPath: string;
  startMs: number | null;
  endMs: number | null;
  text: string;
  topic: string;
  keywords: string[];
  scope: "current" | "related";
  citation: string;
  score: number;
};

export type KnowledgeContextSnapshot = {
  sources: KnowledgeSource[];
  semanticSearchUsed: boolean;
  hasCurrentBinding: boolean;
  warning: "semantic_unavailable" | "no_current_binding" | null;
};

export type KnowledgeImportJobSnapshot = {
  id: string;
  status: string;
  phase: string;
  manualReview: boolean;
  totalItems: number;
  processedItems: number;
  completedItems: number;
  failedItems: number;
  error: string | null;
  items: Array<{
    id: string;
    sourceFileName: string;
    targetIndexNodeId: string;
    targetIndexPath: string;
    documentId: string | null;
    versionId: string | null;
    status: string;
    phase: string;
    retryCount: number;
    error: string | null;
  }>;
};
