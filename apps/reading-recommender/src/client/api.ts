import type {
  AppSettings,
  CurrentRecommendation,
  RowOrderDiagnostics,
  SearchFilters,
  SearchResult
} from "../shared/types";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body !== undefined && init.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function fetchCurrentRecommendation(): Promise<CurrentRecommendation | null> {
  return requestJson<CurrentRecommendation | null>("/api/recommendations/current");
}

export function runRecommendation(): Promise<CurrentRecommendation | null> {
  return requestJson<CurrentRecommendation | null>("/api/recommendations/run", { method: "POST" });
}

export function skipRecommendation(): Promise<CurrentRecommendation | null> {
  return requestJson<CurrentRecommendation | null>("/api/recommendations/skip", { method: "POST" });
}

export function promoteRecommendation(bookmeterUrl: string): Promise<CurrentRecommendation | null> {
  return requestJson<CurrentRecommendation | null>("/api/recommendations/promote", {
    method: "POST",
    body: JSON.stringify({ bookmeterUrl })
  });
}

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

export function fetchSettings(): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/settings");
}

export function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(settings)
  });
}

export function fetchDiagnostics(): Promise<readonly RowOrderDiagnostics[]> {
  return requestJson<readonly RowOrderDiagnostics[]>("/api/books/diagnostics/row-order");
}
