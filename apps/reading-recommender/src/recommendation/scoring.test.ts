import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { scoreBooks } from "./scoring";

import type { BookSnapshot } from "../shared/types";

function snapshot(input: Partial<BookSnapshot> & Pick<BookSnapshot, "bookmeterUrl" | "title" | "remoteRank">): BookSnapshot {
  return {
    isbnOrAsin: null,
    author: "著者",
    publisher: "出版社",
    publishedDate: "2024",
    description: "説明文があります。",
    inWish: true,
    inStacked: false,
    wishRowid: input.remoteRank,
    stackedRowid: null,
    remoteRankSource: "wish",
    contentHash: "hash",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    lastScanRunId: 1,
    ...input
  };
}

describe("scoreBooks", () => {
  it("prioritizes stacked books over wish books even when the wish book has older remote rank", () => {
    const scored = scoreBooks(
      [
        snapshot({ bookmeterUrl: "wish", title: "古い読みたい本", remoteRank: 100 }),
        snapshot({
          bookmeterUrl: "stacked",
          title: "新しい積読本",
          remoteRank: 1,
          inStacked: true,
          inWish: false,
          stackedRowid: 1,
          wishRowid: null,
          remoteRankSource: "stacked"
        })
      ],
      DEFAULT_SETTINGS
    );

    expect(scored[0]?.bookmeterUrl).toBe("stacked");
  });
});
