import { describe, expect, it } from "vitest";

import { snapshotOf, wishBook } from "../testing/books";

import { mergeLearningPathCandidates } from "./candidates";

const books = Array.from({ length: 45 }, (_, index) =>
  snapshotOf(
    wishBook({
      bookmeterUrl: `https://bookmeter.example/books/${index + 1}`,
      title: `候補 ${index + 1}`,
      remoteRank: index + 1
    })
  )
);

describe("mergeLearningPathCandidates", () => {
  it("keeps lexical order before semantic candidates ranked by similarity, without a score threshold", () => {
    const lexical = books.slice(0, 2);
    const semantic = [
      { book: books[2], score: 0.35 },
      { book: books[3], score: 0.5 },
      { book: books[4], score: 0.42 }
    ];

    expect(mergeLearningPathCandidates({ lexical, semantic, limit: 40 }).map((candidate) => candidate.title)).toEqual([
      "候補 1",
      "候補 2",
      "候補 4",
      "候補 5",
      "候補 3"
    ]);
    expect(semantic.map((candidate) => candidate.score)).toEqual([0.35, 0.5, 0.42]);
  });

  it("deduplicates URLs and preserves the first candidate", () => {
    const first = books[0];
    const second = books[1];

    expect(
      mergeLearningPathCandidates({
        lexical: [first, first],
        semantic: [
          { book: { ...first, title: "別の書誌" }, score: 0.9 },
          { book: second, score: 0.5 },
          { book: second, score: 0.4 }
        ],
        limit: 40
      })
    ).toEqual([first, second]);
  });

  it("caps the merged unique candidates at 40", () => {
    const candidates = mergeLearningPathCandidates({
      lexical: books.slice(0, 15),
      semantic: books.map((book, index) => ({ book, score: 1 - index / 100 })),
      limit: 40
    });

    expect(candidates).toHaveLength(40);
    expect(candidates.at(-1)?.title).toBe("候補 40");
  });
});
