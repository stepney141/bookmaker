import { describe, expect, it } from "vitest";

import { makeBook } from "../testing/books";
import { sourceBooksContract } from "../testing/sourceBooksContract";

import { hasCompleteCachedBiblio, shouldFetchBibliographicData, shouldFetchLibraryHoldings } from "./cachePolicy";

describe("hasCompleteCachedBiblio", () => {
  it("accepts a fully populated cached book", () => {
    expect(hasCompleteCachedBiblio(makeBook("https://bookmeter.com/books/1"))).toBe(true);
  });

  // README cache rules apply independently to each of the four bibliographic fields.
  it.each(
    ["book_title", "author", "publisher", "published_date"].flatMap((field) =>
      [...sourceBooksContract.placeholderTitles, "", " \t ", "[object Object]", " [object Object] "].map((value) => ({
        field,
        value
      }))
    )
  )('treats $field = "$value" as missing', ({ field, value }) => {
    expect(hasCompleteCachedBiblio(makeBook("https://bookmeter.com/books/1", { [field]: value }))).toBe(false);
  });
});

describe("shouldFetchBibliographicData", () => {
  it("fetches when cached data is incomplete and refetch is disabled", () => {
    expect(shouldFetchBibliographicData(makeBook("https://bookmeter.com/books/1", { book_title: "" }), false)).toBe(
      true
    );
  });

  it("skips API fetches when complete cached data exists", () => {
    expect(shouldFetchBibliographicData(makeBook("https://bookmeter.com/books/1"), false)).toBe(false);
  });

  it("forces API fetches when requested", () => {
    expect(shouldFetchBibliographicData(makeBook("https://bookmeter.com/books/1"), true)).toBe(true);
  });
});

describe("shouldFetchLibraryHoldings", () => {
  it("skips holdings lookup for cached books unless force is enabled", () => {
    const cachedBookUrls = new Set(["https://bookmeter.com/books/1"]);
    expect(shouldFetchLibraryHoldings(makeBook("https://bookmeter.com/books/1"), false, cachedBookUrls)).toBe(false);
    expect(shouldFetchLibraryHoldings(makeBook("https://bookmeter.com/books/1"), true, cachedBookUrls)).toBe(true);
  });

  it("fetches holdings for uncached books", () => {
    expect(shouldFetchLibraryHoldings(makeBook("https://bookmeter.com/books/1"), false, new Set())).toBe(true);
  });
});
