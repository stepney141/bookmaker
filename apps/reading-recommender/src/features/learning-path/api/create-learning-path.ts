import { requestJson } from "@/lib/api-client";

import type { LearningPath, LearningPathPlannerId } from "@/types/api";

export function createLearningPath(topic: string, planner: LearningPathPlannerId): Promise<LearningPath> {
  return requestJson<LearningPath>("/api/learning-paths", {
    method: "POST",
    body: JSON.stringify({ topic, planner })
  });
}
