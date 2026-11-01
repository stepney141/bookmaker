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
  readonly sophiaLibraryStatus?: SourceBook["sophiaLibraryStatus"];
  readonly utokyoLibraryStatus?: SourceBook["utokyoLibraryStatus"];
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
    sophiaLibraryStatus: input.sophiaLibraryStatus ?? "unknown",
    utokyoLibraryStatus: input.utokyoLibraryStatus ?? "unknown",
    sophiaOpacUrl: input.sophiaLibraryStatus === "available" ? "https://sophia.example/opac" : "",
    utokyoOpacUrl: input.utokyoLibraryStatus === "available" ? "https://utokyo.example/opac" : "",
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
      utokyoLibraryStatus: "available",
      remoteRank: 1
    }),
    book({
      url: "https://bookmeter.example/statistics",
      isbnOrAsin: "9784000000028",
      title: "統計的学習",
      author: "佐藤花子",
      description: "統計と機械学習の基礎を説明します。",
      sophiaLibraryStatus: "available",
      remoteRank: 2
    }),
    book({
      url: "https://bookmeter.example/clinical",
      isbnOrAsin: "9784000000035",
      title: "臨床研究法",
      author: "鈴木一郎",
      description: "臨床研究の計画、解析、倫理を扱います。",
      sophiaLibraryStatus: "unavailable",
      utokyoLibraryStatus: "unavailable",
      remoteRank: 3
    }),
    book({
      url: "https://bookmeter.example/japan",
      isbnOrAsin: "9784000000042",
      title: "日本史入門",
      author: "田中次郎",
      description: "古代から近現代までの日本史を概説します。",
      remoteRank: 4
    }),
    book({
      url: "https://bookmeter.example/unknown-holding",
      isbnOrAsin: "9784000000059",
      title: "未取得研究",
      author: "高橋三郎",
      description: "所蔵確認が未取得の研究書です。",
      remoteRank: 5
    }),
    book({
      url: "https://bookmeter.example/category-introduction",
      isbnOrAsin: null,
      title: "圏論への第一歩",
      author: "井上四郎",
      description: "対象と射を説明します。",
      remoteRank: 6
    }),
    book({
      url: "https://bookmeter.example/category-applications",
      isbnOrAsin: null,
      title: "圏論の応用",
      author: "小林五郎",
      description: "関手と自然変換の応用を扱います。",
      remoteRank: 7
    }),
    book({
      url: "https://bookmeter.example/mathematics",
      isbnOrAsin: null,
      title: "数学の世界",
      author: "加藤六郎",
      description: "抽象的な構造を論じます。",
      remoteRank: 8
    }),
    book({
      url: "https://bookmeter.example/numbers",
      isbnOrAsin: null,
      title: "数の世界",
      author: "吉田七郎",
      description: "整数と実数を論じます。",
      remoteRank: 9
    })
  ];

  syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks });
  return appDb;
}

describe("searchBooks", () => {
  it.each([
    "圏論を勉強したい",
    "圏論を学びたい",
    "圏論について学ぶ",
    "圏論を学習したい",
    "圏論を独学したい",
    "圏論に入門したい",
    "圏論入門したい"
  ])("returns the topic's results for the learning query %s", (query) => {
    const dir = createTempDir();
    const appDb = openSearchFixture(dir);

    try {
      const topicResults = searchBooks({ db: appDb.db, query: "圏論", limit: 10 });
      const learningResults = searchBooks({ db: appDb.db, query, limit: 10 });

      expect(topicResults.map((result) => result.bookmeterUrl)).toEqual([
        "https://bookmeter.example/category-introduction",
        "https://bookmeter.example/category-applications"
      ]);
      expect(learningResults).toEqual(topicResults);
    } finally {
      appDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["数学", "数学を勉強したい", "数学を学びたい", "数学を学習したい"])(
    "preserves meaningful characters within the topic in %s",
    (query) => {
      const dir = createTempDir();
      const appDb = openSearchFixture(dir);

      try {
        const results = searchBooks({ db: appDb.db, query, limit: 10 });

        expect(results.map((result) => result.bookmeterUrl)).toEqual(["https://bookmeter.example/mathematics"]);
      } finally {
        appDb.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

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

  it("filters search candidates by list membership before ranking", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({
        db: appDb.db,
        query: "基礎",
        limit: 5,
        filters: { lists: ["stacked"], libraries: [] }
      });

      expect(results.map((result) => result.bookmeterUrl)).toEqual(["https://bookmeter.example/security"]);

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters search candidates by selected library holdings", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const utokyoResults = searchBooks({
        db: appDb.db,
        query: "基礎",
        limit: 5,
        filters: { lists: [], libraries: ["utokyo"] }
      });
      const sophiaResults = searchBooks({
        db: appDb.db,
        query: "学習",
        limit: 5,
        filters: { lists: [], libraries: ["sophia"] }
      });

      expect(utokyoResults.map((result) => result.bookmeterUrl)).toEqual(["https://bookmeter.example/security"]);
      expect(sophiaResults.map((result) => result.bookmeterUrl)).toEqual(["https://bookmeter.example/statistics"]);

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats neither-library as explicit no in both libraries", () => {
    const dir = createTempDir();
    try {
      const appDb = openSearchFixture(dir);

      const results = searchBooks({
        db: appDb.db,
        query: "研究",
        limit: 5,
        filters: { lists: [], libraries: ["neither"] }
      });

      expect(results.map((result) => result.bookmeterUrl)).toEqual(["https://bookmeter.example/clinical"]);

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
