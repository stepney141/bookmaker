import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCurrentSnapshots, openAppDb } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";

import { ensureBookEmbeddings } from "./repository";

import type { EmbeddingProvider } from "./types";
import type { SourceBook } from "../shared/types";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "reading-recommender-embedding-"));
}

function sourceBook(description: string): SourceBook {
  return {
    bookmeterUrl: "https://bookmeter.example/security",
    isbnOrAsin: "9784000000011",
    title: "情報セキュリティの基礎",
    author: "山田太郎",
    publisher: "テスト出版",
    publishedDate: "2026",
    description,
    inWish: true,
    inStacked: false,
    sophiaLibraryStatus: "unknown",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "",
    utokyoOpacUrl: "",
    wishRowid: 1,
    stackedRowid: null,
    remoteRank: 1,
    remoteRankSource: "wish"
  };
}

function mockProvider(): EmbeddingProvider & { readonly calls: () => number } {
  let calls = 0;

  return {
    providerId: "mock",
    modelId: "mock-model",
    dimension: 3,
    calls: () => calls,
    embed(input) {
      calls += 1;
      return Promise.resolve(input.texts.map(() => Float32Array.from([1, 0, 0])));
    }
  };
}

describe("ensureBookEmbeddings", () => {
  it("caches vectors and refreshes them when embedding input changes", async () => {
    const dir = createTempDir();
    try {
      const appDb = openAppDb(join(dir, "app.sqlite"));
      const provider = mockProvider();

      syncSourceBooks({
        db: appDb.db,
        booksDbPath: "fixture",
        sourceBooks: [sourceBook("暗号、認証、脆弱性を扱います。")]
      });

      const first = await ensureBookEmbeddings({
        db: appDb.db,
        provider,
        books: getCurrentSnapshots(appDb.db)
      });
      const second = await ensureBookEmbeddings({
        db: appDb.db,
        provider,
        books: getCurrentSnapshots(appDb.db)
      });

      expect(provider.calls()).toBe(1);
      expect(first.get("https://bookmeter.example/security")?.vector[0]).toBe(1);
      expect(second.get("https://bookmeter.example/security")?.vector[0]).toBe(1);

      syncSourceBooks({
        db: appDb.db,
        booksDbPath: "fixture",
        sourceBooks: [sourceBook("安全な通信と公開鍵暗号を扱います。")]
      });
      await ensureBookEmbeddings({
        db: appDb.db,
        provider,
        books: getCurrentSnapshots(appDb.db)
      });

      expect(provider.calls()).toBe(2);

      appDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
