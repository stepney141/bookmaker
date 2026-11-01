import { requestJson } from "@/lib/api-client";

import type { CurrentRecommendation } from "@/types/api";

export function randomizeRecommendation(): Promise<CurrentRecommendation> {
  return requestJson<CurrentRecommendation>("/api/recommendations/random", { method: "POST" });
}
