import { describe, expect, it } from "vitest";

import { normalizeLearningPath } from "./normalize";

import type { BookSnapshot, LearningPathPlannerInfo } from "../../types/api";

function book(title: string): BookSnapshot {
  return {
    bookmeterUrl: `https://bookmeter.example/books/${title}`,
    isbnOrAsin: "9784000000011",
    title,
    author: "著者",
    publisher: "出版社",
    publishedDate: "2026-10",
    description: "説明文",
    inWish: false,
    inStacked: true,
    sophiaLibraryStatus: "available",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "https://opac.example/book",
    utokyoOpacUrl: "",
    wishRowid: null,
    stackedRowid: 1,
    remoteRank: 1,
    remoteRankSource: "stacked",
    contentHash: "hash",
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: "2026-10-01T00:00:00Z",
    lastScanRunId: 1
  };
}

const planner: LearningPathPlannerInfo = {
  id: "anthropic",
  label: "Claude",
  modelId: "response-model"
};

describe("normalizeLearningPath", () => {
  it("maps IDs to candidate books and preserves the first occurrence across stages", () => {
    const introductory = book("入門書");
    const advanced = book("専門書");

    expect(
      normalizeLearningPath({
        topic: "測度論的確率論",
        planner,
        candidates: [
          { id: "b1", book: advanced },
          { id: "b2", book: introductory }
        ],
        output: {
          overview: "基礎から発展へ進みます。",
          stages: [
            {
              title: "入門",
              goal: "基礎を理解する",
              books: [
                { id: "b2", reason: "基礎を扱うため" },
                { id: "b2", reason: "同じ段階の重複" },
                { id: "unknown", reason: "候補外" }
              ]
            },
            { title: "空の段階", goal: "候補外のみ", books: [{ id: "b99", reason: "候補外" }] },
            {
              title: "発展",
              goal: "専門的な議論を学ぶ",
              books: [
                { id: "b1", reason: "専門的な内容を扱うため" },
                { id: "b2", reason: "段階をまたぐ重複" }
              ]
            },
            { title: "空", goal: "本がない", books: [] }
          ],
          gaps: ["リストに演習書がありません。"]
        }
      })
    ).toEqual({
      topic: "測度論的確率論",
      overview: "基礎から発展へ進みます。",
      stages: [
        { title: "入門", goal: "基礎を理解する", books: [{ ...introductory, reason: "基礎を扱うため" }] },
        { title: "発展", goal: "専門的な議論を学ぶ", books: [{ ...advanced, reason: "専門的な内容を扱うため" }] }
      ],
      gaps: ["リストに演習書がありません。"],
      planner
    });
  });

  it("returns no stages when the planner selects only unknown IDs", () => {
    expect(
      normalizeLearningPath({
        topic: "確率論",
        planner,
        candidates: [{ id: "b1", book: book("入門書") }],
        output: {
          overview: "該当する本がありません。",
          stages: [{ title: "入門", goal: "基礎", books: [{ id: "unknown", reason: "候補外" }] }],
          gaps: ["リストに該当する本がありません。"]
        }
      }).stages
    ).toEqual([]);
  });
});
