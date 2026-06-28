import { createEmbeddingDocument } from "./document";
import { decodeVector, encodeVector } from "./vector";

import type { EmbeddingDocument } from "./document";
import type { CachedBookEmbedding, EmbeddingProvider } from "./types";
import type { BookSnapshot } from "../shared/types";
import type Database from "better-sqlite3";

type EmbeddingRow = {
  readonly bookmeter_url: string;
  readonly input_hash: string;
  readonly vector_blob: Buffer;
};

const EMBEDDING_BATCH_SIZE = 64;

function nowIso(): string {
  return new Date().toISOString();
}

function chunkDocuments<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function providerParams(provider: EmbeddingProvider): readonly [string, string, number] {
  return [provider.providerId, provider.modelId, provider.dimension];
}

function loadCachedRows(input: {
  readonly db: Database.Database;
  readonly provider: EmbeddingProvider;
}): Map<string, CachedBookEmbedding> {
  const rows = input.db
    .prepare(
      `SELECT bookmeter_url, input_hash, vector_blob
       FROM book_embedding
       WHERE provider_id = ? AND model_id = ? AND dimension = ?`
    )
    .all(...providerParams(input.provider)) as readonly EmbeddingRow[];

  return new Map(
    rows.map((row) => [
      row.bookmeter_url,
      {
        bookmeterUrl: row.bookmeter_url,
        inputHash: row.input_hash,
        vector: decodeVector(row.vector_blob)
      }
    ])
  );
}

function saveEmbedding(input: {
  readonly db: Database.Database;
  readonly provider: EmbeddingProvider;
  readonly document: EmbeddingDocument;
  readonly vector: Float32Array;
}): void {
  input.db
    .prepare(
      `INSERT INTO book_embedding (
        bookmeter_url,
        provider_id,
        model_id,
        dimension,
        input_hash,
        vector_blob,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, model_id, dimension, bookmeter_url) DO UPDATE SET
        input_hash = excluded.input_hash,
        vector_blob = excluded.vector_blob,
        created_at = excluded.created_at`
    )
    .run(
      input.document.bookmeterUrl,
      input.provider.providerId,
      input.provider.modelId,
      input.provider.dimension,
      input.document.inputHash,
      encodeVector(input.vector),
      nowIso()
    );
}

export async function ensureBookEmbeddings(input: {
  readonly db: Database.Database;
  readonly provider: EmbeddingProvider;
  readonly books: readonly BookSnapshot[];
}): Promise<Map<string, CachedBookEmbedding>> {
  const documents = input.books.map(createEmbeddingDocument);
  const cached = loadCachedRows({ db: input.db, provider: input.provider });
  const missing = documents.filter((document) => cached.get(document.bookmeterUrl)?.inputHash !== document.inputHash);

  if (missing.length === 0) {
    return cached;
  }

  for (const batch of chunkDocuments(missing, EMBEDDING_BATCH_SIZE)) {
    const vectors = await input.provider.embed({ texts: batch.map((document) => document.text), kind: "document" });

    for (const [index, document] of batch.entries()) {
      const vector = vectors[index];

      if (vector) {
        saveEmbedding({ db: input.db, provider: input.provider, document, vector });
      }
    }
  }

  return loadCachedRows({ db: input.db, provider: input.provider });
}
