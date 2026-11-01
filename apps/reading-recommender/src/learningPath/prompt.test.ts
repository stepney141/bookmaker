import { describe, expect, it } from "vitest";

import { createLearningPathPrompt } from "./prompt";

import type { BookSnapshot } from "../shared/types";

const book: BookSnapshot = {
  bookmeterUrl: "https://bookmeter.example/books/1",
  isbnOrAsin: "9784000000011",
  title: "測度論入門",
  author: "山田太郎",
  publisher: "数学出版",
  publishedDate: "2026-10",
  description: "測度と積分の基礎。",
  inWish: true,
  inStacked: false,
  sophiaLibraryStatus: "unknown",
  utokyoLibraryStatus: "available",
  sophiaOpacUrl: "https://opac.example/sophia",
  utokyoOpacUrl: "https://opac.example/utokyo",
  wishRowid: 1,
  stackedRowid: null,
  remoteRank: 1,
  remoteRankSource: "wish",
  contentHash: "hash",
  firstSeenAt: "2026-10-01T00:00:00Z",
  lastSeenAt: "2026-10-01T00:00:00Z",
  lastScanRunId: 1
};

describe("createLearningPathPrompt", () => {
  it("includes the topic, IDs, bibliography and list memberships without URLs", () => {
    const prompt = createLearningPathPrompt({
      topic: "測度論的確率論を勉強したい",
      candidates: [
        { id: "b1", book },
        { id: "b2", book: { ...book, title: "確率論講義", inWish: false, inStacked: true } }
      ]
    });

    for (const field of [
      "測度論的確率論を勉強したい",
      "b1",
      "b2",
      book.title,
      book.author,
      book.publisher,
      book.publishedDate,
      book.description,
      "読みたい本",
      "積読"
    ]) {
      expect(prompt.user).toContain(field);
    }
    expect(prompt.user).not.toContain(book.bookmeterUrl);
    expect(prompt.user).not.toContain(book.sophiaOpacUrl);
    expect(prompt.user).not.toContain(book.utokyoOpacUrl);
  });

  it("limits each description to 1200 characters", () => {
    const description = `${"あ".repeat(1199)}境除外`;
    const prompt = createLearningPathPrompt({
      topic: "数学",
      candidates: [{ id: "b1", book: { ...book, description } }]
    });

    expect(prompt.user).toContain(`${"あ".repeat(1199)}境`);
    expect(prompt.user).not.toContain("除");
  });
});
