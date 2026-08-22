import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { randomDrawWeights, scoreBooks } from "./scoring";

import type { ScoredBook } from "./scoring";
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

function scoredSnapshot(
  input: Partial<BookSnapshot> & Pick<BookSnapshot, "bookmeterUrl" | "title" | "remoteRank"> & {
    readonly score: number;
  }
): ScoredBook {
  const { score, ...bookInput } = input;

  return {
    ...snapshot(bookInput),
    score,
    scoreBreakdown: [],
    reasons: []
  };
}

describe("randomDrawWeights", () => {
  it("assigns 80% to stacked books and 20% to wish books proportionally within each tier", () => {
    const weights = randomDrawWeights([
      scoredSnapshot({ bookmeterUrl: "stacked-1", title: "積読本1", remoteRank: 1, score: 1, inStacked: true }),
      scoredSnapshot({ bookmeterUrl: "stacked-2", title: "積読本2", remoteRank: 2, score: 3, inStacked: true }),
      scoredSnapshot({ bookmeterUrl: "wish-1", title: "読みたい本1", remoteRank: 3, score: 2 }),
      scoredSnapshot({ bookmeterUrl: "wish-2", title: "読みたい本2", remoteRank: 4, score: 6 })
    ]);
    const stackedWeight = weights
      .filter(({ book }) => book.inStacked)
      .reduce((total, candidate) => total + candidate.weight, 0);
    const wishWeight = weights
      .filter(({ book }) => !book.inStacked)
      .reduce((total, candidate) => total + candidate.weight, 0);

    expect(stackedWeight).toBeCloseTo(0.8);
    expect(wishWeight).toBeCloseTo(0.2);
    expect(weights[0]?.weight).toBeCloseTo(0.2);
    expect(weights[1]?.weight).toBeCloseTo(0.6);
    expect(weights[2]?.weight).toBeCloseTo(0.05);
    expect(weights[3]?.weight).toBeCloseTo(0.15);
  });

  it("keeps scores as proportional weights when only stacked books remain", () => {
    const weights = randomDrawWeights([
      scoredSnapshot({ bookmeterUrl: "stacked-1", title: "積読本1", remoteRank: 1, score: 1, inStacked: true }),
      scoredSnapshot({ bookmeterUrl: "stacked-2", title: "積読本2", remoteRank: 2, score: 3, inStacked: true })
    ]);

    expect(weights.map(({ weight }) => weight)).toEqual([1, 3]);
  });

  it("keeps scores as proportional weights when only wish books remain", () => {
    const weights = randomDrawWeights([
      scoredSnapshot({ bookmeterUrl: "wish-1", title: "読みたい本1", remoteRank: 1, score: 2 }),
      scoredSnapshot({ bookmeterUrl: "wish-2", title: "読みたい本2", remoteRank: 2, score: 6 })
    ]);

    expect(weights.map(({ weight }) => weight)).toEqual([2, 6]);
  });
});

describe("scoreBooks", () => {
  it("excludes books whose title is a bibliographic placeholder", () => {
    const scored = scoreBooks(
      [
        snapshot({ bookmeterUrl: "openbd", title: "Not_found_in_OpenBD", remoteRank: 1 }),
        snapshot({ bookmeterUrl: "google", title: "Not_found_in_GoogleBooks", remoteRank: 2 }),
        snapshot({ bookmeterUrl: "api-error", title: "NDL_API_Error", remoteRank: 3 }),
        snapshot({ bookmeterUrl: "invalid", title: "INVALID_ISBN", remoteRank: 4 }),
        snapshot({ bookmeterUrl: "ok", title: "通常の本", remoteRank: 6 })
      ],
      DEFAULT_SETTINGS
    );

    expect(scored.map((book) => book.bookmeterUrl)).toEqual(["ok"]);
  });

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

  it("keeps an empty stacked book above a wish book with maximal non-list contributions", () => {
    const scored = scoreBooks(
      [
        snapshot({ bookmeterUrl: "wish-volume-1", title: "解析入門 1巻", remoteRank: 100 }),
        snapshot({ bookmeterUrl: "wish-volume-2", title: "解析入門 2巻", remoteRank: 50 }),
        snapshot({
          bookmeterUrl: "stacked",
          title: "",
          author: "",
          publisher: "",
          publishedDate: "",
          description: "",
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

    expect(scored.map((book) => book.bookmeterUrl)).toEqual(["stacked", "wish-volume-1", "wish-volume-2"]);
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
