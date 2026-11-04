import { describe, expect, it } from "vitest";

import { makeBook, toBookList } from "../testing/books";
import { sourceBooksContract } from "../testing/sourceBooksContract";

import { buildLibraryCsvReports } from "./libraryCsvReports";

const bibliographicColumns = ["isbn_or_asin", "book_title", "author", "publisher", "published_date"];

const sophiaOnlyRow = {
  isbn_or_asin: "4062938428",
  book_title: "title:sophia-only",
  author: "Sophia author",
  publisher: "Sophia publisher",
  published_date: "2021-01-01"
};
const utokyoOnlyRow = {
  isbn_or_asin: "4062938428",
  book_title: "title:utokyo-only",
  author: "UTokyo author",
  publisher: "UTokyo publisher",
  published_date: "2022-02-02"
};
const bothRow = {
  isbn_or_asin: "4062938428",
  book_title: "title:both",
  author: "Both author",
  publisher: "Both publisher",
  published_date: "2023-03-03"
};
const neitherRow = {
  isbn_or_asin: "4062938428",
  book_title: "title:neither",
  author: "Neither author",
  publisher: "Neither publisher",
  published_date: "2024-04-04"
};

const filteredPlaceholderTitles = sourceBooksContract.placeholderTitles.filter(
  (title) => title.startsWith("Not_found_in_") || title === "INVALID_ISBN"
);

describe("buildLibraryCsvReports", () => {
  it.each([
    {
      fileName: "./csv/not_in_Sophia.csv",
      columns: bibliographicColumns,
      rows: [utokyoOnlyRow, neitherRow]
    },
    {
      fileName: "./csv/in_Sophia.csv",
      columns: [...bibliographicColumns, "sophia_opac", "sophia_mathlib_opac"],
      rows: [
        {
          ...sophiaOnlyRow,
          sophia_opac: "https://sophia.example/only",
          sophia_mathlib_opac: "https://sophia.example/mathlib/only"
        },
        {
          ...bothRow,
          sophia_opac: "https://sophia.example/both",
          sophia_mathlib_opac: "https://sophia.example/mathlib/both"
        }
      ]
    },
    {
      fileName: "./csv/not_in_UTokyo.csv",
      columns: bibliographicColumns,
      rows: [sophiaOnlyRow, neitherRow]
    },
    {
      fileName: "./csv/in_UTokyo.csv",
      columns: [...bibliographicColumns, "utokyo_opac"],
      rows: [
        { ...utokyoOnlyRow, utokyo_opac: "https://utokyo.example/only" },
        { ...bothRow, utokyo_opac: "https://utokyo.example/both" }
      ]
    },
    {
      fileName: "./csv/in_Sophia_but_not_in_UTokyo.csv",
      columns: [...bibliographicColumns, "sophia_opac"],
      rows: [{ ...sophiaOnlyRow, sophia_opac: "https://sophia.example/only" }]
    },
    {
      fileName: "./csv/in_UTokyo_but_not_in_Sophia.csv",
      columns: [...bibliographicColumns, "utokyo_opac"],
      rows: [{ ...utokyoOnlyRow, utokyo_opac: "https://utokyo.example/only" }]
    },
    {
      fileName: "./csv/not_in_Sophia_and_UTokyo.csv",
      columns: bibliographicColumns,
      rows: [neitherRow]
    }
  ])("selects the specified rows and columns for $fileName", (expectedReport) => {
    const reports = buildLibraryCsvReports(
      toBookList([
        makeBook("sophia-only", {
          author: "Sophia author",
          publisher: "Sophia publisher",
          published_date: "2021-01-01",
          exist_in_sophia: "Yes",
          exist_in_utokyo: "No",
          sophia_opac: "https://sophia.example/only",
          sophia_mathlib_opac: "https://sophia.example/mathlib/only"
        }),
        makeBook("utokyo-only", {
          author: "UTokyo author",
          publisher: "UTokyo publisher",
          published_date: "2022-02-02",
          exist_in_sophia: "No",
          exist_in_utokyo: "Yes",
          utokyo_opac: "https://utokyo.example/only"
        }),
        makeBook("both", {
          author: "Both author",
          publisher: "Both publisher",
          published_date: "2023-03-03",
          exist_in_sophia: "Yes",
          exist_in_utokyo: "Yes",
          sophia_opac: "https://sophia.example/both",
          utokyo_opac: "https://utokyo.example/both",
          sophia_mathlib_opac: "https://sophia.example/mathlib/both"
        }),
        makeBook("neither", {
          author: "Neither author",
          publisher: "Neither publisher",
          published_date: "2024-04-04",
          exist_in_sophia: "No",
          exist_in_utokyo: "No"
        })
      ])
    );

    expect(reports.find((report) => report.fileName === expectedReport.fileName)).toEqual(expectedReport);
  });

  it.each(filteredPlaceholderTitles)("retains %s only in the Sophia holdings report", (placeholderTitle) => {
    const holdingsCases = [
      { name: "sophia-only", exist_in_sophia: "Yes", exist_in_utokyo: "No" },
      { name: "utokyo-only", exist_in_sophia: "No", exist_in_utokyo: "Yes" },
      { name: "both", exist_in_sophia: "Yes", exist_in_utokyo: "Yes" },
      { name: "neither", exist_in_sophia: "No", exist_in_utokyo: "No" }
    ] as const;
    const reports = buildLibraryCsvReports(
      toBookList(
        holdingsCases.flatMap(({ name, ...holdings }) => [
          makeBook(`${name}-placeholder`, { ...holdings, book_title: placeholderTitle }),
          makeBook(`${name}-valid`, holdings)
        ])
      )
    );

    expect(
      Object.fromEntries(reports.map((report) => [report.fileName, report.rows.map((row) => row.book_title)]))
    ).toEqual({
      "./csv/not_in_Sophia.csv": ["title:utokyo-only-valid", "title:neither-valid"],
      "./csv/in_Sophia.csv": [placeholderTitle, "title:sophia-only-valid", placeholderTitle, "title:both-valid"],
      "./csv/not_in_UTokyo.csv": ["title:sophia-only-valid", "title:neither-valid"],
      "./csv/in_UTokyo.csv": ["title:utokyo-only-valid", "title:both-valid"],
      "./csv/in_Sophia_but_not_in_UTokyo.csv": ["title:sophia-only-valid"],
      "./csv/in_UTokyo_but_not_in_Sophia.csv": ["title:utokyo-only-valid"],
      "./csv/not_in_Sophia_and_UTokyo.csv": ["title:neither-valid"]
    });
  });
});
