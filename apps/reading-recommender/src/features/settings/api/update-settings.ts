import { requestJson } from "@/lib/api-client";

import type { AppSettings } from "@/types/api";

export function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(settings)
  });
}
