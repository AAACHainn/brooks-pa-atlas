export type ImageQueryKeyInput = {
  query: string;
  selectedIndexId: string | null;
  selectedTagIds: Iterable<string>;
  selectedNavigatorOptionIds: Iterable<string>;
  page: number;
  pageSize: number;
};

export function buildImageQueryKey(input: ImageQueryKeyInput) {
  const params = new URLSearchParams();
  params.set("scope", "images");
  const query = input.query.trim();
  if (query) params.set("q", query);
  if (input.selectedIndexId) params.set("indexId", input.selectedIndexId);
  for (const tagId of [...input.selectedTagIds].sort()) params.append("tagId", tagId);
  for (const optionId of [...input.selectedNavigatorOptionIds].sort()) {
    params.append("navigatorOptionId", optionId);
  }
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  return params.toString();
}
