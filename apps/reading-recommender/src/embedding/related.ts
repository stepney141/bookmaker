import { cosineSimilarity } from "./vector";

import type { CachedBookEmbedding } from "./types";

export function createRelatedSemanticScores(input: {
  readonly primaryBookmeterUrl: string;
  readonly embeddings: ReadonlyMap<string, CachedBookEmbedding>;
}): Map<string, number> {
  const primary = input.embeddings.get(input.primaryBookmeterUrl);

  if (!primary) {
    return new Map();
  }

  return new Map(
    [...input.embeddings.values()].flatMap((embedding) => {
      if (embedding.bookmeterUrl === input.primaryBookmeterUrl) {
        return [];
      }

      const similarity = cosineSimilarity(primary.vector, embedding.vector);
      return similarity > 0 ? [[embedding.bookmeterUrl, similarity] as const] : [];
    })
  );
}
