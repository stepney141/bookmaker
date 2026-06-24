/**
 * db モジュールで使用する定数。
 */

import path from "path";

/**
 * 共有 SQLite データベースの絶対パス。
 * モノレポルートの `data/books.sqlite` を指す（生成元はこの bookmeter アプリ）。
 * 環境変数 `BOOKS_DB_PATH` で上書き可能。
 */
export const DB_PATH = process.env.BOOKS_DB_PATH ?? path.resolve(__dirname, "../../../../data/books.sqlite");

export const DEFAULT_CSV_FILENAME = {
  wish: "./csv/bookmeter_wish_books.csv",
  stacked: "./csv/bookmeter_stacked_books.csv"
};

/**
 * CSVエクスポート時に含めるカラム
 */
export const CSV_EXPORT_COLUMNS = {
  wish: [
    "bookmeter_url",
    "isbn_or_asin",
    "book_title",
    "author",
    "publisher",
    "published_date",
    "exist_in_sophia",
    "exist_in_utokyo",
    "sophia_opac",
    "utokyo_opac",
    "sophia_mathlib_opac"
  ],
  stacked: ["bookmeter_url", "isbn_or_asin", "book_title", "author", "publisher", "published_date"]
} as const;
