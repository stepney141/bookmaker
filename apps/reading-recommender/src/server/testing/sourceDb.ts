import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

import type { BookListKind } from "../../types/api";

export type SourceBookRow = {
  readonly bookmeter_url: string;
  readonly book_title: string | null;
  readonly isbn_or_asin?: string | null;
  readonly author?: string | null;
  readonly publisher?: string | null;
  readonly published_date?: string | null;
  readonly sophia_opac?: string | null;
  readonly utokyo_opac?: string | null;
  readonly exist_in_sophia?: string | null;
  readonly exist_in_utokyo?: string | null;
  readonly sophia_mathlib_opac?: string | null;
  readonly description?: string | null;
};

export type SourceBookLists = Readonly<Record<BookListKind, readonly SourceBookRow[]>>;

export const sourceBooksContract = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../testdata/source-books-contract.json"), "utf8")
) as {
  readonly tables: readonly BookListKind[];
  readonly columns: readonly (keyof SourceBookRow)[];
  readonly sampleRow: Required<SourceBookRow>;
  readonly placeholderTitles: readonly string[];
};

function writeBook(db: Database.Database, table: BookListKind, book: SourceBookRow): void {
  const row: Required<SourceBookRow> = {
    isbn_or_asin: null,
    author: null,
    publisher: null,
    published_date: null,
    sophia_opac: null,
    utokyo_opac: null,
    exist_in_sophia: null,
    exist_in_utokyo: null,
    sophia_mathlib_opac: null,
    description: null,
    ...book
  };
  const { columns } = sourceBooksContract;
  db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`
  ).run(row);
}

function editSourceDb(path: string, edit: (db: Database.Database) => void): void {
  const db = new Database(path, { fileMustExist: true });
  try {
    edit(db);
  } finally {
    db.close();
  }
}

export function createSourceDb(path: string, books: SourceBookLists): void {
  const db = new Database(path);
  try {
    const definitions = sourceBooksContract.columns.map((column) =>
      column === "bookmeter_url" ? `${column} TEXT PRIMARY KEY` : `${column} TEXT`
    );
    for (const table of sourceBooksContract.tables) {
      db.exec(`CREATE TABLE ${table} (${definitions.join(", ")})`);
      for (const book of books[table]) {
        writeBook(db, table, book);
      }
    }
  } finally {
    db.close();
  }
}

export function insertBook(path: string, table: BookListKind, book: SourceBookRow): void {
  editSourceDb(path, (db) => writeBook(db, table, book));
}

export function deleteBook(path: string, table: BookListKind, bookmeterUrl: string): void {
  editSourceDb(path, (db) => {
    db.prepare(`DELETE FROM ${table} WHERE bookmeter_url = ?`).run(bookmeterUrl);
  });
}

export function updateBookTitle(path: string, table: BookListKind, bookmeterUrl: string, title: string): void {
  editSourceDb(path, (db) => {
    db.prepare(`UPDATE ${table} SET book_title = ? WHERE bookmeter_url = ?`).run(title, bookmeterUrl);
  });
}
