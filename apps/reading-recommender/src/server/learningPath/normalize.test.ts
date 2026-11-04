import { describe, expect, it } from "vitest";

import { snapshotOf, stackedBook } from "../testing/books";

import { normalizeLearningPath } from "./normalize";

import type { LearningPathPlannerInfo } from "../../types/api";

const planner: LearningPathPlannerInfo = {
  id: "anthropic",
  label: "Claude",
  modelId: "response-model"
};

describe("normalizeLearningPath", () => {
  it("maps IDs to candidate books and preserves the first occurrence across stages", () => {
    const introductory = snapshotOf(
      stackedBook({
        bookmeterUrl: "https://bookmeter.example/books/1",
        isbnOrAsin: "9784000000011",
        title: "入門書",
        author: "入門の著者",
        publisher: "基礎出版",
        publishedDate: "2026-10",
        description: "測度と積分の基礎。",
        sophiaLibraryStatus: "available",
        sophiaOpacUrl: "https://opac.example/sophia/1",
        remoteRank: 1
      }),
      {
        contentHash: "introductory-hash",
        firstSeenAt: "2026-10-01T00:00:00Z",
        lastSeenAt: "2026-11-01T00:00:00Z",
        lastScanRunId: 2
      }
    );
    const advanced = snapshotOf(
      stackedBook({
        bookmeterUrl: "https://bookmeter.example/books/2",
        isbnOrAsin: "9784000000028",
        title: "専門書",
        author: "専門の著者",
        publisher: "発展書房",
        publishedDate: "2025-04",
        description: "確率過程の専門的な議論。",
        utokyoLibraryStatus: "available",
        utokyoOpacUrl: "https://opac.example/utokyo/2",
        remoteRank: 2
      }),
      {
        contentHash: "advanced-hash",
        firstSeenAt: "2026-09-01T00:00:00Z",
        lastSeenAt: "2026-11-02T00:00:00Z",
        lastScanRunId: 3
      }
    );

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
});
