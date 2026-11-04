import { afterEach, describe, expect, it, vi } from "vitest";

import { searchBooks } from "@/features/search/api/search-books";
import { stubFetch } from "@/testing/fetch-mock";

describe("search requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: "only the search query",
      limit: undefined,
      filters: undefined,
      params: { q: "暗号" }
    },
    {
      name: "the requested search limit",
      limit: 20,
      filters: undefined,
      params: { q: "暗号", limit: "20" }
    },
    {
      name: "comma-separated search filters",
      limit: 20,
      filters: { lists: ["wish", "stacked"] as const, libraries: ["utokyo", "sophia"] as const },
      params: { q: "暗号", limit: "20", list: "wish,stacked", library: "utokyo,sophia" }
    }
  ])("sends $name", async ({ limit, filters, params }) => {
    const fetchMock = stubFetch();

    await searchBooks("暗号", limit, filters);

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, "http://localhost");
    const request = new Request(url, fetchMock.mock.calls[0]?.[1]);
    expect(url.pathname).toBe("/api/search");
    expect(Object.fromEntries(url.searchParams)).toEqual(params);
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
  });
});
