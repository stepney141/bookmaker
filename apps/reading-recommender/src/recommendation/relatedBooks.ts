import type { BookSnapshot, RelatedBook } from "../shared/types";

const LEGACY_WEIGHTS = {
  lexical: 0.85,
  sameAuthor: 0.1,
  samePublisher: 0.05
} as const;

const SEMANTIC_WEIGHTS = {
  semantic: 0.45,
  lexical: 0.35,
  sameAuthor: 0.12,
  samePublisher: 0.08
} as const;

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[\s,、。:：;；/／()（）「」『』【】]+/u)
    .filter((token) => token.length >= 2);
}

function lexicalSimilarity(a: BookSnapshot, b: BookSnapshot): number {
  const left = new Set(tokenize(`${a.title} ${a.author} ${a.publisher} ${a.description}`));
  const right = new Set(tokenize(`${b.title} ${b.author} ${b.publisher} ${b.description}`));

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function optionalPositive(value: number | undefined): number | null {
  return value !== undefined && value > 0 ? value : null;
}

function sameAuthorScore(primary: BookSnapshot, book: BookSnapshot): number {
  return primary.author && primary.author === book.author ? 1 : 0;
}

function samePublisherScore(primary: BookSnapshot, book: BookSnapshot): number {
  return primary.publisher && primary.publisher === book.publisher ? 1 : 0;
}

function weightedSemanticScore(input: {
  readonly semanticScore: number | null;
  readonly lexicalScore: number;
  readonly sameAuthor: number;
  readonly samePublisher: number;
}): number {
  return (
    (input.semanticScore ?? 0) * SEMANTIC_WEIGHTS.semantic +
    input.lexicalScore * SEMANTIC_WEIGHTS.lexical +
    input.sameAuthor * SEMANTIC_WEIGHTS.sameAuthor +
    input.samePublisher * SEMANTIC_WEIGHTS.samePublisher
  );
}

function relatedScore(input: {
  readonly semanticScoresByUrl: ReadonlyMap<string, number> | undefined;
  readonly bookmeterUrl: string;
  readonly lexicalScore: number;
  readonly sameAuthor: number;
  readonly samePublisher: number;
}): number {
  const semanticScore = optionalPositive(input.semanticScoresByUrl?.get(input.bookmeterUrl));

  if (!input.semanticScoresByUrl) {
    return (
      input.lexicalScore * LEGACY_WEIGHTS.lexical +
      input.sameAuthor * LEGACY_WEIGHTS.sameAuthor +
      input.samePublisher * LEGACY_WEIGHTS.samePublisher
    );
  }

  return weightedSemanticScore({
    semanticScore,
    lexicalScore: input.lexicalScore,
    sameAuthor: input.sameAuthor,
    samePublisher: input.samePublisher
  });
}

function buildReasons(primary: BookSnapshot, book: BookSnapshot, lexicalScore: number, semanticScore: number | null): readonly string[] {
  const reasons = [
    semanticScore !== null && semanticScore >= 0.65 ? "説明文の意味が近い候補です。" : null,
    primary.author && primary.author === book.author ? "同じ著者です。" : null,
    primary.publisher && primary.publisher === book.publisher ? "同じ出版社です。" : null,
    lexicalScore > 0 ? "タイトルまたは説明文に共通する語があります。" : null,
    book.inStacked ? "積読本に登録されています。" : "読みたい本に登録されています。"
  ];

  return reasons.filter((reason): reason is string => reason !== null);
}

export function findRelatedBooks(input: {
  readonly primary: BookSnapshot | null;
  readonly candidates: readonly BookSnapshot[];
  readonly limit: number;
  readonly semanticScoresByUrl?: ReadonlyMap<string, number>;
}): readonly RelatedBook[] {
  if (!input.primary) {
    return [];
  }

  return input.candidates
    .filter((candidate) => candidate.bookmeterUrl !== input.primary?.bookmeterUrl)
    .map((candidate) => {
      const lexicalScore = lexicalSimilarity(input.primary as BookSnapshot, candidate);
      const sameAuthor = sameAuthorScore(input.primary as BookSnapshot, candidate);
      const samePublisher = samePublisherScore(input.primary as BookSnapshot, candidate);
      const semanticScore = optionalPositive(input.semanticScoresByUrl?.get(candidate.bookmeterUrl));
      const score = relatedScore({
        semanticScoresByUrl: input.semanticScoresByUrl,
        bookmeterUrl: candidate.bookmeterUrl,
        lexicalScore,
        sameAuthor,
        samePublisher
      });

      return {
        ...candidate,
        score,
        reasons: buildReasons(input.primary as BookSnapshot, candidate, lexicalScore, semanticScore)
      };
    })
    .filter((book) => book.score > 0)
    .sort((a, b) => b.score - a.score || a.remoteRank - b.remoteRank)
    .slice(0, input.limit);
}
