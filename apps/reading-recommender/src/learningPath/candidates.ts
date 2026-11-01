import type { BookSnapshot } from "../shared/types";

export function mergeLearningPathCandidates(input: {
  readonly lexical: readonly BookSnapshot[];
  readonly semantic: readonly { readonly book: BookSnapshot; readonly score: number }[];
  readonly limit: number;
}): readonly BookSnapshot[] {
  const seen = new Set<string>();
  const semantic = input.semantic.toSorted((left, right) => right.score - left.score).map(({ book }) => book);

  return [...input.lexical, ...semantic]
    .filter((book) => {
      if (seen.has(book.bookmeterUrl)) {
        return false;
      }

      seen.add(book.bookmeterUrl);
      return true;
    })
    .slice(0, input.limit);
}
