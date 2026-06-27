import { describe, expect, it } from "vitest";

import {
  SEARCH_MAX_RESULTS,
  SEARCH_PAGE_SIZE,
  canLoadMoreSearchResults,
  nextSearchLimit
} from "./searchLimits";

describe("search result limits", () => {
  it("starts at 10 and advances by 10 up to 100", () => {
    expect(SEARCH_PAGE_SIZE).toBe(10);
    expect(SEARCH_MAX_RESULTS).toBe(100);
    expect(nextSearchLimit(10)).toBe(20);
    expect(nextSearchLimit(90)).toBe(100);
    expect(nextSearchLimit(100)).toBe(100);
  });

  it("allows loading more only when the current result page is full and below the maximum", () => {
    expect(canLoadMoreSearchResults({ resultCount: 10, currentLimit: 10 })).toBe(true);
    expect(canLoadMoreSearchResults({ resultCount: 9, currentLimit: 10 })).toBe(false);
    expect(canLoadMoreSearchResults({ resultCount: 100, currentLimit: 100 })).toBe(false);
  });
});
