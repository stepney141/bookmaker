import { describe, expect, it } from "vitest";

import { parseCliArgs, resolveExecutionPlan } from "./executionMode";

const unwrapOk = <T>(result: { ok: true; value: T } | { ok: false; err: Error }): T => {
  if (result.ok) {
    return result.value;
  }

  expect.fail(result.err.message);
};

describe("resolveExecutionPlan", () => {
  it("resolves scrape with no downstream phases", () => {
    const plan = unwrapOk(
      resolveExecutionPlan({
        target: "wish",
        execution: { type: "scrape" }
      })
    );

    expect(plan.modeName).toBe("scrape");
    expect(plan.refetch).toBe(false);
    expect(plan.ignoreDiff).toBe(false);
    expect(plan.scrape).toEqual({ type: "remote", doLogin: true });
    expect(plan.phases.compare).toBe(false);
    expect(plan.phases.fetchBiblio).toBe(false);
    expect(plan.phases.crawlDescriptions).toBe(false);
    expect(plan.phases.persist).toBe(false);
    expect(plan.phases.exportCsv).toBe(false);
    expect(plan.phases.uploadDb).toBe(false);
  });

  it("resolves the export phase set as a local-cache pipeline", () => {
    const plan = unwrapOk(
      resolveExecutionPlan({
        target: "wish",
        execution: {
          type: "custom",
          scrape: { type: "local-cache" },
          enabledPhases: ["persist", "exportCsv", "uploadDb"]
        }
      })
    );

    expect(plan.modeName).toBe("custom");
    expect(plan.refetch).toBe(false);
    expect(plan.ignoreDiff).toBe(false);
    expect(plan.scrape).toEqual({ type: "local-cache" });
    expect(plan.phases.compare).toBe(false);
    expect(plan.phases.fetchBiblio).toBe(false);
    expect(plan.phases.crawlDescriptions).toBe(false);
    expect(plan.phases.persist).toBe(true);
    expect(plan.phases.exportCsv).toBe(true);
    expect(plan.phases.uploadDb).toBe(true);
  });

  it("rejects custom upload without persistence", () => {
    const result = resolveExecutionPlan({
      target: "wish",
      execution: {
        type: "custom",
        scrape: { type: "remote", doLogin: true },
        enabledPhases: ["uploadDb"]
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      expect.fail("resolveExecutionPlan should reject uploadDb without persist");
    }

    expect(result.err.context.detail).toBe("Custom execution mode with uploadDb requires persist");
  });
});

describe("parseCliArgs", () => {
  it("parses a named execution mode", () => {
    expect(unwrapOk(parseCliArgs(["node", "bookmeter", "scrape", "stacked"]))).toEqual({
      type: "run",
      option: {
        refetch: false,
        ignoreDiff: false,
        target: "stacked",
        execution: { type: "scrape", doLogin: true }
      }
    });
  });

  it("parses subcommand flags into execution options", () => {
    expect(
      unwrapOk(
        parseCliArgs(["node", "bookmeter", "sync", "wish", "--user-id", "42", "--no-login", "--refetch", "--ignore-diff"])
      )
    ).toEqual({
      type: "run",
      option: {
        refetch: true,
        ignoreDiff: true,
        target: "wish",
        userId: "42",
        execution: { type: "sync", doLogin: false }
      }
    });
  });

  it("rejects --refetch on subcommands that do not define it", () => {
    const result = parseCliArgs(["node", "bookmeter", "export", "wish", "--refetch"]);

    expect(result.ok).toBe(false);
  });

  it("maps export to the local-cache downstream pipeline", () => {
    expect(unwrapOk(parseCliArgs(["node", "bookmeter", "export", "wish"]))).toEqual({
      type: "run",
      option: {
        refetch: false,
        ignoreDiff: false,
        target: "wish",
        execution: {
          type: "custom",
          scrape: { type: "local-cache" },
          enabledPhases: ["persist", "exportCsv", "uploadDb"]
        }
      }
    });
  });

  it("maps enrich to the local-cache API enrichment pipeline", () => {
    expect(unwrapOk(parseCliArgs(["node", "bookmeter", "enrich", "wish", "--refetch"]))).toEqual({
      type: "run",
      option: {
        refetch: true,
        ignoreDiff: false,
        target: "wish",
        execution: {
          type: "custom",
          scrape: { type: "local-cache" },
          enabledPhases: ["fetchBiblio", "persist", "exportCsv", "uploadDb"]
        }
      }
    });
  });

  it("returns help without scheduling execution", () => {
    expect(unwrapOk(parseCliArgs(["node", "bookmeter", "sync", "--help"]))).toEqual({
      type: "help"
    });
  });
});
