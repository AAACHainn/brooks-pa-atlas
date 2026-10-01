const aliasesByKeyword: Record<string, string[]> = {
  h1: ["high 1", "high one", "高一", "一买"],
  h2: ["high 2", "high two", "高二", "二买"],
  l1: ["low 1", "low one", "低一", "一卖"],
  l2: ["low 2", "low two", "低二", "二卖"],
  mtr: ["major trend reversal", "主要趋势反转"],
};

export function normalizeKnowledgeKeyword(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function expandKnowledgeKeywords(values: Iterable<string>) {
  const expanded = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeKnowledgeKeyword(value);
    if (!normalized) continue;
    expanded.set(normalized, value.trim());
    for (const alias of aliasesByKeyword[normalized] ?? []) {
      expanded.set(normalizeKnowledgeKeyword(alias), alias);
    }
  }
  return [...expanded].map(([normalizedKeyword, keyword]) => ({ keyword, normalizedKeyword }));
}
