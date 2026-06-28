import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { getSettings, openAppDb } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";
import { runRecommendation } from "../recommendation/engine";

import { createReadingRecommenderService } from "./service";

import type { EmbeddingProvider } from "../embedding/types";
import type { SourceBook } from "../shared/types";

function book(input: Partial<SourceBook> & Pick<SourceBook, "bookmeterUrl" | "title" | "remoteRank">): SourceBook {
  return {
    isbnOrAsin: null,
    author: "別著者",
    publisher: "別出版社",
    publishedDate: "2024",
    description: "",
    inWish: false,
    inStacked: true,
    sophiaLibraryStatus: "unknown",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "",
    utokyoOpacUrl: "",
    wishRowid: null,
    stackedRowid: input.remoteRank,
    remoteRankSource: "stacked",
    ...input
  };
}

function createSourceDb(path: string): void {
  const db = new Database(path);
  db.close();
}

function createSourceDbWithBooks(path: string, books: readonly SourceBook[]): void {
  const db = new Database(path);
  const createTable = (tableName: "wish" | "stacked"): void => {
    db.exec(`CREATE TABLE ${tableName} (
      bookmeter_url TEXT PRIMARY KEY,
      isbn_or_asin TEXT,
      book_title TEXT,
      author TEXT,
      publisher TEXT,
      published_date TEXT,
      sophia_opac TEXT,
      utokyo_opac TEXT,
      exist_in_Sophia TEXT,
      exist_in_UTokyo TEXT,
      sophia_mathlib_opac TEXT,
      description TEXT
    )`);
  };
  createTable("wish");
  createTable("stacked");

  for (const sourceBook of books) {
    db.prepare(
      `INSERT INTO stacked (
        bookmeter_url,
        isbn_or_asin,
        book_title,
        author,
        publisher,
        published_date,
        description
      )
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sourceBook.bookmeterUrl,
      sourceBook.isbnOrAsin,
      sourceBook.title,
      sourceBook.author,
      sourceBook.publisher,
      sourceBook.publishedDate,
      sourceBook.description
    );
  }

  db.close();
}

function insertStackedBook(path: string, sourceBook: SourceBook): void {
  const db = new Database(path);
  db.prepare(
    `INSERT INTO stacked (
      bookmeter_url,
      isbn_or_asin,
      book_title,
      author,
      publisher,
      published_date,
      description
    )
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sourceBook.bookmeterUrl,
    sourceBook.isbnOrAsin,
    sourceBook.title,
    sourceBook.author,
    sourceBook.publisher,
    sourceBook.publishedDate,
    sourceBook.description
  );
  db.close();
}

function cycleCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM recommendation_cycle").get() as { readonly count: number };
  return row.count;
}

function mockEmbeddingProvider(): EmbeddingProvider {
  return {
    providerId: "mock",
    modelId: "mock-related",
    dimension: 2,
    embed(input) {
      return Promise.resolve(
        input.texts.map((text) => {
          if (text.startsWith("title: 臨床 試験\n")) {
            return Float32Array.from([1, 0]);
          }
          if (text.startsWith("title: ベイズ 推論\n")) {
            return Float32Array.from([0.95, 0.05]);
          }
          return Float32Array.from([0, 1]);
        })
      );
    }
  };
}

describe("reading recommender service", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("uses document embeddings for related books when a provider is available", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.push(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    createSourceDb(sourceDbPath);
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const books = [
      book({ bookmeterUrl: "primary", title: "臨床 試験", remoteRank: 10 }),
      book({ bookmeterUrl: "lexical", title: "臨床 試験 入門", remoteRank: 2 }),
      book({ bookmeterUrl: "semantic", title: "ベイズ 推論", remoteRank: 9 })
    ];

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
    const service = createReadingRecommenderService({
      appDb,
      booksDbPath: sourceDbPath,
      embeddingProvider: mockEmbeddingProvider()
    });

    try {
      const current = await service.current();

      expect(current?.primary?.bookmeterUrl).toBe("primary");
      expect(current?.relatedBooks.map((item) => item.bookmeterUrl)).toEqual(["semantic", "lexical"]);
      expect(current?.relatedBooks[0]?.reasons).toContain("説明文の意味が近い候補です。");
    } finally {
      service.close();
    }
  });

  it("does not create the same scheduled cycle twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.push(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    const appDb = openAppDb(join(dir, "app.sqlite"));
    createSourceDbWithBooks(sourceDbPath, [
      book({ bookmeterUrl: "primary", title: "定期推薦", remoteRank: 10 }),
      book({ bookmeterUrl: "secondary", title: "副推薦", remoteRank: 9 })
    ]);
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    try {
      await service.runScheduled("2026-06-28T22:30:00Z");
      await service.runScheduled("2026-06-28T22:30:00Z");
      const row = appDb.db
        .prepare("SELECT scheduled_for FROM recommendation_cycle WHERE reason = ?")
        .get("scheduled") as { readonly scheduled_for: string } | undefined;

      expect(cycleCount(appDb.db)).toBe(1);
      expect(row?.scheduled_for).toBe("2026-06-28T22:30:00Z");
    } finally {
      service.close();
    }
  });

  it("runs a source-changed recommendation only when the source hash changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.push(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    const appDb = openAppDb(join(dir, "app.sqlite"));
    createSourceDbWithBooks(sourceDbPath, [
      book({ bookmeterUrl: "primary", title: "初回推薦", remoteRank: 10 }),
      book({ bookmeterUrl: "secondary", title: "副推薦", remoteRank: 9 })
    ]);
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    try {
      await service.run("initial");
      const unchanged = await service.runIfSourceChanged();
      insertStackedBook(sourceDbPath, book({ bookmeterUrl: "new-book", title: "前倒し推薦", remoteRank: 8 }));
      const changed = await service.runIfSourceChanged();
      const latestCycle = appDb.db
        .prepare("SELECT reason FROM recommendation_cycle ORDER BY id DESC LIMIT 1")
        .get() as { readonly reason: string } | undefined;

      expect(unchanged.changed).toBe(false);
      expect(changed.changed).toBe(true);
      expect(latestCycle?.reason).toBe("source_changed");
    } finally {
      service.close();
    }
  });
});
