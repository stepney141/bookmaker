import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../settings";
import { scoredOf, snapshotOf, stackedBook, wishBook } from "../testing/books";
import { sourceBooksContract } from "../testing/sourceDb";

import { randomDrawWeights, scoreBooks } from "./scoring";

describe("randomDrawWeights", () => {
  it("assigns 80% to stacked books and 20% to wish books proportionally within each tier", () => {
    const weights = randomDrawWeights([
      scoredOf(stackedBook({ bookmeterUrl: "stacked-1", title: "積読本1", remoteRank: 1 }), 1),
      scoredOf(stackedBook({ bookmeterUrl: "stacked-2", title: "積読本2", remoteRank: 2 }), 3),
      scoredOf(wishBook({ bookmeterUrl: "wish-1", title: "読みたい本1", remoteRank: 3 }), 2),
      scoredOf(wishBook({ bookmeterUrl: "wish-2", title: "読みたい本2", remoteRank: 4 }), 6)
    ]);

    expect(weights[0]?.weight).toBeCloseTo(0.2);
    expect(weights[1]?.weight).toBeCloseTo(0.6);
    expect(weights[2]?.weight).toBeCloseTo(0.05);
    expect(weights[3]?.weight).toBeCloseTo(0.15);
  });

  it.each([
    { list: "stacked", bookInList: stackedBook, scores: [1, 3] },
    { list: "wish", bookInList: wishBook, scores: [2, 6] }
  ])("keeps a 1:3 weight ratio when only $list books remain", ({ bookInList, scores }) => {
    const weights = randomDrawWeights([
      scoredOf(bookInList({ bookmeterUrl: "book-1", title: "本1", remoteRank: 1 }), scores[0]),
      scoredOf(bookInList({ bookmeterUrl: "book-2", title: "本2", remoteRank: 2 }), scores[1])
    ]);

    expect(weights[1].weight / weights[0].weight).toBeCloseTo(3);
  });
});

describe("scoreBooks", () => {
  it("excludes books whose title is a bibliographic placeholder", () => {
    const { placeholderTitles } = sourceBooksContract;
    const scored = scoreBooks(
      [
        ...placeholderTitles.map((title, index) =>
          snapshotOf(wishBook({ bookmeterUrl: `placeholder-${index + 1}`, title, remoteRank: index + 1 }))
        ),
        snapshotOf(wishBook({ bookmeterUrl: "ok", title: "通常の本", remoteRank: placeholderTitles.length + 1 }))
      ],
      DEFAULT_SETTINGS
    );

    expect(scored.map((book) => book.bookmeterUrl)).toEqual(["ok"]);
  });

  it("keeps an empty stacked book above a wish book with maximal non-list contributions", () => {
    const scored = scoreBooks(
      [
        snapshotOf(
          wishBook({
            bookmeterUrl: "wish-volume-1",
            title: "解析入門 1巻",
            author: "著者",
            publisher: "出版社",
            publishedDate: "2024",
            description: "説明文があります。",
            remoteRank: 100
          })
        ),
        snapshotOf(
          wishBook({
            bookmeterUrl: "wish-volume-2",
            title: "解析入門 2巻",
            author: "著者",
            publisher: "出版社",
            publishedDate: "2024",
            description: "説明文があります。",
            remoteRank: 50
          })
        ),
        snapshotOf(stackedBook({ bookmeterUrl: "stacked", title: "", remoteRank: 1 }))
      ],
      DEFAULT_SETTINGS
    );

    expect(scored.map((book) => book.bookmeterUrl)).toEqual(["stacked", "wish-volume-1", "wish-volume-2"]);
  });

  it("includes the list-priority explanation and excludes the zero-valued novelty explanation", () => {
    const [scored] = scoreBooks(
      [snapshotOf(stackedBook({ bookmeterUrl: "stacked", title: "積読本", remoteRank: 1 }))],
      DEFAULT_SETTINGS
    );
    const listPriority = scored.scoreBreakdown.find((item) => item.id === "listPriority");
    const novelty = scored.scoreBreakdown.find((item) => item.id === "novelty");

    expect(scored.reasons).toContain(listPriority?.explanation);
    expect(novelty).toMatchObject({ value: 0 });
    expect(scored.reasons).not.toContain(novelty?.explanation);
  });

  it.each([
    {
      titles: ["数学講義 下巻", "数学講義 中巻", "数学講義 上巻"],
      expectedTitles: ["数学講義 上巻", "数学講義 中巻", "数学講義 下巻"]
    },
    {
      titles: ["解析入門 2巻", "解析入門 1巻"],
      expectedTitles: ["解析入門 1巻", "解析入門 2巻"]
    },
    {
      titles: ["美味礼讃 下 (岩波文庫)", "美味礼讃　上"],
      expectedTitles: ["美味礼讃　上", "美味礼讃 下 (岩波文庫)"]
    },
    {
      titles: ["代数学 第2巻", "代数学 第1巻"],
      expectedTitles: ["代数学 第1巻", "代数学 第2巻"]
    }
  ])("prioritizes earlier volumes for $titles", ({ titles, expectedTitles }) => {
    const scored = scoreBooks(
      titles.map((title, index) =>
        snapshotOf(
          wishBook({
            bookmeterUrl: `volume-${index + 1}`,
            title,
            remoteRank: titles.length - index
          })
        )
      ),
      DEFAULT_SETTINGS
    );

    expect(scored.map((book) => book.title)).toEqual(expectedTitles);
    expect(scored[0]?.scoreBreakdown.find((item) => item.id === "seriesOrder")).toMatchObject({
      value: 1
    });
  });
});
