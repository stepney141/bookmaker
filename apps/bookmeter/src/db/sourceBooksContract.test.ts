import { sql } from "drizzle-orm";
import { assert, describe, expect, it } from "vitest";

import { fetchGoogleBooks } from "../fetchers/googlebooks";
import { fetchISBNdb } from "../fetchers/isbndb";
import { fetchNDL } from "../fetchers/ndl";
import { bulkFetchOpenBD } from "../fetchers/openbd";
import { Ok, unwrap } from "../libs/lib";
import { toBookList } from "../testing/books";
import { sourceBooksContract } from "../testing/sourceBooksContract";

import { createDrizzleBookRepository } from "./bookRepository";
import { createDbClient } from "./client";

import type { FetcherSource, HttpError } from "../fetchers/errors";
import type { HttpClient } from "../fetchers/httpClient";
import type { Result } from "../libs/lib";

function unexpectedRequest(): never {
  return assert.fail("Unexpected HTTP client method");
}

const notFoundClient: HttpClient = {
  get: unexpectedRequest,
  getWithStatus: unexpectedRequest,
  getRaw: unexpectedRequest,
  getRawSafe: unexpectedRequest,
  getSafe<T>(_url: string, source: FetcherSource): Promise<Result<T, HttpError>> {
    switch (source) {
      case "OpenBD":
        return Promise.resolve(Ok([null] as T));
      case "GoogleBooks":
        return Promise.resolve(Ok({ totalItems: 0 } as T));
      case "NDL":
        return Promise.resolve(Ok("<rss><channel><title>NDL Search</title></channel></rss>" as T));
      default:
        return unexpectedRequest();
    }
  },
  getWithStatusSafe<T>(_url: string, source: FetcherSource): Promise<Result<{ data: T; status: number }, HttpError>> {
    if (source !== "ISBNdb") {
      return unexpectedRequest();
    }
    return Promise.resolve(Ok({ data: { errorMessage: "Not Found" } as T, status: 404 }));
  }
};

describe("source books writer contract", () => {
  it.each(sourceBooksContract.tables)("writes the shared schema and sample row to %s", (table) => {
    const db = createDbClient(":memory:");
    const repo = createDrizzleBookRepository(db);

    expect(repo.save(toBookList([sourceBooksContract.sampleRow]), table).ok).toBe(true);

    const columns = db.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(table)})`);
    expect(new Set(columns.map((column) => column.name))).toEqual(new Set(sourceBooksContract.columns));
    expect(db.all(sql`SELECT * FROM ${sql.identifier(table)}`)).toEqual([sourceBooksContract.sampleRow]);
  });

  it("matches the shared placeholders to titles produced by the four bibliographic fetchers", async () => {
    const book = sourceBooksContract.sampleRow;
    const results = [
      ...unwrap(await bulkFetchOpenBD(toBookList([book]), notFoundClient)),
      unwrap(await fetchISBNdb(book, "test-key", notFoundClient)),
      unwrap(await fetchGoogleBooks(book, "test-key", notFoundClient)),
      unwrap(await fetchNDL(book, notFoundClient))
    ];

    expect(new Set(results.map((result) => result.book.book_title))).toEqual(
      new Set(sourceBooksContract.placeholderTitles)
    );
  });
});
