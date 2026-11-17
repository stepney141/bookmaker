import { exportFile } from "../libs/utils";

import type { Book, BookList } from "../domain/book";

type ReportColumn =
  | "isbn_or_asin"
  | "book_title"
  | "author"
  | "publisher"
  | "published_date"
  | "sophia_opac"
  | "utokyo_opac"
  | "sophia_mathlib_opac";

type ReportDefinition = {
  fileName: string;
  columns: readonly ReportColumn[];
  include: (book: Book) => boolean;
};

type ReportRow = Partial<Record<ReportColumn, string>>;
type CsvPayload = {
  fields: ReportColumn[];
  data: ReportRow[];
};

export type LibraryCsvReport = {
  fileName: string;
  columns: readonly ReportColumn[];
  rows: ReportRow[];
};

const BASE_COLUMNS = ["isbn_or_asin", "book_title", "author", "publisher", "published_date"] as const;

function pickColumns(book: Book, columns: readonly ReportColumn[]): ReportRow {
  return Object.fromEntries(columns.map((column) => [column, book[column]]));
}

const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    fileName: "./csv/not_in_Sophia.csv",
    columns: BASE_COLUMNS,
    include: (book) => book.exist_in_sophia === "No"
  },
  {
    fileName: "./csv/in_Sophia.csv",
    columns: [...BASE_COLUMNS, "sophia_opac", "sophia_mathlib_opac"],
    include: (book) => book.exist_in_sophia === "Yes"
  },
  {
    fileName: "./csv/not_in_UTokyo.csv",
    columns: BASE_COLUMNS,
    include: (book) => book.exist_in_utokyo === "No"
  },
  {
    fileName: "./csv/in_UTokyo.csv",
    columns: [...BASE_COLUMNS, "utokyo_opac"],
    include: (book) => book.exist_in_utokyo === "Yes"
  },
  {
    fileName: "./csv/in_Sophia_but_not_in_UTokyo.csv",
    columns: [...BASE_COLUMNS, "sophia_opac"],
    include: (book) => book.exist_in_sophia === "Yes" && book.exist_in_utokyo === "No"
  },
  {
    fileName: "./csv/in_UTokyo_but_not_in_Sophia.csv",
    columns: [...BASE_COLUMNS, "utokyo_opac"],
    include: (book) => book.exist_in_sophia === "No" && book.exist_in_utokyo === "Yes"
  },
  {
    fileName: "./csv/not_in_Sophia_and_UTokyo.csv",
    columns: BASE_COLUMNS,
    include: (book) => book.exist_in_sophia === "No" && book.exist_in_utokyo === "No"
  }
];

export function buildLibraryCsvReports(bookList: BookList): LibraryCsvReport[] {
  const books = Array.from(bookList.values());

  return REPORT_DEFINITIONS.map((definition) => ({
    fileName: definition.fileName,
    columns: definition.columns,
    rows: books.filter(definition.include).map((book) => pickColumns(book, definition.columns))
  }));
}

export async function exportLibraryCsvReports(bookList: BookList): Promise<void> {
  const reports = buildLibraryCsvReports(bookList);

  for (const report of reports) {
    await exportFile<CsvPayload>({
      fileName: report.fileName,
      payload: {
        fields: [...report.columns],
        data: report.rows
      },
      targetType: "csv",
      mode: "overwrite"
    });
    console.log(`Finished writing ${report.fileName}`);
  }
}
