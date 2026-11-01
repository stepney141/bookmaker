import { requestJson } from "@/lib/api-client";

import type { CurrentRecommendation } from "@/types/api";

export function promoteRecommendation(bookmeterUrl: string): Promise<CurrentRecommendation | null> {
  return requestJson<CurrentRecommendation | null>("/api/recommendations/promote", {
    method: "POST",
    body: JSON.stringify({ bookmeterUrl })
  });
}
