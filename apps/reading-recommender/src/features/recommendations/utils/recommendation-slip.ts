const JP_WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const ONE_DAY_MS = 86_400_000;

export function formatSlipDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, "0")} (${JP_WEEKDAYS[date.getDay()]})`;
}

export function nextRecommendationDate(dayOfWeek: number, from: Date): Date {
  const base = Number.isNaN(from.getTime()) ? new Date() : from;
  const delta = ((dayOfWeek - base.getDay() + 6) % 7) + 1;
  return new Date(base.getTime() + delta * ONE_DAY_MS);
}
