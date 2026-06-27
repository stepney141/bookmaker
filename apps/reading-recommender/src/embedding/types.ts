export type EmbeddingInputKind = "query" | "document";

export type EmbeddingProvider = {
  readonly providerId: string;
  readonly modelId: string;
  readonly dimension: number;
  readonly embed: (input: {
    readonly texts: readonly string[];
    readonly kind: EmbeddingInputKind;
  }) => Promise<readonly Float32Array[]>;
};

export type CachedBookEmbedding = {
  readonly bookmeterUrl: string;
  readonly inputHash: string;
  readonly vector: Float32Array;
};
