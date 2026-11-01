import { requestJson } from "@/lib/api-client";

import type { LearningPathPlannerInfo } from "@/types/api";

export function fetchLearningPathPlanners(): Promise<readonly LearningPathPlannerInfo[]> {
  return requestJson<readonly LearningPathPlannerInfo[]>("/api/learning-paths/planners");
}
