import type { MemoFilter } from "@/contexts/MemoFilterContext";

export function deriveSuggestedContentFromFilters(filters: MemoFilter[]): string | undefined {
  const tagFilter = filters.find((filter) => filter.factor === "tagSearch" && filter.value.trim());
  return tagFilter ? `#${tagFilter.value} ` : undefined;
}
