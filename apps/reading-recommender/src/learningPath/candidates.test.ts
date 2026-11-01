import { describe, expect, it } from "vitest";

import { mergeLearningPathCandidates } from "./candidates";

import type { BookSnapshot } from "../shared/types";

function book(index: number): BookSnapshot {
  return {
    bookmeterUrl: `https://bookmeter.example/books/${index}`,
    isbnOrAsin: null,
    title: `候補 ${index}`,
    author: "著者",
    publisher: "出版社",
    publishedDate: "2026-10",
    description: "候補の説明",
    inWish: true,
    inStacked: false,
    sophiaLibraryStatus: "unknown",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "",
    utokyoOpacUrl: "",
    wishRowid: index,
    stackedRowid: null,
    remoteRank: index,
    remoteRankSource: "wish",
    contentHash: `hash-${index}`,
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: "2026-10-01T00:00:00Z",
    lastScanRunId: 1
  };
}

describe("mergeLearningPathCandidates", () => {
  it("keeps lexical order before semantic candidates ranked by similarity, without a score threshold", () => {
    const lexical = [book(1), book(2)];
    const semantic = [
      { book: book(3), score: 0.35 },
      { book: book(4), score: 0.5 },
      { book: book(5), score: 0.42 }
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
    const first = book(1);

    expect(
      mergeLearningPathCandidates({
        lexical: [first, first],
        semantic: [
          { book: { ...first, title: "別の書誌" }, score: 0.9 },
          { book: book(2), score: 0.5 },
          { book: book(2), score: 0.4 }
        ],
        limit: 40
      })
    ).toEqual([first, book(2)]);
  });

  it("caps the merged unique candidates at 40", () => {
    const candidates = mergeLearningPathCandidates({
      lexical: Array.from({ length: 15 }, (_, index) => book(index + 1)),
      semantic: Array.from({ length: 45 }, (_, index) => ({ book: book(index + 1), score: 1 - index / 100 })),
      limit: 40
    });

    expect(candidates).toHaveLength(40);
    expect(candidates.at(-1)?.title).toBe("候補 40");
  });
});
