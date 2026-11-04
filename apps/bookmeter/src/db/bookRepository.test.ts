import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "papaparse";
import { describe, expect, it, onTestFinished } from "vitest";

import { makeBook, toBookList } from "../testing/books";

import { createDrizzleBookRepository } from "./bookRepository";
import { createDbClient } from "./client";

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "bookmeter-repo-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

describe("createDrizzleBookRepository", () => {
  it("loads books in the same order as the latest remote snapshot", () => {
    const repo = createDrizzleBookRepository(createDbClient(":memory:"));

    expect(repo.save(toBookList([makeBook("old-1"), makeBook("old-2")]), "wish").ok).toBe(true);
    expect(repo.save(toBookList([makeBook("new-1"), makeBook("old-1"), makeBook("old-2")]), "wish").ok).toBe(true);

    const loadResult = repo.load("wish");
    if (!loadResult.ok) {
      expect.fail(loadResult.err.message);
    }

    expect([...loadResult.value.keys()]).toEqual(["new-1", "old-1", "old-2"]);
  });

  it("exports CSV in remote order and preserves cached descriptions when reordering", async () => {
    const repo = createDrizzleBookRepository(createDbClient(":memory:"));
    const outputDir = await createTempDir();
    const csvPath = join(outputDir, "wish.csv");

    expect(
      repo.save(toBookList([makeBook("old-1", { description: "cached-description" }), makeBook("old-2")]), "wish").ok
    ).toBe(true);
    expect(repo.save(toBookList([makeBook("new-1"), makeBook("old-1"), makeBook("old-2")]), "wish").ok).toBe(true);

    const loadResult = repo.load("wish");
    if (!loadResult.ok) {
      expect.fail(loadResult.err.message);
    }

    expect(loadResult.value.get("old-1")?.description).toBe("cached-description");

    const exportResult = await repo.exportToCsv("wish", csvPath, ["bookmeter_url", "book_title"]);
    if (!exportResult.ok) {
      expect.fail(exportResult.err.message);
    }

    const csv = await readFile(csvPath, "utf-8");
    const parsed = parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.map((row) => row.bookmeter_url)).toEqual(["new-1", "old-1", "old-2"]);
  });
});
