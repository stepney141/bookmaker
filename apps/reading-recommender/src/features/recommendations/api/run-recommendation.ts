import { requestJson } from "@/lib/api-client";

import type { CurrentRecommendation } from "@/types/api";

export function runRecommendation(): Promise<CurrentRecommendation | null> {
  return requestJson<CurrentRecommendation | null>("/api/recommendations/run", { method: "POST" });
}
