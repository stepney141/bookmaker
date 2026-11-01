import { z } from "zod";

import type { EmbeddingProvider } from "./types";

const DEFAULT_MODEL = "text-embedding-3-large";
const DEFAULT_DIMENSION = 1024;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number())
    })
  )
});

export function createOpenAIEmbeddingProvider(input: {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly dimension?: number;
}): EmbeddingProvider {
  const modelId = input.modelId ?? DEFAULT_MODEL;
  const dimension = input.dimension ?? DEFAULT_DIMENSION;

  return {
    providerId: "openai",
    modelId,
    dimension,
    async embed(request) {
      const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: request.texts,
          model: modelId,
          dimensions: dimension
        })
      });

      if (!response.ok) {
        return Promise.reject(new Error(`OpenAI embeddings request failed with status ${response.status}`));
      }

      const parsed = embeddingResponseSchema.parse(await response.json());
      return parsed.data.map((item) => Float32Array.from(item.embedding));
    }
  };
}

export function createOpenAIEmbeddingProviderFromEnv(env: NodeJS.ProcessEnv): EmbeddingProvider | null {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  const dimension = env.OPENAI_EMBEDDING_DIMENSIONS ? Number(env.OPENAI_EMBEDDING_DIMENSIONS) : DEFAULT_DIMENSION;

  return createOpenAIEmbeddingProvider({
    apiKey: env.OPENAI_API_KEY,
    modelId: env.OPENAI_EMBEDDING_MODEL || DEFAULT_MODEL,
    dimension: Number.isFinite(dimension) ? dimension : DEFAULT_DIMENSION
  });
}
