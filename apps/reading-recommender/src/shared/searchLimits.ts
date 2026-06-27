export const SEARCH_PAGE_SIZE = 10;
export const SEARCH_MAX_RESULTS = 100;

export function nextSearchLimit(currentLimit: number): number {
  return Math.min(currentLimit + SEARCH_PAGE_SIZE, SEARCH_MAX_RESULTS);
}

export function canLoadMoreSearchResults(input: {
  readonly resultCount: number;
  readonly currentLimit: number;
}): boolean {
  return input.resultCount >= input.currentLimit && input.currentLimit < SEARCH_MAX_RESULTS;
}
