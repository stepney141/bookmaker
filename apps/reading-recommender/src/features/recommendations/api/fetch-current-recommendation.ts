import { requestJson } from "@/lib/api-client";

import type { CurrentRecommendation } from "@/types/api";

export function fetchCurrentRecommendation(): Promise<CurrentRecommendation | null> {
  return requestJson<CurrentRecommendation | null>("/api/recommendations/current");
}
