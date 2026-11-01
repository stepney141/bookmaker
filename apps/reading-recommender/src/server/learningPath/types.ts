import type { PlannerOutput } from "./schema";
import type { BookSnapshot, LearningPathPlannerInfo } from "../../types/api";

export type { PlannerOutput } from "./schema";

export type LearningPathCandidate = {
  readonly id: string;
  readonly book: BookSnapshot;
};

export type LearningPathPlanRequest = {
  readonly topic: string;
  readonly candidates: readonly LearningPathCandidate[];
};

export type LearningPathPlanResult = {
  readonly output: PlannerOutput;
  readonly modelId: string;
};

export interface LearningPathPlanner extends LearningPathPlannerInfo {
  readonly plan: (request: LearningPathPlanRequest) => Promise<LearningPathPlanResult>;
}
