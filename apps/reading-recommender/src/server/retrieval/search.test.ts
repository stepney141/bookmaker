import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openAppDb } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";
import { stackedBook, wishBook } from "../testing/books";

import { analyzeQuery, searchBooks } from "./search";

import type { SearchFilters } from "../../types/api";
import type { AppDb } from "../db/appDb";

let appDb: AppDb;

beforeAll(() => {
  appDb = openAppDb(":memory:");
  const sourceBooks = [
    stackedBook({
      bookmeterUrl: "https://bookmeter.example/security",
      isbnOrAsin: "9784000000011",
      title: "情報セキュリティの基礎",
      author: "山田太郎",
      description: "暗号、認証、脆弱性を扱う情報セキュリティの入門書です。",
      utokyoLibraryStatus: "available",
      remoteRank: 1
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/statistics",
      isbnOrAsin: "9784000000028",
      title: "統計的学習",
      author: "佐藤花子",
      description: "統計と機械学習の基礎を説明します。",
      sophiaLibraryStatus: "available",
      remoteRank: 2
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/clinical",
      isbnOrAsin: "9784000000035",
      title: "臨床研究法",
      author: "鈴木一郎",
      description: "臨床研究の計画、解析、倫理を扱います。",
      sophiaLibraryStatus: "unavailable",
      utokyoLibraryStatus: "unavailable",
      remoteRank: 3
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/japan",
      isbnOrAsin: "9784000000042",
      title: "日本史入門",
      author: "田中次郎",
      description: "古代から近現代までの日本史を概説します。",
      remoteRank: 4
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/unknown-holding",
      isbnOrAsin: "9784000000059",
      title: "未取得研究",
      author: "高橋三郎",
      description: "所蔵確認が未取得の研究書です。",
      remoteRank: 5
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/category-introduction",
      title: "圏論への第一歩",
      author: "井上四郎",
      description: "対象と射を説明します。",
      remoteRank: 6
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/category-applications",
      title: "圏論の応用",
      author: "小林五郎",
      description: "関手と自然変換の応用を扱います。",
      remoteRank: 7
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/mathematics",
      title: "数学の世界",
      author: "加藤六郎",
      description: "抽象的な構造を論じます。",
      remoteRank: 8
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/numbers",
      title: "数の世界",
      author: "吉田七郎",
      description: "整数と実数を論じます。",
      remoteRank: 9
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/astronomy-once",
      title: "観測の手引き",
      description: "天文学を扱い、惑星や恒星の観測方法、観測の歴史、望遠鏡の仕組みを詳しく紹介します。",
      remoteRank: 10
    }),
    wishBook({
      bookmeterUrl: "https://bookmeter.example/astronomy-repeated",
      title: "星の話題",
      description: "天文学 天文学 天文学",
      remoteRank: 11
    })
  ];

  syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks });
});

afterAll(() => {
  appDb.close();
});

describe("analyzeQuery", () => {
  it.each([
    { query: "圏論を勉強したい", terms: ["圏論"] },
    { query: "圏論を学びたい", terms: ["圏論"] },
    { query: "圏論について学ぶ", terms: ["圏論"] },
    { query: "圏論を学習したい", terms: ["圏論"] },
    { query: "圏論を独学したい", terms: ["圏論"] },
    { query: "圏論に入門したい", terms: ["圏論"] },
    { query: "圏論入門したい", terms: ["圏論"] },
    { query: "数学", terms: ["数学"] },
    { query: "数学を勉強したい", terms: ["数学"] },
    { query: "数学を学びたい", terms: ["数学"] },
    { query: "数学を学習したい", terms: ["数学"] },
    { query: "日本史", terms: ["日本史"] },
    { query: "セキュリティに関連する本はどれ？", terms: ["セキュリティ"] }
  ])("extracts topic terms from $query", ({ query, terms }) => {
    expect(analyzeQuery(query).terms).toEqual(terms);
  });

  it("normalizes the ISBN query 978-4-0000-0003-5", () => {
    expect(analyzeQuery("978-4-0000-0003-5").identifier).toBe("9784000000035");
  });
});

describe("searchBooks", () => {
  it.each([
    {
      query: "圏論を勉強したい",
      urls: ["https://bookmeter.example/category-introduction", "https://bookmeter.example/category-applications"]
    },
    {
      query: "数学を勉強したい",
      urls: ["https://bookmeter.example/mathematics"]
    }
  ])("returns the topic's books for $query", ({ query, urls }) => {
    const results = searchBooks({ db: appDb.db, query, limit: 10 });

    expect(results.map((result) => result.bookmeterUrl)).toEqual(urls);
  });

  it.each([
    {
      query: "セキュリティ",
      url: "https://bookmeter.example/security",
      reason: "タイトル"
    },
    {
      query: "978-4-0000-0003-5",
      url: "https://bookmeter.example/clinical",
      reason: "ISBNまたはASIN"
    }
  ])("returns and explains the lexical match for $query", ({ query, url, reason }) => {
    const results = searchBooks({ db: appDb.db, query, limit: 3 });

    expect(results.map((result) => result.bookmeterUrl)).toEqual([url]);
    expect(results[0]?.reasons.join(" ")).toContain(reason);
  });

  it.each([
    { query: "暗号", url: "https://bookmeter.example/security" },
    { query: "佐藤花子", url: "https://bookmeter.example/statistics" }
  ])("finds books by the keyword or author $query", ({ query, url }) => {
    const results = searchBooks({ db: appDb.db, query, limit: 3 });

    expect(results.map((result) => result.bookmeterUrl)).toEqual([url]);
  });

  it("uses semantic scores for candidates without lexical matches", () => {
    const results = searchBooks({
      db: appDb.db,
      query: "安全な通信を学べる本",
      limit: 3,
      semantic: {
        scoresByUrl: new Map([["https://bookmeter.example/security", 0.96]])
      }
    });

    expect(results.map((result) => result.bookmeterUrl)).toEqual(["https://bookmeter.example/security"]);
    expect(results[0]?.reasons.join(" ")).toContain("意味が近い");
  });

  it.each([
    { query: "978-4-0000-0003-5", url: "https://bookmeter.example/clinical" },
    { query: "佐藤花子", url: "https://bookmeter.example/statistics" }
  ])("keeps the exact match for $query ahead of semantic-only candidates", ({ query, url }) => {
    const results = searchBooks({
      db: appDb.db,
      query,
      limit: 3,
      semantic: {
        scoresByUrl: new Map([["https://bookmeter.example/security", 0.99]])
      }
    });

    expect(results.map((result) => result.bookmeterUrl)).toEqual([url, "https://bookmeter.example/security"]);
  });

  it.each([
    {
      query: "基礎",
      filters: { lists: ["stacked"], libraries: [] },
      urls: ["https://bookmeter.example/security"]
    },
    {
      query: "基礎",
      filters: { lists: [], libraries: ["utokyo"] },
      urls: ["https://bookmeter.example/security"]
    },
    {
      query: "学習",
      filters: { lists: [], libraries: ["sophia"] },
      urls: ["https://bookmeter.example/statistics"]
    },
    {
      query: "研究",
      filters: { lists: [], libraries: ["neither"] },
      urls: ["https://bookmeter.example/clinical"]
    }
  ] satisfies readonly {
    readonly query: string;
    readonly filters: SearchFilters;
    readonly urls: readonly string[];
  }[])("filters the results for $query by $filters", ({ query, filters, urls }) => {
    const results = searchBooks({ db: appDb.db, query, limit: 5, filters });

    expect(results.map((result) => result.bookmeterUrl)).toEqual(urls);
  });

  it("ranks repeated description matches ahead of a single match with a lower remote rank", () => {
    const results = searchBooks({ db: appDb.db, query: "天文学", limit: 3 });

    expect(results.map((result) => result.bookmeterUrl)).toEqual([
      "https://bookmeter.example/astronomy-repeated",
      "https://bookmeter.example/astronomy-once"
    ]);
  });
});
