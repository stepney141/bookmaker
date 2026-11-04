import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { FetcherError, toErrorStatus } from "../fetchers/errors";
import { toBookList } from "../testing/books";
import { sourceBooksContract } from "../testing/sourceBooksContract";

import { createDrizzleBookRepository } from "./bookRepository";
import { createDbClient } from "./client";

import type { FetcherErrorContext } from "../fetchers/errors";

describe("source books writer contract", () => {
  it.each(sourceBooksContract.tables)("writes the shared schema and sample row to %s", (table) => {
    const db = createDbClient(":memory:");
    const repo = createDrizzleBookRepository(db);

    expect(repo.save(toBookList([sourceBooksContract.sampleRow]), table).ok).toBe(true);

    const columns = db.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(table)})`);
    expect(new Set(columns.map((column) => column.name))).toEqual(new Set(sourceBooksContract.columns));
    expect(db.all(sql`SELECT * FROM ${sql.identifier(table)}`)).toEqual([sourceBooksContract.sampleRow]);
  });

  it.each(
    (["OpenBD", "ISBNdb", "NDL", "GoogleBooks", "CiNii"] as const).flatMap(
      (source) =>
        [
          { type: "notFound", source },
          { type: "apiError", source, status: 503 },
          { type: "networkError", source }
        ] satisfies FetcherErrorContext[]
    )
  )("includes the $source $type status in the shared placeholders", (context) => {
    expect(sourceBooksContract.placeholderTitles).toContain(toErrorStatus(new FetcherError(context)));
  });

  it("includes the invalid ISBN status in the shared placeholders", () => {
    expect(sourceBooksContract.placeholderTitles).toContain(toErrorStatus(new FetcherError({ type: "invalidIsbn" })));
  });
});
