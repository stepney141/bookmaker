import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";

import { openTestAppDb } from "../testing/appDb";
import { createSourceDb, sourceBooksContract, updateBookTitle } from "../testing/sourceDb";

import { getCurrentSnapshots } from "./appDb";
import { createSourceBooksRepository } from "./sourceBooks";
import { syncSourceBooks, syncSourceBooksIfChanged } from "./sync";

import type { SourceBooksRepository } from "./sourceBooks";
import type { SourceBookLists } from "../testing/sourceDb";

function openTestSourceDb(books: SourceBookLists): {
  readonly sourcePath: string;
  readonly sourceRepository: SourceBooksRepository;
} {
  const dir = mkdtempSync(join(tmpdir(), "reading-recommender-sync-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "books.sqlite");
  createSourceDb(sourcePath, books);
  const sourceRepository = createSourceBooksRepository(sourcePath);
  onTestFinished(() => sourceRepository.close());
  return { sourcePath, sourceRepository };
}

describe("source sync", () => {
  it("reads pending WAL frames without checkpointing the source database", () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-sync-wal-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const sourcePath = join(dir, "books.sqlite");
    const snapshotPath = join(dir, "snapshot.sqlite");
    const snapshotWalPath = `${snapshotPath}-wal`;
    createSourceDb(sourcePath, {
      wish: [sourceBooksContract.sampleRow],
      stacked: []
    });

    const writer = new Database(sourcePath, { fileMustExist: true });
    try {
      writer.pragma("journal_mode = WAL");
      writer.pragma("wal_autocheckpoint = 0");
      writer
        .prepare("INSERT INTO wish (bookmeter_url, book_title) VALUES (?, ?)")
        .run("https://bookmeter.example/wal-only", "Book in WAL");
      copyFileSync(sourcePath, snapshotPath);
      copyFileSync(`${sourcePath}-wal`, snapshotWalPath);
    } finally {
      writer.close();
    }

    const before = readFileSync(snapshotPath);
    const walSize = statSync(snapshotWalPath).size;
    expect(walSize).toBeGreaterThan(0);
    const sourceRepository = createSourceBooksRepository(snapshotPath);
    try {
      expect(sourceRepository.loadCurrentBooks()).toMatchObject([
        { bookmeterUrl: "https://bookmeter.com/books/1000001", title: "契約検証用の本" },
        { bookmeterUrl: "https://bookmeter.example/wal-only", title: "Book in WAL" }
      ]);
    } finally {
      sourceRepository.close();
    }

    expect(readFileSync(snapshotPath)).toEqual(before);
    expect(existsSync(snapshotWalPath)).toBe(true);
    expect(statSync(snapshotWalPath).size).toBe(walSize);
  });

  it("maps the shared source contract row to a wish book", () => {
    const { sourceRepository } = openTestSourceDb({
      wish: [sourceBooksContract.sampleRow],
      stacked: []
    });

    expect(sourceRepository.loadCurrentBooks()).toEqual([
      {
        bookmeterUrl: "https://bookmeter.com/books/1000001",
        isbnOrAsin: "4062938428",
        title: "契約検証用の本",
        author: "契約 太郎",
        publisher: "契約出版",
        publishedDate: "2024-01-01",
        description: "契約検証用の説明文です。",
        inWish: true,
        inStacked: false,
        sophiaLibraryStatus: "available",
        utokyoLibraryStatus: "unavailable",
        sophiaOpacUrl: "https://sophia.example/opac/1",
        utokyoOpacUrl: "",
        wishRowid: 1,
        stackedRowid: null,
        remoteRank: 1,
        remoteRankSource: "wish"
      }
    ]);
  });

  it("syncs the list union and uses the stacked rank for a book on both lists", () => {
    const { sourcePath, sourceRepository } = openTestSourceDb({
      wish: [
        {
          bookmeter_url: "https://bookmeter.example/wish-only",
          book_title: "Wish only",
          exist_in_sophia: "No",
          exist_in_utokyo: "Yes",
          utokyo_opac: "https://utokyo.example/opac"
        },
        { bookmeter_url: "https://bookmeter.example/both", book_title: "Both lists" }
      ],
      stacked: [
        { bookmeter_url: "https://bookmeter.example/both", book_title: "Both lists" },
        { bookmeter_url: "https://bookmeter.example/stacked-only", book_title: "Stacked only" }
      ]
    });
    const appDb = openTestAppDb();

    const result = syncSourceBooks({
      db: appDb.db,
      booksDbPath: sourcePath,
      sourceBooks: sourceRepository.loadCurrentBooks()
    });
    const snapshots = getCurrentSnapshots(appDb.db);

    expect(result).toMatchObject({ wishCount: 2, stackedCount: 2 });
    expect(snapshots).toHaveLength(3);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookmeterUrl: "https://bookmeter.example/wish-only",
          sophiaLibraryStatus: "unavailable",
          utokyoLibraryStatus: "available",
          utokyoOpacUrl: "https://utokyo.example/opac",
          inWish: true,
          inStacked: false,
          wishRowid: 1,
          stackedRowid: null,
          remoteRank: 1,
          remoteRankSource: "wish"
        }),
        expect.objectContaining({
          bookmeterUrl: "https://bookmeter.example/both",
          inWish: true,
          inStacked: true,
          wishRowid: 2,
          stackedRowid: 1,
          remoteRank: 1,
          remoteRankSource: "stacked"
        }),
        expect.objectContaining({
          bookmeterUrl: "https://bookmeter.example/stacked-only",
          inWish: false,
          inStacked: true,
          wishRowid: null,
          stackedRowid: 2,
          remoteRank: 2,
          remoteRankSource: "stacked"
        })
      ])
    );
  });

  it.each([
    { wishStatus: "Yes", stackedStatus: "No" },
    { wishStatus: "No", stackedStatus: "Yes" },
    { wishStatus: "Yes", stackedStatus: null },
    { wishStatus: null, stackedStatus: "Yes" }
  ])(
    "merges wish $wishStatus and stacked $stackedStatus as available for both libraries",
    ({ wishStatus, stackedStatus }) => {
      const { sourceRepository } = openTestSourceDb({
        wish: [
          {
            bookmeter_url: "https://bookmeter.example/shared",
            book_title: "Shared library book",
            exist_in_sophia: wishStatus,
            exist_in_utokyo: wishStatus
          }
        ],
        stacked: [
          {
            bookmeter_url: "https://bookmeter.example/shared",
            book_title: "Shared library book",
            exist_in_sophia: stackedStatus,
            exist_in_utokyo: stackedStatus
          }
        ]
      });

      expect(sourceRepository.loadCurrentBooks()).toMatchObject([
        {
          bookmeterUrl: "https://bookmeter.example/shared",
          sophiaLibraryStatus: "available",
          utokyoLibraryStatus: "available"
        }
      ]);
    }
  );

  it("returns null without adding a scan run when source content is unchanged", () => {
    const { sourcePath, sourceRepository } = openTestSourceDb({
      wish: [sourceBooksContract.sampleRow],
      stacked: []
    });
    const appDb = openTestAppDb();
    syncSourceBooks({ db: appDb.db, booksDbPath: sourcePath, sourceBooks: sourceRepository.loadCurrentBooks() });

    const result = syncSourceBooksIfChanged({
      db: appDb.db,
      booksDbPath: sourcePath,
      sourceBooks: sourceRepository.loadCurrentBooks()
    });

    expect(result).toBeNull();
    expect(appDb.db.prepare("SELECT COUNT(*) AS count FROM scan_run").get()).toEqual({ count: 1 });
  });

  it("adds a scan run and persists changed source content", () => {
    const { sourcePath, sourceRepository } = openTestSourceDb({
      wish: [sourceBooksContract.sampleRow],
      stacked: []
    });
    const appDb = openTestAppDb();
    syncSourceBooks({ db: appDb.db, booksDbPath: sourcePath, sourceBooks: sourceRepository.loadCurrentBooks() });
    updateBookTitle(sourcePath, "wish", "https://bookmeter.com/books/1000001", "改訂された本");

    const result = syncSourceBooksIfChanged({
      db: appDb.db,
      booksDbPath: sourcePath,
      sourceBooks: sourceRepository.loadCurrentBooks()
    });

    expect(result).toMatchObject({ scanRunId: 2 });
    expect(appDb.db.prepare("SELECT COUNT(*) AS count FROM scan_run").get()).toEqual({ count: 2 });
    expect(getCurrentSnapshots(appDb.db)).toMatchObject([
      {
        bookmeterUrl: "https://bookmeter.com/books/1000001",
        title: "改訂された本",
        lastScanRunId: 2
      }
    ]);
  });
});

describe("source row-order diagnostics", () => {
  it("reports each list's first and last rows in rowid order", () => {
    const { sourceRepository } = openTestSourceDb({
      wish: [
        { bookmeter_url: "wish-1", book_title: "First wish book", author: "Wish author 1" },
        { bookmeter_url: "wish-2", book_title: "Second wish book", author: "Wish author 2" },
        { bookmeter_url: "wish-3", book_title: "Third wish book", author: "Wish author 3" }
      ],
      stacked: [
        { bookmeter_url: "stacked-1", book_title: "First stacked book", author: "Stacked author 1" },
        { bookmeter_url: "stacked-2", book_title: "Second stacked book", author: "Stacked author 2" },
        { bookmeter_url: "stacked-3", book_title: "Third stacked book", author: "Stacked author 3" }
      ]
    });

    expect(sourceRepository.loadRowOrderDiagnostics(2)).toEqual([
      {
        tableName: "wish",
        firstRows: [
          { rowid: 1, bookmeterUrl: "wish-1", title: "First wish book", author: "Wish author 1" },
          { rowid: 2, bookmeterUrl: "wish-2", title: "Second wish book", author: "Wish author 2" }
        ],
        lastRows: [
          { rowid: 2, bookmeterUrl: "wish-2", title: "Second wish book", author: "Wish author 2" },
          { rowid: 3, bookmeterUrl: "wish-3", title: "Third wish book", author: "Wish author 3" }
        ]
      },
      {
        tableName: "stacked",
        firstRows: [
          { rowid: 1, bookmeterUrl: "stacked-1", title: "First stacked book", author: "Stacked author 1" },
          { rowid: 2, bookmeterUrl: "stacked-2", title: "Second stacked book", author: "Stacked author 2" }
        ],
        lastRows: [
          { rowid: 2, bookmeterUrl: "stacked-2", title: "Second stacked book", author: "Stacked author 2" },
          { rowid: 3, bookmeterUrl: "stacked-3", title: "Third stacked book", author: "Stacked author 3" }
        ]
      }
    ]);
  });
});
