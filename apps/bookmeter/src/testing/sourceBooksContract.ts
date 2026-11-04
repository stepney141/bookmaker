import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Book } from "../domain/book";

type SourceBooksContract = {
  tables: readonly ("wish" | "stacked")[];
  columns: readonly string[];
  sampleRow: Book;
  placeholderTitles: readonly string[];
};

export const sourceBooksContract = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../testdata/source-books-contract.json"), "utf-8")
) as SourceBooksContract;
