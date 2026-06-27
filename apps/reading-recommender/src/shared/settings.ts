import type { AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  recommendationDayOfWeek: 1,
  recommendationTime: "07:30",
  timezone: "Asia/Tokyo",
  primaryCount: 1,
  secondaryCount: 2,
  relatedCount: 5,
  searchResultCount: 10,
  remoteOrderAgeDirection: "larger_is_older"
};
