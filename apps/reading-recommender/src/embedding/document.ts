import { sha256 } from "../db/hash";

import type { BookSnapshot, SourceBook } from "../shared/types";

const DESCRIPTION_LIMIT = 1200;

export type EmbeddingDocument = {
  readonly bookmeterUrl: string;
  readonly text: string;
  readonly inputHash: string;
};

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function createEmbeddingDocument(book: SourceBook | BookSnapshot): EmbeddingDocument {
  const description = compact(book.description).slice(0, DESCRIPTION_LIMIT);
  const fields = [
    `title: ${compact(book.title)}`,
    `author: ${compact(book.author)}`,
    `publisher: ${compact(book.publisher)}`,
    description.length > 0 ? `description: ${description}` : null
  ].filter((field): field is string => field !== null);
  const text = fields.join("\n");

  return {
    bookmeterUrl: book.bookmeterUrl,
    text,
    inputHash: sha256([text])
  };
}
