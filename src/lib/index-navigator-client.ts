export type NavigatorAssignment = {
  indexNodeId: string;
  optionId: string;
};

export type NavigatorOptionBase = {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  assignmentCount: number;
};

export type NavigatorCategoryBase = {
  id: string;
  name: string;
  sortOrder: number;
  assignmentCount: number;
  options: NavigatorOptionBase[];
};

export type NavigatorOptionWithMatches = NavigatorOptionBase & {
  matchCount: number;
};

export type NavigatorCategoryWithMatches = Omit<NavigatorCategoryBase, "options"> & {
  options: NavigatorOptionWithMatches[];
};

export type NavigatorResultNode = {
  id: string;
  name: string;
  path: string;
  depth: number;
  imageCount: number;
};

export type NavigatorAssignmentIndex = {
  nodeOptionIds: Map<string, Set<string>>;
  optionNodeIds: Map<string, Set<string>>;
};

const nodeCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildNavigatorAssignmentIndex(
  assignments: NavigatorAssignment[],
): NavigatorAssignmentIndex {
  const nodeOptionIds = new Map<string, Set<string>>();
  const optionNodeIds = new Map<string, Set<string>>();

  for (const assignment of assignments) {
    const nodeOptions = nodeOptionIds.get(assignment.indexNodeId) ?? new Set<string>();
    nodeOptions.add(assignment.optionId);
    nodeOptionIds.set(assignment.indexNodeId, nodeOptions);

    const optionNodes = optionNodeIds.get(assignment.optionId) ?? new Set<string>();
    optionNodes.add(assignment.indexNodeId);
    optionNodeIds.set(assignment.optionId, optionNodes);
  }

  return { nodeOptionIds, optionNodeIds };
}

export function normalizeNavigatorSelection(
  categories: NavigatorCategoryBase[],
  selectedOptionIds: Iterable<string>,
) {
  const selected = new Set(selectedOptionIds);
  const normalized = new Set<string>();

  for (const category of categories) {
    const selectedOption = category.options.find((option) => selected.has(option.id));
    if (selectedOption) normalized.add(selectedOption.id);
  }

  return normalized;
}

function selectedOptionByCategory(
  categories: NavigatorCategoryBase[],
  selectedOptionIds: Iterable<string>,
) {
  const normalized = normalizeNavigatorSelection(categories, selectedOptionIds);
  return new Map(
    categories.flatMap((category) => {
      const option = category.options.find((candidate) => normalized.has(candidate.id));
      return option ? [[category.id, option.id] as const] : [];
    }),
  );
}

export function addNavigatorMatchCounts(
  categories: NavigatorCategoryBase[],
  assignmentIndex: NavigatorAssignmentIndex,
  selectedOptionIds: Iterable<string>,
  validNodeIds?: ReadonlySet<string>,
): NavigatorCategoryWithMatches[] {
  const selectedByCategory = selectedOptionByCategory(categories, selectedOptionIds);

  return categories.map((category) => ({
    ...category,
    options: category.options.map((option) => {
      let matchCount = 0;
      for (const nodeId of assignmentIndex.optionNodeIds.get(option.id) ?? []) {
        if (validNodeIds && !validNodeIds.has(nodeId)) continue;
        const nodeOptions = assignmentIndex.nodeOptionIds.get(nodeId);
        if (!nodeOptions) continue;
        const matchesOtherCategories = [...selectedByCategory].every(
          ([categoryId, selectedOptionId]) =>
            categoryId === option.categoryId || nodeOptions.has(selectedOptionId),
        );
        if (matchesOtherCategories) matchCount += 1;
      }
      return { ...option, matchCount };
    }),
  }));
}

export function findLocalNavigatorResults(
  nodes: NavigatorResultNode[],
  categories: NavigatorCategoryBase[],
  assignmentIndex: NavigatorAssignmentIndex,
  selectedOptionIds: Iterable<string>,
  nodeQuery: string,
  requestedPage: number,
  pageSize: number,
) {
  const selectedByCategory = selectedOptionByCategory(categories, selectedOptionIds);
  const cleanQuery = nodeQuery.trim().toLowerCase();
  const hasQuery = selectedByCategory.size > 0 || Boolean(cleanQuery);
  const matched = hasQuery
    ? nodes.filter((node) => {
        const nodeOptions = assignmentIndex.nodeOptionIds.get(node.id);
        const matchesOptions = [...selectedByCategory.values()].every((optionId) =>
          nodeOptions?.has(optionId),
        );
        const matchesQuery =
          !cleanQuery ||
          node.name.toLowerCase().includes(cleanQuery) ||
          node.path.toLowerCase().includes(cleanQuery);
        return matchesOptions && matchesQuery;
      })
    : [];

  matched.sort((left, right) => nodeCollator.compare(left.path, right.path));
  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;

  return {
    results: matched.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages },
  };
}
