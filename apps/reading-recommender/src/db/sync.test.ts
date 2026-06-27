import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";


import { getCurrentSnapshots, openAppDb } from "./appDb";
import { createSourceBooksRepository } from "./sourceBooks";
import { syncSourceBooks } from "./sync";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "reading-recommender-"));
}

function createSourceDb(path: string): void {
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
      exist_in_sophia TEXT,
      exist_in_utokyo TEXT,
      sophia_mathlib_opac TEXT,
      description TEXT
    )`);
  };
  createTable("wish");
  createTable("stacked");
  db.prepare(
    `INSERT INTO wish (bookmeter_url, isbn_or_asin, book_title, author, publisher, published_date, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("https://bookmeter.example/wish-1", "111", "暗号理論入門", "A", "P", "2020", "認証と暗号の本です。");
  db.prepare(
    `INSERT INTO wish (bookmeter_url, isbn_or_asin, book_title, author, publisher, published_date, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("https://bookmeter.example/both-1", "222", "統計的学習", "B", "P", "2021", "統計と機械学習の本です。");
  db.prepare(
    `INSERT INTO stacked (bookmeter_url, isbn_or_asin, book_title, author, publisher, published_date, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("https://bookmeter.example/both-1", "222", "統計的学習", "B", "P", "2021", "統計と機械学習の本です。");
  db.prepare(
    `INSERT INTO stacked (bookmeter_url, isbn_or_asin, book_title, author, publisher, published_date, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("https://bookmeter.example/stacked-1", "333", "臨床研究法", "C", "Q", "2022", "臨床研究の計画を扱います。");
  db.close();
}

describe("source sync", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("reads wish and stacked read-only and preserves rowid-derived ranks", () => {
    const dir = createTempDir();
    tempDirs.push(dir);
    const sourcePath = join(dir, "books.sqlite");
    const appPath = join(dir, "app.sqlite");
    createSourceDb(sourcePath);
    const sourceRepository = createSourceBooksRepository(sourcePath);
    const appDb = openAppDb(appPath);

    const sourceBooks = sourceRepository.loadCurrentBooks();
    const result = syncSourceBooks({ db: appDb.db, booksDbPath: sourcePath, sourceBooks });
    const snapshots = getCurrentSnapshots(appDb.db);

    expect(result.wishCount).toBe(2);
    expect(result.stackedCount).toBe(2);
    expect(snapshots).toHaveLength(3);
    expect(snapshots.find((book) => book.bookmeterUrl.endsWith("both-1"))).toMatchObject({
      inWish: true,
      inStacked: true,
      remoteRankSource: "stacked",
      stackedRowid: 1
    });
    expect(sourceRepository.loadRowOrderDiagnostics(1)[0]?.firstRows[0]?.title).toBe("暗号理論入門");

    sourceRepository.close();
    appDb.close();
  });
});
