import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createDrizzleBookRepository } from "../db/bookRepository";
import { createDbClient } from "../db/client";
import { Ok } from "../libs/lib";
import { fetchKinokuniyaDescription } from "../scrapers/kinokuniya";
import { makeBook, toBookList } from "../testing/books";

import { crawlDescriptionPhase, persistPhase, shouldRunDownstreamPhases } from "./pipeline";

import type { ExecutionPlan } from "./executionMode";
import type { BookRepository } from "../db/bookRepository";
import type { ISBN10 } from "../domain/isbn";
import type * as Kinokuniya from "../scrapers/kinokuniya";
import type { Browser } from "puppeteer";

vi.mock("../scrapers/kinokuniya", async () => {
  const actual = await vi.importActual<typeof Kinokuniya>("../scrapers/kinokuniya");

  return {
    ...actual,
    fetchKinokuniyaDescription: vi.fn()
  };
});

const makeExecutionPlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => {
  return {
    refetch: new Set(),
    ignoreDiff: false,
    target: "stacked",
    userId: "1003258",
    outputFilePath: null,
    modeName: "sync",
    scrape: { type: "remote", doLogin: true },
    phases: {
      compare: true,
      fetchBiblio: true,
      crawlDescriptions: true,
      persist: true,
      exportCsv: true,
      uploadDb: true
    },
    ...overrides
  };
};

const fetchKinokuniyaDescriptionMock = vi.mocked(fetchKinokuniyaDescription);

const createDescriptionTestContext = (
  plan: ExecutionPlan
): {
  browser: Browser;
  repo: BookRepository;
} => {
  const closePage = vi.fn().mockResolvedValue(undefined);
  const newPage = vi.fn().mockResolvedValue({ close: closePage });
  const repo = createDrizzleBookRepository(createDbClient(":memory:"));
  expect(repo.save(new Map(), plan.target)).toEqual(Ok(undefined));

  onTestFinished(() => {
    expect(closePage).toHaveBeenCalledTimes(newPage.mock.calls.length);
  });

  return {
    browser: { newPage } as unknown as Browser,
    repo
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchKinokuniyaDescriptionMock.mockResolvedValue("fetched-description");
});

describe("shouldRunDownstreamPhases", () => {
  it("continues when refetch is enabled even if the list is unchanged", () => {
    const plan = makeExecutionPlan({ refetch: new Set(["holdings"]) });
    const bookList = toBookList([makeBook("same-1"), makeBook("same-2")]);

    expect(shouldRunDownstreamPhases(plan, bookList, bookList)).toBe(true);
  });

  it("continues when ignoreDiff is enabled even if the list is unchanged", () => {
    const plan = makeExecutionPlan({ ignoreDiff: true });
    const bookList = toBookList([makeBook("same-1"), makeBook("same-2")]);

    expect(shouldRunDownstreamPhases(plan, bookList, bookList)).toBe(true);
  });

  it("continues when the remote order differs from the local snapshot", () => {
    const plan = makeExecutionPlan();

    expect(
      shouldRunDownstreamPhases(
        plan,
        toBookList([makeBook("old-1"), makeBook("old-2")]),
        toBookList([makeBook("old-2"), makeBook("old-1")])
      )
    ).toBe(true);
  });

  it("stops when the list is unchanged and neither refetch nor ignoreDiff is set", () => {
    const plan = makeExecutionPlan();
    const bookList = toBookList([makeBook("same-1"), makeBook("same-2")]);

    expect(shouldRunDownstreamPhases(plan, bookList, bookList)).toBe(false);
  });
});

describe("crawlDescriptionPhase", () => {
  it("skips fetching for existing books without cached descriptions in a remote run", async () => {
    const plan = makeExecutionPlan();
    const latestBookList = toBookList([makeBook("existing-book")]);
    const prevBookList = toBookList([makeBook("existing-book")]);
    const { browser, repo } = createDescriptionTestContext(plan);
    expect(repo.save(prevBookList, plan.target)).toEqual(Ok(undefined));

    await crawlDescriptionPhase(plan, latestBookList, prevBookList, repo, browser);

    expect(fetchKinokuniyaDescriptionMock).not.toHaveBeenCalled();
    expect(latestBookList).toEqual(toBookList([makeBook("existing-book")]));
    expect(repo.load(plan.target)).toEqual(Ok(toBookList([makeBook("existing-book")])));
  });

  it("fetches new-book descriptions and saves them in the persist phase", async () => {
    const plan = makeExecutionPlan();
    const latestBookList = toBookList([makeBook("new-book")]);
    const prevBookList = toBookList([makeBook("existing-book", { isbn_or_asin: "0306406152" as ISBN10 })]);
    const { browser, repo } = createDescriptionTestContext(plan);
    expect(repo.save(prevBookList, plan.target)).toEqual(Ok(undefined));

    await crawlDescriptionPhase(plan, latestBookList, prevBookList, repo, browser);

    const expectedBooks = toBookList([makeBook("new-book", { description: "fetched-description" })]);
    expect(latestBookList).toEqual(expectedBooks);
    expect(persistPhase(plan, latestBookList, repo)).toBe(true);
    expect(repo.load(plan.target)).toEqual(Ok(expectedBooks));
  });

  it("reuses cached descriptions without fetching in a remote run", async () => {
    const plan = makeExecutionPlan();
    const latestBookList = toBookList([makeBook("existing-book")]);
    const prevBookList = toBookList([makeBook("existing-book", { description: "cached-description" })]);
    const { browser, repo } = createDescriptionTestContext(plan);
    expect(repo.save(prevBookList, plan.target)).toEqual(Ok(undefined));

    await crawlDescriptionPhase(plan, latestBookList, prevBookList, repo, browser);

    const expectedBooks = toBookList([makeBook("existing-book", { description: "cached-description" })]);
    expect(fetchKinokuniyaDescriptionMock).not.toHaveBeenCalled();
    expect(latestBookList).toEqual(expectedBooks);
    expect(repo.load(plan.target)).toEqual(Ok(expectedBooks));
  });

  it("replaces cached descriptions in the list and database when description refetch is enabled", async () => {
    const plan = makeExecutionPlan({ refetch: new Set(["description"]) });
    const latestBookList = toBookList([makeBook("existing-book")]);
    const prevBookList = toBookList([makeBook("existing-book", { description: "cached-description" })]);
    const { browser, repo } = createDescriptionTestContext(plan);
    expect(repo.save(prevBookList, plan.target)).toEqual(Ok(undefined));

    await crawlDescriptionPhase(plan, latestBookList, prevBookList, repo, browser);

    const expectedBooks = toBookList([makeBook("existing-book", { description: "fetched-description" })]);
    expect(latestBookList).toEqual(expectedBooks);
    expect(repo.load(plan.target)).toEqual(Ok(expectedBooks));
  });

  it("fetches all descriptions without a previous snapshot and saves them in the persist phase", async () => {
    const plan = makeExecutionPlan();
    const latestBookList = toBookList([
      makeBook("first-run-japanese-book"),
      makeBook("first-run-foreign-book", { isbn_or_asin: "0306406152" as ISBN10 })
    ]);
    const { browser, repo } = createDescriptionTestContext(plan);
    fetchKinokuniyaDescriptionMock.mockImplementation((_page, identifier) =>
      Promise.resolve(`description:${identifier}`)
    );

    await crawlDescriptionPhase(plan, latestBookList, null, repo, browser);

    const expectedBooks = toBookList([
      makeBook("first-run-japanese-book", { description: "description:4062938428" }),
      makeBook("first-run-foreign-book", {
        isbn_or_asin: "0306406152" as ISBN10,
        description: "description:0306406152"
      })
    ]);
    expect(latestBookList).toEqual(expectedBooks);
    expect(persistPhase(plan, latestBookList, repo)).toBe(true);
    expect(repo.load(plan.target)).toEqual(Ok(expectedBooks));
  });

  it("fills a missing description for an existing book in a local-cache run", async () => {
    const plan = makeExecutionPlan({ modeName: "custom", scrape: { type: "local-cache" } });
    const latestBookList = toBookList([makeBook("existing-book")]);
    const prevBookList = toBookList([makeBook("existing-book")]);
    const { browser, repo } = createDescriptionTestContext(plan);
    expect(repo.save(prevBookList, plan.target)).toEqual(Ok(undefined));

    await crawlDescriptionPhase(plan, latestBookList, prevBookList, repo, browser);

    const expectedBooks = toBookList([makeBook("existing-book", { description: "fetched-description" })]);
    expect(latestBookList).toEqual(expectedBooks);
    expect(repo.load(plan.target)).toEqual(Ok(expectedBooks));
  });

  it.each([
    { services: ["biblio"] as const },
    { services: ["holdings"] as const },
    { services: ["biblio", "holdings"] as const }
  ])("does not refetch cached descriptions for $services", async ({ services }) => {
    const plan = makeExecutionPlan({ refetch: new Set(services) });
    const latestBookList = toBookList([makeBook("existing-book")]);
    const prevBookList = toBookList([makeBook("existing-book", { description: "cached-description" })]);
    const { browser, repo } = createDescriptionTestContext(plan);
    expect(repo.save(prevBookList, plan.target)).toEqual(Ok(undefined));

    await crawlDescriptionPhase(plan, latestBookList, prevBookList, repo, browser);

    const expectedBooks = toBookList([makeBook("existing-book", { description: "cached-description" })]);
    expect(fetchKinokuniyaDescriptionMock).not.toHaveBeenCalled();
    expect(latestBookList).toEqual(expectedBooks);
    expect(repo.load(plan.target)).toEqual(Ok(expectedBooks));
  });

  it("updates only the list when persistence is disabled", async () => {
    const syncPlan = makeExecutionPlan({ refetch: new Set(["description"]) });
    const plan = { ...syncPlan, phases: { ...syncPlan.phases, persist: false } };
    const latestBookList = toBookList([makeBook("existing-book")]);
    const prevBookList = toBookList([makeBook("existing-book", { description: "cached-description" })]);
    const { browser, repo } = createDescriptionTestContext(plan);
    expect(repo.save(prevBookList, plan.target)).toEqual(Ok(undefined));

    await crawlDescriptionPhase(plan, latestBookList, prevBookList, repo, browser);

    expect(latestBookList).toEqual(toBookList([makeBook("existing-book", { description: "fetched-description" })]));
    expect(repo.load(plan.target)).toEqual(
      Ok(toBookList([makeBook("existing-book", { description: "cached-description" })]))
    );
  });
});
