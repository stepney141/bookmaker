import { describe, expect, it } from "vitest";

import { snapshotOf, wishBook } from "../testing/books";

import { findRelatedBooks } from "./relatedBooks";

describe("findRelatedBooks", () => {
  it("keeps the lexical fallback ranking when semantic scores are unavailable", () => {
    const primary = snapshotOf(
      wishBook({
        bookmeterUrl: "primary",
        title: "確率 統計 入門",
        author: "著者",
        publisher: "出版社",
        description: "測度 確率 統計",
        remoteRank: 1
      })
    );
    const lexicalMatch = snapshotOf(
      wishBook({
        bookmeterUrl: "lexical",
        title: "確率 統計 入門",
        author: "別著者",
        publisher: "別出版社",
        description: "測度",
        remoteRank: 3
      })
    );
    const authorMatch = snapshotOf(
      wishBook({
        bookmeterUrl: "author",
        title: "代数 幾何",
        author: "著者",
        publisher: "別出版社",
        remoteRank: 2
      })
    );

    const related = findRelatedBooks({
      primary,
      candidates: [primary, authorMatch, lexicalMatch],
      limit: 5
    });

    expect(related.map((item) => item.bookmeterUrl)).toEqual(["lexical", "author"]);
  });

  it("uses remote rank to break equal score ties", () => {
    const primary = snapshotOf(
      wishBook({ bookmeterUrl: "primary", title: "圏論 入門", author: "著者", publisher: "出版社", remoteRank: 1 })
    );
    const newer = snapshotOf(
      wishBook({ bookmeterUrl: "newer", title: "代数学", author: "著者", publisher: "別出版社", remoteRank: 2 })
    );
    const older = snapshotOf(
      wishBook({ bookmeterUrl: "older", title: "解析学", author: "著者", publisher: "別出版社", remoteRank: 5 })
    );

    const related = findRelatedBooks({ primary, candidates: [older, primary, newer], limit: 5 });

    expect(related.map((item) => item.bookmeterUrl)).toEqual(["newer", "older"]);
  });

  it("raises semantically close candidates when semantic scores are available", () => {
    const primary = snapshotOf(
      wishBook({ bookmeterUrl: "primary", title: "臨床 試験", author: "著者", publisher: "出版社", remoteRank: 1 })
    );
    const semanticMatch = snapshotOf(
      wishBook({
        bookmeterUrl: "semantic",
        title: "ベイズ 推論",
        author: "別著者",
        publisher: "別出版社",
        remoteRank: 9
      })
    );
    const lexicalMatch = snapshotOf(
      wishBook({
        bookmeterUrl: "lexical",
        title: "臨床 試験 入門",
        author: "別著者",
        publisher: "別出版社",
        remoteRank: 2
      })
    );

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
