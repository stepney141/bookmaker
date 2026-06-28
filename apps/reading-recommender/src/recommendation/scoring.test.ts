import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { scoreBooks } from "./scoring";

import type { BookSnapshot } from "../shared/types";

function snapshot(
  input: Partial<BookSnapshot> & Pick<BookSnapshot, "bookmeterUrl" | "title" | "remoteRank">
): BookSnapshot {
  return {
    isbnOrAsin: null,
    author: "著者",
    publisher: "出版社",
    publishedDate: "2024",
    description: "説明文があります。",
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

  it("prioritizes the first named part within the same series", () => {
    const scored = scoreBooks(
      [
        snapshot({ bookmeterUrl: "lower", title: "数学講義 下巻", remoteRank: 100 }),
        snapshot({ bookmeterUrl: "middle", title: "数学講義 中巻", remoteRank: 50 }),
        snapshot({ bookmeterUrl: "upper", title: "数学講義 上巻", remoteRank: 1 })
      ],
      DEFAULT_SETTINGS
    );

    expect(scored.map((book) => book.bookmeterUrl)).toEqual(["upper", "middle", "lower"]);
  });

  it("prioritizes volume 1 within the same numbered series", () => {
    const scored = scoreBooks(
      [
        snapshot({ bookmeterUrl: "volume-2", title: "解析入門 2巻", remoteRank: 100 }),
        snapshot({ bookmeterUrl: "volume-1", title: "解析入門 1巻", remoteRank: 1 })
      ],
      DEFAULT_SETTINGS
    );

    expect(scored.map((book) => book.bookmeterUrl)).toEqual(["volume-1", "volume-2"]);
  });

  it("detects a named part before a trailing publication note", () => {
    const scored = scoreBooks(
      [
        snapshot({ bookmeterUrl: "lower", title: "美味礼讃 下 (岩波文庫)", remoteRank: 100 }),
        snapshot({ bookmeterUrl: "upper", title: "美味礼讃　上", remoteRank: 1 })
      ],
      DEFAULT_SETTINGS
    );

    expect(scored.map((book) => book.bookmeterUrl)).toEqual(["upper", "lower"]);
  });

  it("keeps the series-order reason on the earliest volume", () => {
    const scored = scoreBooks(
      [
        snapshot({ bookmeterUrl: "volume-2", title: "代数学 第2巻", remoteRank: 10 }),
        snapshot({ bookmeterUrl: "volume-1", title: "代数学 第1巻", remoteRank: 1 })
      ],
      DEFAULT_SETTINGS
    );

    expect(scored[0]?.scoreBreakdown.find((item) => item.id === "seriesOrder")).toMatchObject({
      value: 1,
      explanation: "同一シリーズ内で最も若い巻です。"
    });
  });
});
