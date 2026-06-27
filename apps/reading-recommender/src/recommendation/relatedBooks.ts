import type { BookSnapshot, RelatedBook } from "../shared/types";

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

function buildReasons(primary: BookSnapshot, book: BookSnapshot, lexicalScore: number): readonly string[] {
  const reasons = [
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
}): readonly RelatedBook[] {
  if (!input.primary) {
    return [];
  }

  return input.candidates
    .filter((candidate) => candidate.bookmeterUrl !== input.primary?.bookmeterUrl)
    .map((candidate) => {
      const lexicalScore = lexicalSimilarity(input.primary as BookSnapshot, candidate);
      const sameAuthor = input.primary?.author && input.primary.author === candidate.author ? 0.1 : 0;
      const samePublisher = input.primary?.publisher && input.primary.publisher === candidate.publisher ? 0.05 : 0;
      const score = lexicalScore * 0.85 + sameAuthor + samePublisher;

      return {
        ...candidate,
        score,
        reasons: buildReasons(input.primary as BookSnapshot, candidate, lexicalScore)
      };
    })
    .filter((book) => book.score > 0)
    .sort((a, b) => b.score - a.score || a.remoteRank - b.remoteRank)
    .slice(0, input.limit);
}
