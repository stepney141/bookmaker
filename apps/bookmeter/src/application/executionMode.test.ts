import { describe, expect, it } from "vitest";

import { needsBrowser, parseCliArgs, resolveExecutionPlan } from "./executionMode";

const unwrapOk = <T>(result: { ok: true; value: T } | { ok: false; err: Error }): T => {
  if (result.ok) {
    return result.value;
  }

  expect.fail(result.err.message);
};

describe("resolveExecutionPlan", () => {
  // Expected phases come from the execution-mode table in apps/bookmeter/README.md.
  it.each([
    {
      mode: "sync",
      scrape: { type: "remote", doLogin: true },
      phases: {
        compare: true,
        fetchBiblio: true,
        crawlDescriptions: true,
        persist: true,
        exportCsv: true,
        uploadDb: true
      }
    },
    {
      mode: "scrape",
      scrape: { type: "remote", doLogin: true },
      phases: {
        compare: false,
        fetchBiblio: false,
        crawlDescriptions: false,
        persist: false,
        exportCsv: false,
        uploadDb: false
      }
    },
    {
      mode: "export",
      scrape: { type: "local-cache" },
      phases: {
        compare: false,
        fetchBiblio: false,
        crawlDescriptions: false,
        persist: true,
        exportCsv: true,
        uploadDb: true
      }
    },
    {
      mode: "enrich",
      scrape: { type: "local-cache" },
      phases: {
        compare: false,
        fetchBiblio: true,
        crawlDescriptions: true,
        persist: true,
        exportCsv: true,
        uploadDb: true
      }
    }
  ])("resolves the documented scrape source and phases for $mode", ({ mode, scrape, phases }) => {
    const parsed = unwrapOk(parseCliArgs(["node", "bookmeter", mode, "wish"]));
    if (parsed.type === "help") {
      expect.fail(`${mode} should produce a run command`);
    }

    const plan = unwrapOk(resolveExecutionPlan(parsed.option));

    expect(plan.refetch).toEqual(new Set());
    expect(plan.ignoreDiff).toBe(false);
    expect(plan.scrape).toEqual(scrape);
    expect(plan.phases).toEqual(phases);
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

  it("resolves selected refetch services as a set", () => {
    const plan = unwrapOk(
      resolveExecutionPlan({
        target: "wish",
        refetch: ["biblio"],
        execution: { type: "sync" }
      })
    );

    expect(plan.refetch).toEqual(new Set(["biblio"]));
  });
});

describe("parseCliArgs", () => {
  it("parses a named execution mode", () => {
    expect(unwrapOk(parseCliArgs(["node", "bookmeter", "scrape", "stacked"]))).toEqual({
      type: "run",
      option: {
        refetch: [],
        ignoreDiff: false,
        target: "stacked",
        execution: { type: "scrape", doLogin: true }
      }
    });
  });

  it("parses subcommand flags into execution options", () => {
    expect(
      unwrapOk(
        parseCliArgs([
          "node",
          "bookmeter",
          "sync",
          "wish",
          "--user-id",
          "42",
          "--no-login",
          "--refetch",
          "--ignore-diff"
        ])
      )
    ).toEqual({
      type: "run",
      option: {
        refetch: ["biblio", "holdings", "description"],
        ignoreDiff: true,
        target: "wish",
        userId: "42",
        execution: { type: "sync", doLogin: false }
      }
    });
  });

  it.each(["export", "scrape"])("rejects --refetch on %s", (mode) => {
    const result = parseCliArgs(["node", "bookmeter", mode, "wish", "--refetch"]);

    if (result.ok) {
      expect.fail(`${mode} should reject --refetch`);
    }

    expect(result.err.context.type).toBe("invalidCliArgs");
    expect(result.err.context.detail).toMatch(/refetch/);
  });

  it.each([{ services: ["biblio"] }, { services: ["biblio", "holdings"] }])(
    "parses selected refetch services $services",
    ({ services }) => {
      const result = unwrapOk(parseCliArgs(["node", "bookmeter", "sync", "wish", "--refetch", ...services]));

      if (result.type === "help") {
        expect.fail("sync should produce a run command");
      }

      expect(result.option.refetch).toEqual(services);
    }
  );

  it("rejects an unknown refetch service", () => {
    const result = parseCliArgs(["node", "bookmeter", "sync", "wish", "--refetch", "bogus"]);

    if (result.ok) {
      expect.fail("sync should reject the unknown refetch service");
    }

    expect(result.err.context.type).toBe("invalidCliArgs");
    expect(result.err.context.detail).toMatch(/bogus/);
  });

  it("refetches all services in enrich when no service names are supplied", () => {
    const parsed = unwrapOk(parseCliArgs(["node", "bookmeter", "enrich", "wish", "--refetch"]));
    if (parsed.type === "help") {
      expect.fail("enrich should produce a run command");
    }

    expect(unwrapOk(resolveExecutionPlan(parsed.option)).refetch).toEqual(
      new Set(["biblio", "holdings", "description"])
    );
  });

  it("makes the enrich plan browser-backed for description completion", () => {
    const parsed = unwrapOk(parseCliArgs(["node", "bookmeter", "enrich", "wish"]));
    if (parsed.type === "help") {
      expect.fail("enrich should produce a run command");
    }

    const plan = unwrapOk(resolveExecutionPlan(parsed.option));

    expect(plan.phases.crawlDescriptions).toBe(true);
    expect(needsBrowser(plan)).toBe(true);
  });

  it("returns help without scheduling execution", () => {
    expect(unwrapOk(parseCliArgs(["node", "bookmeter", "sync", "--help"]))).toEqual({
      type: "help"
    });
  });
});
