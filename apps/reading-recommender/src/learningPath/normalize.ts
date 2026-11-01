import type { LearningPathCandidate, PlannerOutput } from "./types";
import type { LearningPath, LearningPathPlannerInfo } from "../shared/types";

export function normalizeLearningPath(input: {
  readonly topic: string;
  readonly planner: LearningPathPlannerInfo;
  readonly candidates: readonly LearningPathCandidate[];
  readonly output: PlannerOutput;
}): LearningPath {
  const booksById = new Map(input.candidates.map(({ id, book }) => [id, book]));
  const seen = new Set<string>();
  const stages = input.output.stages
    .map((stage) => ({
      title: stage.title,
      goal: stage.goal,
      books: stage.books.flatMap(({ id, reason }) => {
        const book = booksById.get(id);
        if (!book || seen.has(book.bookmeterUrl)) {
          return [];
        }

        seen.add(book.bookmeterUrl);
        return [{ ...book, reason }];
      })
    }))
    .filter((stage) => stage.books.length > 0);

  return {
    topic: input.topic,
    overview: input.output.overview,
    stages,
    gaps: input.output.gaps,
    planner: input.planner
  };
}
