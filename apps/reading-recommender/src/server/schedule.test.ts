import { describe, expect, it } from "vitest";

import { computeCurrentOrPreviousScheduledRun, computeDueScheduledRun, computeNextScheduledRun } from "./schedule";
import { DEFAULT_SETTINGS } from "./settings";

describe("recommendation schedule", () => {
  it("computes the next weekly run in the configured timezone", () => {
    expect(computeNextScheduledRun(DEFAULT_SETTINGS, "2026-06-28T12:00:00Z")).toBe("2026-06-28T22:30:00Z");
  });

  it("moves the next run to the following week after the scheduled time passes", () => {
    expect(computeNextScheduledRun(DEFAULT_SETTINGS, "2026-06-28T23:00:00Z")).toBe("2026-07-05T22:30:00Z");
  });

  it("finds the current missed scheduled slot", () => {
    expect(computeCurrentOrPreviousScheduledRun(DEFAULT_SETTINGS, "2026-06-28T23:00:00Z")).toBe("2026-06-28T22:30:00Z");
  });

  it.each([
    { latestScheduledFor: null, expectedDue: "2026-06-28T22:30:00Z" },
    { latestScheduledFor: "2026-06-21T22:30:00Z", expectedDue: "2026-06-28T22:30:00Z" },
    { latestScheduledFor: "2026-06-28T22:30:00Z", expectedDue: null }
  ])(
    "returns $expectedDue when the latest scheduled run is $latestScheduledFor",
    ({ latestScheduledFor, expectedDue }) => {
      expect(
        computeDueScheduledRun({
          settings: DEFAULT_SETTINGS,
          latestScheduledFor,
          now: "2026-06-28T23:00:00Z"
        })
      ).toBe(expectedDue);
    }
  );

  it("uses the configured weekday, time, and timezone for the current, due, and next runs", () => {
    const settings = {
      recommendationDayOfWeek: 0,
      recommendationTime: "09:00",
      timezone: "America/New_York"
    };
    const now = "2026-06-28T14:00:00Z";

    expect(computeCurrentOrPreviousScheduledRun(settings, now)).toBe("2026-06-28T13:00:00Z");
    expect(computeDueScheduledRun({ settings, latestScheduledFor: null, now })).toBe("2026-06-28T13:00:00Z");
    expect(computeNextScheduledRun(settings, now)).toBe("2026-07-05T13:00:00Z");
  });
});
