import { requestJson } from "@/lib/api-client";

import type { AppSettings } from "@/types/api";

export function fetchSettings(): Promise<AppSettings> {
  return requestJson<AppSettings>("/api/settings");
}
