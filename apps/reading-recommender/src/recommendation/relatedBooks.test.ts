import { describe, expect, it } from "vitest";

import { findRelatedBooks } from "./relatedBooks";

import type { BookSnapshot } from "../shared/types";

function book(input: Partial<BookSnapshot> & Pick<BookSnapshot, "bookmeterUrl" | "title" | "remoteRank">): BookSnapshot {
  return {
    isbnOrAsin: null,
    author: "著者",
    publisher: "出版社",
    publishedDate: "2024",
    description: "",
    inWish: true,
    inStacked: false,
    sophiaLibraryStatus: "unknown",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "",
    utokyoOpacUrl: "",
    wishRowid: input.remoteRank,
    stackedRowid: null,
    remoteRankSource: "wish",
    contentHash: "hash",
    firstSeenAt: "2026-06-28T00:00:00.000Z",
    lastSeenAt: "2026-06-28T00:00:00.000Z",
    lastScanRunId: 1,
    ...input
  };
}

describe("findRelatedBooks", () => {
  it("keeps the lexical fallback ranking when semantic scores are unavailable", () => {
    const primary = book({
      bookmeterUrl: "primary",
      title: "確率 統計 入門",
      description: "測度 確率 統計",
      remoteRank: 1
    });
    const lexicalMatch = book({
      bookmeterUrl: "lexical",
      title: "確率 統計 入門",
      author: "別著者",
      publisher: "別出版社",
      description: "測度",
      remoteRank: 3
    });
    const authorMatch = book({
      bookmeterUrl: "author",
      title: "代数 幾何",
      author: "著者",
      publisher: "別出版社",
      remoteRank: 2
    });

    const related = findRelatedBooks({
      primary,
      candidates: [primary, authorMatch, lexicalMatch],
      limit: 5
    });

    expect(related.map((item) => item.bookmeterUrl)).toEqual(["lexical", "author"]);
    expect(related[0]?.score).toBeCloseTo(0.425);
    expect(related[1]?.score).toBeCloseTo(0.194444);
  });

  it("uses remote rank to break equal score ties", () => {
    const primary = book({ bookmeterUrl: "primary", title: "圏論 入門", remoteRank: 1 });
    const newer = book({ bookmeterUrl: "newer", title: "代数学", author: "著者", publisher: "別出版社", remoteRank: 2 });
    const older = book({ bookmeterUrl: "older", title: "解析学", author: "著者", publisher: "別出版社", remoteRank: 5 });

    const related = findRelatedBooks({ primary, candidates: [older, primary, newer], limit: 5 });

    expect(related.map((item) => item.bookmeterUrl)).toEqual(["newer", "older"]);
  });

  it("raises semantically close candidates when semantic scores are available", () => {
    const primary = book({ bookmeterUrl: "primary", title: "臨床 試験", remoteRank: 1 });
    const semanticMatch = book({
      bookmeterUrl: "semantic",
      title: "ベイズ 推論",
      author: "別著者",
      publisher: "別出版社",
      remoteRank: 9
    });
    const lexicalMatch = book({
      bookmeterUrl: "lexical",
      title: "臨床 試験 入門",
      author: "別著者",
      publisher: "別出版社",
      remoteRank: 2
    });

    const related = findRelatedBooks({
      primary,
      candidates: [primary, lexicalMatch, semanticMatch],
      limit: 5,
      semanticScoresByUrl: new Map([["semantic", 0.92]])
    });

    expect(related.map((item) => item.bookmeterUrl)).toEqual(["semantic", "lexical"]);
    expect(related[0]?.reasons).toContain("説明文の意味が近い候補です。");
  });
});
