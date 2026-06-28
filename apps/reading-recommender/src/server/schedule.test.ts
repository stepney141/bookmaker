import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { computeCurrentOrPreviousScheduledRun, computeDueScheduledRun, computeNextScheduledRun } from "./schedule";

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

  it("does not mark a scheduled slot due twice", () => {
    expect(
      computeDueScheduledRun({
        settings: DEFAULT_SETTINGS,
        latestScheduledFor: "2026-06-28T22:30:00Z",
        now: "2026-06-28T23:00:00Z"
      })
    ).toBeNull();
  });
});
