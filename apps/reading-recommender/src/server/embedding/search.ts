import { cosineSimilarity } from "./vector";

import type { CachedBookEmbedding, EmbeddingProvider } from "./types";

export function createSemanticScores(input: {
  readonly queryVector: Float32Array;
  readonly embeddings: ReadonlyMap<string, CachedBookEmbedding>;
}): Map<string, number> {
  return new Map(
    [...input.embeddings.values()].flatMap((embedding) => {
      const similarity = cosineSimilarity(input.queryVector, embedding.vector);
      return similarity > 0 ? [[embedding.bookmeterUrl, similarity] as const] : [];
    })
  );
}

export async function embedQuery(input: {
  readonly provider: EmbeddingProvider;
  readonly query: string;
}): Promise<Float32Array | null> {
  const vectors = await input.provider.embed({ texts: [input.query], kind: "query" });
  return vectors[0] ?? null;
}
