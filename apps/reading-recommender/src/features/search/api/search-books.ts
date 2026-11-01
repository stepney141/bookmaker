import { requestJson } from "@/lib/api-client";

import type { SearchFilters, SearchResult } from "@/types/api";

export function searchBooks(query: string, limit?: number, filters?: SearchFilters): Promise<readonly SearchResult[]> {
  const params = new URLSearchParams({ q: query });

  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  if (filters && filters.lists.length > 0) {
    params.set("list", filters.lists.join(","));
  }
  if (filters && filters.libraries.length > 0) {
    params.set("library", filters.libraries.join(","));
  }

  return requestJson<readonly SearchResult[]>(`/api/search?${params.toString()}`);
}
