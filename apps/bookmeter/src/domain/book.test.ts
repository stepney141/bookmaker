import { describe, expect, it } from "vitest";

import { makeBook, toBookList } from "../testing/books";

import { isBookListDifferent } from "./book";

describe("isBookListDifferent", () => {
  it("detects a newly added book", () => {
    expect(
      isBookListDifferent(toBookList([makeBook("old-1")]), toBookList([makeBook("new-1"), makeBook("old-1")]))
    ).toBe(true);
  });

  it("detects a removed book", () => {
    expect(
      isBookListDifferent(toBookList([makeBook("old-1"), makeBook("old-2")]), toBookList([makeBook("old-1")]))
    ).toBe(true);
  });

  it("detects when the book order changes", () => {
    expect(
      isBookListDifferent(
        toBookList([makeBook("old-1"), makeBook("old-2")]),
        toBookList([makeBook("old-2"), makeBook("old-1")])
      )
    ).toBe(true);
  });

  it("returns false when both content and order are unchanged", () => {
    expect(
      isBookListDifferent(
        toBookList([makeBook("old-1"), makeBook("old-2")]),
        toBookList([makeBook("old-1"), makeBook("old-2")])
      )
    ).toBe(false);
  });
});
