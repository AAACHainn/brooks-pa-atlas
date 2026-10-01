import path from "node:path";

export type KnowledgeMappingNode = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
};

export type KnowledgeImportMappingStatus = "EXACT" | "FUZZY" | "AMBIGUOUS" | "UNMATCHED";

export type KnowledgeImportMapping = {
  fileName: string;
  status: KnowledgeImportMappingStatus;
  selectedIndexNodeId: string | null;
  candidates: KnowledgeMappingNode[];
};

type ScoredNode = {
  node: KnowledgeMappingNode;
  score: number;
};

function compact(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function fileTokens(value: string) {
  return (value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [])
    .map(compact)
    .filter(Boolean);
}

function isLessonCodeName(value: string) {
  const trimmed = value.normalize("NFKC").trim();
  return /\d/u.test(trimmed)
    && /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(trimmed)
    && compact(trimmed).length <= 16;
}

function scoreNode(stem: string, node: KnowledgeMappingNode): number | null {
  const stemKey = compact(stem);
  const nodeKey = compact(node.name);
  if (!stemKey || !nodeKey) return null;
  if (stemKey === nodeKey) return 1_000;

  // Course codes such as 19D and 40A must match a complete filename token.
  // This prevents 19 from matching 19D and 19D from matching 119D or 19D-0.
  if (isLessonCodeName(node.name)) {
    return fileTokens(stem).includes(nodeKey) ? 900 + Math.min(nodeKey.length, 50) : null;
  }

  // Retain conservative filename/name containment matching for descriptive nodes.
  if (nodeKey.length >= 4 && stemKey.includes(nodeKey)) return 700 + Math.min(nodeKey.length, 100);
  if (stemKey.length >= 4 && nodeKey.includes(stemKey)) return 600 + Math.min(stemKey.length, 100);
  return null;
}

function sortScoredNodes(left: ScoredNode, right: ScoredNode) {
  return right.score - left.score
    || left.node.path.localeCompare(right.node.path, undefined, { numeric: true, sensitivity: "base" });
}

export function previewKnowledgeImportMapping(
  fileName: string,
  nodes: KnowledgeMappingNode[],
): KnowledgeImportMapping {
  const stem = path.basename(fileName, path.extname(fileName));
  const scored = nodes
    .map((node): ScoredNode | null => {
      const score = scoreNode(stem, node);
      return score === null ? null : { node, score };
    })
    .filter((entry): entry is ScoredNode => entry !== null)
    .sort(sortScoredNodes);

  if (!scored.length) {
    return { fileName, status: "UNMATCHED", selectedIndexNodeId: null, candidates: [] };
  }

  const highestScore = scored[0].score;
  const highest = scored.filter((entry) => entry.score === highestScore);
  const uniqueHighest = highest.length === 1 ? highest[0] : null;
  return {
    fileName,
    status: uniqueHighest ? (highestScore === 1_000 ? "EXACT" : "FUZZY") : "AMBIGUOUS",
    selectedIndexNodeId: uniqueHighest?.node.id ?? null,
    candidates: scored.slice(0, 10).map((entry) => entry.node),
  };
}

export function previewKnowledgeImportMappings(
  fileNames: string[],
  nodes: KnowledgeMappingNode[],
) {
  return fileNames.map((fileName) => previewKnowledgeImportMapping(fileName, nodes));
}
