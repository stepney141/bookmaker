import { describe, expect, it } from "vitest";

import { openTestAppDb } from "../testing/appDb";
import { snapshotOf, wishBook } from "../testing/books";

import { ensureBookEmbeddings } from "./repository";

import type { EmbeddingProvider } from "./types";

type EmbeddingFixture = {
  readonly marker: string;
  readonly vector: readonly [number, number, number];
};

type EmbeddingRecord = {
  readonly text: string;
  readonly vector: Float32Array;
};

function createProvider(fixtures: readonly EmbeddingFixture[]): EmbeddingProvider & {
  readonly recordings: () => readonly EmbeddingRecord[];
} {
  let recordings: readonly EmbeddingRecord[] = [];

  return {
    providerId: "fixture",
    modelId: "fixture-model",
    dimension: 3,
    recordings: () => recordings,
    embed(input) {
      let vectors: readonly Float32Array[] = [];

      for (const text of input.texts) {
        const fixture = fixtures.find(({ marker }) => text.includes(marker));
        if (!fixture) {
          return Promise.reject(new Error(`No embedding fixture matches: ${text}`));
        }

        const vector = Float32Array.from(fixture.vector);
        recordings = [...recordings, { text, vector }];
        vectors = [...vectors, vector];
      }

      return Promise.resolve(vectors);
    }
  };
}

describe("ensureBookEmbeddings", () => {
  it("reuses persisted vectors without requesting embeddings for unchanged input", async () => {
    const appDb = openTestAppDb();
    const provider = createProvider([{ marker: "[cached-book]", vector: [1, 2, 3] }]);
    const book = snapshotOf(
      wishBook({
        bookmeterUrl: "https://bookmeter.example/cached",
        title: "Cached book",
        remoteRank: 1,
        description: "[cached-book]"
      })
    );

    const first = await ensureBookEmbeddings({ db: appDb.db, provider, books: [book] });
    const cached = await ensureBookEmbeddings({ db: appDb.db, provider, books: [book] });

    expect(first.get(book.bookmeterUrl)?.vector).toEqual(Float32Array.from([1, 2, 3]));
    expect(cached.get(book.bookmeterUrl)?.vector).toEqual(Float32Array.from([1, 2, 3]));
    expect(provider.recordings().map(({ text }) => text)).toEqual([expect.stringContaining("[cached-book]")]);
    expect(provider.recordings().map(({ vector }) => vector)).toEqual([Float32Array.from([1, 2, 3])]);
  });

  it("recomputes and persists the new vector when embedding input changes", async () => {
    const appDb = openTestAppDb();
    const provider = createProvider([
      { marker: "[original-description]", vector: [1, 2, 3] },
      { marker: "[updated-description]", vector: [4, 5, 6] }
    ]);
    const book = snapshotOf(
      wishBook({
        bookmeterUrl: "https://bookmeter.example/updated",
        title: "Updated book",
        remoteRank: 1,
        description: "[original-description]"
      })
    );

    await ensureBookEmbeddings({ db: appDb.db, provider, books: [book] });
    const updatedBook = { ...book, description: "[updated-description]" };
    const refreshed = await ensureBookEmbeddings({ db: appDb.db, provider, books: [updatedBook] });
    const cached = await ensureBookEmbeddings({ db: appDb.db, provider, books: [updatedBook] });

    expect(refreshed.get(book.bookmeterUrl)?.vector).toEqual(Float32Array.from([4, 5, 6]));
    expect(cached.get(book.bookmeterUrl)?.vector).toEqual(Float32Array.from([4, 5, 6]));
    expect(provider.recordings().map(({ text }) => text)).toEqual([
      expect.stringContaining("[original-description]"),
      expect.stringContaining("[updated-description]")
    ]);
    expect(provider.recordings().map(({ vector }) => vector)).toEqual([
      Float32Array.from([1, 2, 3]),
      Float32Array.from([4, 5, 6])
    ]);
  });

  it("persists each of 130 books with the vector for its own input", async () => {
    const appDb = openTestAppDb();
    const fixtures = Array.from({ length: 130 }, (_, index) => ({
      bookmeterUrl: `https://bookmeter.example/book-${index + 1}`,
      marker: `[book-${index + 1}]`,
      vector: [index + 1, -(index + 1), 2 * index + 1] as const
    }));
    const provider = createProvider(fixtures);
    const books = fixtures.map((fixture, index) =>
      snapshotOf(
        wishBook({
          bookmeterUrl: fixture.bookmeterUrl,
          title: `Book ${index + 1}`,
          remoteRank: index + 1,
          description: fixture.marker
        })
      )
    );

    const first = await ensureBookEmbeddings({ db: appDb.db, provider, books });
    const cached = await ensureBookEmbeddings({ db: appDb.db, provider, books });

    expect(first.size).toBe(130);
    expect(cached.size).toBe(130);
    for (const fixture of fixtures) {
      expect(first.get(fixture.bookmeterUrl)?.vector).toEqual(Float32Array.from(fixture.vector));
      expect(cached.get(fixture.bookmeterUrl)?.vector).toEqual(Float32Array.from(fixture.vector));
    }
  });
});
