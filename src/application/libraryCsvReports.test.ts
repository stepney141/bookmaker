import { describe, expect, it } from "vitest";

import { buildLibraryCsvReports } from "./libraryCsvReports";

import type { LibraryCsvReport } from "./libraryCsvReports";
import type { Book, BookList } from "../domain/book";
import type { ISBN10 } from "../domain/isbn";

const makeBook = (bookmeterUrl: string, overrides: Partial<Book> = {}): Book => {
  return {
    bookmeter_url: bookmeterUrl,
    isbn_or_asin: "1234567890" as ISBN10,
    book_title: `title:${bookmeterUrl}`,
    author: "author",
    publisher: "publisher",
    published_date: "2024-01-01",
    sophia_opac: "",
    utokyo_opac: "",
    exist_in_sophia: "No",
    exist_in_utokyo: "No",
    sophia_mathlib_opac: "",
    description: "",
    ...overrides
  };
};

const toBookList = (books: Book[]): BookList => {
  return new Map(books.map((book) => [book.bookmeter_url, book]));
};

const getReport = (reports: ReturnType<typeof buildLibraryCsvReports>, fileName: string): LibraryCsvReport => {
  const report = reports.find((candidate) => candidate.fileName === fileName);
  if (report === undefined) {
    expect.fail(`Report not found: ${fileName}`);
  }

  return report;
};

describe("buildLibraryCsvReports", () => {
  it("builds the same wish library report groups as is_in_my_lib.sh", () => {
    const reports = buildLibraryCsvReports(
      toBookList([
        makeBook("sophia-only", {
          exist_in_sophia: "Yes",
          exist_in_utokyo: "No",
          sophia_opac: "https://sophia.example/opac"
        }),
        makeBook("utokyo-only", {
          exist_in_sophia: "No",
          exist_in_utokyo: "Yes",
          utokyo_opac: "https://utokyo.example/opac"
        }),
        makeBook("both", {
          exist_in_sophia: "Yes",
          exist_in_utokyo: "Yes",
          sophia_opac: "https://sophia.example/both",
          utokyo_opac: "https://utokyo.example/both",
          sophia_mathlib_opac: "https://sophia.example/mathlib"
        }),
        makeBook("neither")
      ])
    );

    expect(getReport(reports, "./csv/not_in_Sophia.csv").rows.map((row) => row.book_title)).toEqual([
      "title:utokyo-only",
      "title:neither"
    ]);
    expect(getReport(reports, "./csv/in_Sophia.csv").columns).toEqual([
      "isbn_or_asin",
      "book_title",
      "author",
      "publisher",
      "published_date",
      "sophia_opac",
      "sophia_mathlib_opac"
    ]);
    expect(getReport(reports, "./csv/in_Sophia.csv").rows.map((row) => row.sophia_opac)).toEqual([
      "https://sophia.example/opac",
      "https://sophia.example/both"
    ]);
    expect(getReport(reports, "./csv/in_UTokyo.csv").rows.map((row) => row.utokyo_opac)).toEqual([
      "https://utokyo.example/opac",
      "https://utokyo.example/both"
    ]);
    expect(getReport(reports, "./csv/in_Sophia_but_not_in_UTokyo.csv").rows).toHaveLength(1);
    expect(getReport(reports, "./csv/in_UTokyo_but_not_in_Sophia.csv").rows).toHaveLength(1);
    expect(getReport(reports, "./csv/not_in_Sophia_and_UTokyo.csv").rows).toHaveLength(1);
  });

  it("keeps the original title-error filtering rules", () => {
    const reports = buildLibraryCsvReports(
      toBookList([
        makeBook("invalid-sophia", {
          book_title: "INVALID_ISBN: 0000000000",
          exist_in_sophia: "Yes",
          exist_in_utokyo: "Yes"
        }),
        makeBook("not-found", {
          book_title: "Not_found_in_openbd",
          exist_in_sophia: "No",
          exist_in_utokyo: "No"
        })
      ])
    );

    expect(getReport(reports, "./csv/in_Sophia.csv").rows.map((row) => row.book_title)).toEqual([
      "INVALID_ISBN: 0000000000"
    ]);
    expect(getReport(reports, "./csv/in_UTokyo.csv").rows).toEqual([]);
    expect(getReport(reports, "./csv/not_in_Sophia.csv").rows).toEqual([]);
    expect(getReport(reports, "./csv/not_in_Sophia_and_UTokyo.csv").rows).toEqual([]);
  });
});
