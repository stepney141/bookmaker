import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openAppDb } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";

import { searchBooks } from "./search";

import type { AppDb } from "../db/appDb";
import type { SourceBook } from "../shared/types";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "reading-recommender-search-"));
}

function book(input: {
  readonly url: string;
  readonly isbnOrAsin: string | null;
  readonly title: string;
  readonly author: string;
  readonly publisher?: string;
  readonly description: string;
  readonly inStacked?: boolean;
  readonly remoteRank: number;
}): SourceBook {
  return {
    bookmeterUrl: input.url,
    isbnOrAsin: input.isbnOrAsin,
    title: input.title,
    author: input.author,
    publisher: input.publisher ?? "テスト出版",
    publishedDate: "2026",
    description: input.description,
    inWish: !input.inStacked,
    inStacked: input.inStacked ?? false,
    wishRowid: input.inStacked ? null : input.remoteRank,
    stackedRowid: input.inStacked ? input.remoteRank : null,
    remoteRank: input.remoteRank,
    remoteRankSource: input.inStacked ? "stacked" : "wish"
  };
}

function openSearchFixture(dir: string): AppDb {
  const appDb = openAppDb(join(dir, "app.sqlite"));
  const sourceBooks = [
    book({
      url: "https://bookmeter.example/security",
      isbnOrAsin: "9784000000011",
      title: "情報セキュリティの基礎",
      author: "山田太郎",
      description: "暗号、認証、脆弱性を扱う情報セキュリティの入門書です。",
      inStacked: true,
      remoteRank: 1
    }),
    book({
      url: "https://bookmeter.example/statistics",
      isbnOrAsin: "9784000000028",
      title: "統計的学習",
      author: "佐藤花子",
      description: "統計と機械学習の基礎を説明します。",
      remoteRank: 2
    }),
    book({
      url: "https://bookmeter.example/clinical",
      isbnOrAsin: "9784000000035",
      title: "臨床研究法",
      author: "鈴木一郎",
      description: "臨床研究の計画、解析、倫理を扱います。",
      remoteRank: 3
    }),
    book({
      url: "https://bookmeter.example/japan",
      isbnOrAsin: "9784000000042",
      title: "日本史入門",
      author: "田中次郎",
      description: "古代から近現代までの日本史を概説します。",
      remoteRank: 4
    })
  ];

  syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks });
  return appDb;
}

describe("searchBooks", () => {
  it("extracts the topic from natural-language Japanese queries", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({ db: appDb.db, query: "セキュリティに関連する本はどれ？", limit: 3 });

      expect(results[0]?.bookmeterUrl).toBe("https://bookmeter.example/security");
      expect(results[0]?.reasons.join(" ")).toContain("タイトル");

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches ISBN queries even when the input contains separators", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({ db: appDb.db, query: "978-4-0000-0003-5", limit: 3 });

      expect(results[0]?.bookmeterUrl).toBe("https://bookmeter.example/clinical");
      expect(results[0]?.reasons.join(" ")).toContain("ISBNまたはASIN");

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps short keyword and author searches useful", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const shortKeywordResults = searchBooks({ db: appDb.db, query: "暗号", limit: 3 });
      const authorResults = searchBooks({ db: appDb.db, query: "佐藤花子", limit: 3 });

      expect(shortKeywordResults[0]?.bookmeterUrl).toBe("https://bookmeter.example/security");
      expect(authorResults[0]?.bookmeterUrl).toBe("https://bookmeter.example/statistics");

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not strip meaningful characters from Japanese terms", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({ db: appDb.db, query: "日本史", limit: 3 });

      expect(results[0]?.bookmeterUrl).toBe("https://bookmeter.example/japan");

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses semantic scores for candidates without lexical matches", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({
        db: appDb.db,
        query: "安全な通信を学べる本",
        limit: 3,
        semantic: {
          scoresByUrl: new Map([["https://bookmeter.example/security", 0.96]])
        }
      });

      expect(results[0]?.bookmeterUrl).toBe("https://bookmeter.example/security");
      expect(results[0]?.reasons.join(" ")).toContain("意味が近い");

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps exact ISBN ahead of semantic-only candidates", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({
        db: appDb.db,
        query: "978-4-0000-0003-5",
        limit: 3,
        semantic: {
          scoresByUrl: new Map([["https://bookmeter.example/security", 0.99]])
        }
      });

      expect(results[0]?.bookmeterUrl).toBe("https://bookmeter.example/clinical");

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps exact author ahead of semantic-only candidates", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({
        db: appDb.db,
        query: "佐藤花子",
        limit: 3,
        semantic: {
          scoresByUrl: new Map([["https://bookmeter.example/security", 0.99]])
        }
      });

      expect(results[0]?.bookmeterUrl).toBe("https://bookmeter.example/statistics");

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
