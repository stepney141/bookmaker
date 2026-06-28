import { Temporal as PolyfillTemporal } from "temporal-polyfill-lite";

import type { AppSettings } from "../shared/types";

type TemporalApi = typeof PolyfillTemporal;
type GlobalWithTemporal = typeof globalThis & {
  readonly Temporal?: TemporalApi;
};

type ScheduleSettings = Pick<AppSettings, "recommendationDayOfWeek" | "recommendationTime" | "timezone">;

function getTemporal(): TemporalApi {
  return (globalThis as GlobalWithTemporal).Temporal ?? PolyfillTemporal;
}

function nowIso(): string {
  return getTemporal().Now.instant().toString();
}

function parseRecommendationTime(time: string): {
  readonly hour: number;
  readonly minute: number;
} {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid recommendation time: ${time}`);
  }

  return { hour, minute };
}

function toTemporalDayOfWeek(dayOfWeek: number): number {
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

function scheduledZonedDateTime(input: {
  readonly settings: ScheduleSettings;
  readonly nowIso?: string;
  readonly direction: "next" | "current_or_previous";
}): ReturnType<TemporalApi["Now"]["zonedDateTimeISO"]> {
  const Temporal = getTemporal();
  const now = Temporal.Instant.from(input.nowIso ?? nowIso()).toZonedDateTimeISO(input.settings.timezone);
  const targetDayOfWeek = toTemporalDayOfWeek(input.settings.recommendationDayOfWeek);
  const { hour, minute } = parseRecommendationTime(input.settings.recommendationTime);
  const plainTime = Temporal.PlainTime.from({ hour, minute });

  if (input.direction === "next") {
    const daysUntil = (targetDayOfWeek - now.dayOfWeek + 7) % 7;
    let scheduled = now.toPlainDate().add({ days: daysUntil }).toZonedDateTime({
      timeZone: input.settings.timezone,
      plainTime
    });

    if (Temporal.ZonedDateTime.compare(scheduled, now) <= 0) {
      scheduled = scheduled.add({ weeks: 1 });
    }
    return scheduled;
  }

  const daysSince = (now.dayOfWeek - targetDayOfWeek + 7) % 7;
  let scheduled = now.toPlainDate().subtract({ days: daysSince }).toZonedDateTime({
    timeZone: input.settings.timezone,
    plainTime
  });

  if (Temporal.ZonedDateTime.compare(scheduled, now) > 0) {
    scheduled = scheduled.subtract({ weeks: 1 });
  }
  return scheduled;
}

function toInstantIso(zonedDateTime: ReturnType<TemporalApi["Now"]["zonedDateTimeISO"]>): string {
  return zonedDateTime.toInstant().toString();
}

export function computeNextScheduledRun(settings: ScheduleSettings, now?: string): string {
  return toInstantIso(scheduledZonedDateTime({ settings, nowIso: now, direction: "next" }));
}

export function computeCurrentOrPreviousScheduledRun(settings: ScheduleSettings, now?: string): string {
  return toInstantIso(scheduledZonedDateTime({ settings, nowIso: now, direction: "current_or_previous" }));
}

export function computeDueScheduledRun(input: {
  readonly settings: ScheduleSettings;
  readonly latestScheduledFor: string | null;
  readonly now?: string;
}): string | null {
  const Temporal = getTemporal();
  const scheduledFor = computeCurrentOrPreviousScheduledRun(input.settings, input.now);

  if (
    input.latestScheduledFor &&
    Temporal.Instant.compare(Temporal.Instant.from(input.latestScheduledFor), Temporal.Instant.from(scheduledFor)) >= 0
  ) {
    return null;
  }

  return scheduledFor;
}
