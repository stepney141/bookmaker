import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createApiServer } from "./api";
import { createReadingRecommenderService } from "./service";
import { openTestAppDb } from "./testing/appDb";
import { wishBook } from "./testing/books";
import { createSourceDb } from "./testing/sourceDb";

import type { LearningPathPlanner } from "./learningPath/types";
import type { SourceBookLists } from "./testing/sourceDb";
import type { CurrentRecommendation, LearningPathPlannerInfo, SearchResult } from "../types/api";
import type { FastifyInstance } from "fastify";

async function createTestApi(input: {
  readonly books: SourceBookLists;
  readonly planners?: readonly LearningPathPlanner[];
}): Promise<FastifyInstance> {
  const directory = mkdtempSync(join(tmpdir(), "reading-api-test-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const booksDbPath = join(directory, "books.sqlite");
  createSourceDb(booksDbPath, input.books);
  const service = createReadingRecommenderService({
    appDb: openTestAppDb(),
    booksDbPath,
    learningPathPlanners: input.planners
  });
  const app = await createApiServer(service);
  onTestFinished(() => app.close());
  return app;
}

const studyBookRow = {
  bookmeter_url: "https://bookmeter.com/books/category-theory",
  book_title: "圏論入門",
  author: "著者",
  publisher: "出版社",
  published_date: "2025",
  description: "圏と関手を解説します。",
  exist_in_utokyo: "Yes",
  utokyo_opac: "https://example.com/opac/category-theory"
};

const studyBooks: SourceBookLists = { wish: [studyBookRow], stacked: [] };

const anthropicInfo: LearningPathPlannerInfo = {
  id: "anthropic",
  label: "Claude",
  modelId: "configured-anthropic-model"
};
const openaiInfo: LearningPathPlannerInfo = {
  id: "openai",
  label: "OpenAI",
  modelId: "configured-openai-model"
};

function createPlanner(info: LearningPathPlannerInfo): LearningPathPlanner {
  return {
    ...info,
    plan: ({ candidates }) =>
      Promise.resolve({
        modelId: "actual-response-model",
        output: {
          overview: "入門書から定義を学びます。",
          stages: [
            {
              title: "入門",
              goal: "関手を理解する",
              books: candidates.map(({ id }) => ({ id, reason: "基礎概念を順に学べます。" }))
            }
          ],
          gaps: ["発展的な内容を扱う本がありません。"]
        }
      })
  };
}

const recommendationBooks: SourceBookLists = {
  stacked: [
    { bookmeter_url: "https://bookmeter.com/books/algebra", book_title: "代数学" },
    { bookmeter_url: "https://bookmeter.com/books/history", book_title: "日本史" },
    { bookmeter_url: "https://bookmeter.com/books/language", book_title: "言語学" }
  ],
  wish: [{ bookmeter_url: "https://bookmeter.com/books/random-candidate", book_title: "科学の歴史" }]
};

const searchBooks: SourceBookLists = {
  wish: [
    { bookmeter_url: "https://bookmeter.com/books/wish-utokyo", book_title: "暗号理論", exist_in_utokyo: "Yes" },
    { bookmeter_url: "https://bookmeter.com/books/wish-other", book_title: "暗号技術", exist_in_utokyo: "No" }
  ],
  stacked: [
    { bookmeter_url: "https://bookmeter.com/books/stacked-other", book_title: "暗号入門", exist_in_utokyo: "No" },
    { bookmeter_url: "https://bookmeter.com/books/stacked-utokyo", book_title: "暗号実践", exist_in_utokyo: "Yes" }
  ]
};

const twelveMatchingBooks: SourceBookLists = {
  wish: Array.from({ length: 12 }, (_, index) => ({
    bookmeter_url: `https://bookmeter.com/books/cryptography-${index + 1}`,
    book_title: `暗号資料 ${index + 1}`
  })),
  stacked: []
};

describe("search API", () => {
  it("uses the configured search result count when limit is omitted", async () => {
    const app = await createTestApi({ books: twelveMatchingBooks });

    const response = await app.inject({ method: "GET", url: "/api/search?q=暗号" });

    expect(response.statusCode).toBe(200);
    const results = response.json<readonly SearchResult[]>();
    expect(results).toHaveLength(10);
    expect(new Set(results.map((book) => book.bookmeterUrl)).size).toBe(10);
    expect(twelveMatchingBooks.wish.map((book) => book.bookmeter_url)).toEqual(
      expect.arrayContaining(results.map((book) => book.bookmeterUrl))
    );
  });

  it("returns all 12 matching books with limit 100", async () => {
    const app = await createTestApi({ books: twelveMatchingBooks });

    const response = await app.inject({ method: "GET", url: "/api/search?q=暗号&limit=100" });

    expect(response.statusCode).toBe(200);
    const results = response.json<readonly SearchResult[]>();
    expect(results).toHaveLength(12);
    expect(new Set(results.map((book) => book.bookmeterUrl))).toEqual(
      new Set(twelveMatchingBooks.wish.map((book) => book.bookmeter_url))
    );
  });

  it.each(["101", "0", "1.5", "abc"])("rejects invalid search limit %s", async (limit) => {
    const app = await createTestApi({ books: twelveMatchingBooks });

    const response = await app.inject({ method: "GET", url: `/api/search?q=暗号&limit=${limit}` });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_request" });
  });

  it.each([
    {
      query: "list=stacked",
      urls: ["https://bookmeter.com/books/stacked-other", "https://bookmeter.com/books/stacked-utokyo"]
    },
    {
      query: "library=utokyo",
      urls: ["https://bookmeter.com/books/wish-utokyo", "https://bookmeter.com/books/stacked-utokyo"]
    }
  ])("returns only books matching $query", async ({ query, urls }) => {
    const app = await createTestApi({ books: searchBooks });

    const response = await app.inject({ method: "GET", url: `/api/search?q=暗号&${query}` });

    expect(response.statusCode).toBe(200);
    const results = response.json<readonly SearchResult[]>();
    expect(results).toHaveLength(2);
    expect(new Set(results.map((book) => book.bookmeterUrl))).toEqual(new Set(urls));
  });

  it.each(["list=bogus", "library=invalid", "list=wish,bogus", "library=utokyo,invalid"])(
    "rejects unknown filter values in %s",
    async (query) => {
      const app = await createTestApi({ books: searchBooks });

      const response = await app.inject({ method: "GET", url: `/api/search?q=暗号&${query}` });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_request" });
    }
  );
});

describe("recommendation API", () => {
  it("returns the only eligible random candidate as the new primary", async () => {
    const app = await createTestApi({ books: recommendationBooks });

    const response = await app.inject({ method: "POST", url: "/api/recommendations/random" });

    expect(response.statusCode).toBe(200);
    expect(response.json<CurrentRecommendation>()).toMatchObject({
      primary: { bookmeterUrl: "https://bookmeter.com/books/random-candidate" }
    });
  });

  it("returns a conflict when every book is already recommended", async () => {
    const app = await createTestApi({ books: { stacked: recommendationBooks.stacked, wish: [] } });

    const response = await app.inject({ method: "POST", url: "/api/recommendations/random" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "no_random_candidate" });
  });

  it("returns the requested book as the primary after promotion", async () => {
    const app = await createTestApi({ books: recommendationBooks });
    await app.inject({ method: "POST", url: "/api/recommendations/run" });

    const response = await app.inject({
      method: "POST",
      url: "/api/recommendations/promote",
      payload: { bookmeterUrl: "https://bookmeter.com/books/algebra" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<CurrentRecommendation>()).toMatchObject({
      primary: { bookmeterUrl: "https://bookmeter.com/books/algebra" }
    });
  });

  it.each([{}, { bookmeterUrl: "" }, { bookmeterUrl: 1 }])("rejects an invalid promotion body: %j", async (payload) => {
    const app = await createTestApi({ books: recommendationBooks });

    const response = await app.inject({ method: "POST", url: "/api/recommendations/promote", payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("learning path API", () => {
  it("lists planner metadata in configured order", async () => {
    const app = await createTestApi({
      books: studyBooks,
      planners: [createPlanner(openaiInfo), createPlanner(anthropicInfo)]
    });

    const response = await app.inject({ method: "GET", url: "/api/learning-paths/planners" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([openaiInfo, anthropicInfo]);
  });

  it("returns the generated path with book reasons and the actual response model", async () => {
    const app = await createTestApi({ books: studyBooks, planners: [createPlanner(anthropicInfo)] });

    const response = await app.inject({
      method: "POST",
      url: "/api/learning-paths",
      payload: { topic: "圏論", planner: "anthropic" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      topic: "圏論",
      overview: "入門書から定義を学びます。",
      stages: [
        {
          title: "入門",
          goal: "関手を理解する",
          books: [
            {
              ...wishBook({
                bookmeterUrl: "https://bookmeter.com/books/category-theory",
                title: "圏論入門",
                author: "著者",
                publisher: "出版社",
                publishedDate: "2025",
                description: "圏と関手を解説します。",
                utokyoLibraryStatus: "available",
                utokyoOpacUrl: "https://example.com/opac/category-theory",
                remoteRank: 1
              }),
              reason: "基礎概念を順に学べます。"
            }
          ]
        }
      ],
      gaps: ["発展的な内容を扱う本がありません。"],
      planner: { id: "anthropic", label: "Claude", modelId: "actual-response-model" }
    });
  });

  it.each([
    {},
    { topic: "", planner: "anthropic" },
    { topic: "   ", planner: "anthropic" },
    { topic: "圏".repeat(201), planner: "anthropic" },
    { topic: 1, planner: "anthropic" },
    { topic: "圏論" },
    { topic: "圏論", planner: "unknown" }
  ])("rejects invalid bodies with 400: %j", async (payload) => {
    const app = await createTestApi({ books: studyBooks, planners: [createPlanner(anthropicInfo)] });

    const response = await app.inject({ method: "POST", url: "/api/learning-paths", payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_request" });
  });

  it.each([1, 200])("accepts a topic with %i characters and the OpenAI planner", async (length) => {
    const topic = "圏".repeat(length);
    const app = await createTestApi({
      books: { wish: [{ ...studyBookRow, book_title: topic }], stacked: [] },
      planners: [createPlanner(openaiInfo)]
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/learning-paths",
      payload: { topic, planner: "openai" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      topic,
      planner: { id: "openai", label: "OpenAI", modelId: "actual-response-model" },
      stages: [{ books: [{ bookmeterUrl: "https://bookmeter.com/books/category-theory", title: topic }] }]
    });
  });

  it("returns a conflict when the requested planner is unavailable", async () => {
    const app = await createTestApi({ books: studyBooks, planners: [createPlanner(openaiInfo)] });

    const response = await app.inject({
      method: "POST",
      url: "/api/learning-paths",
      payload: { topic: "圏論", planner: "anthropic" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "planner_unavailable" });
  });

  it("returns a conflict when there are no candidate books", async () => {
    const app = await createTestApi({ books: { wish: [], stacked: [] }, planners: [createPlanner(anthropicInfo)] });

    const response = await app.inject({
      method: "POST",
      url: "/api/learning-paths",
      payload: { topic: "圏論", planner: "anthropic" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "no_candidates" });
  });

  it("logs the provider cause and returns only the error code with 502", async () => {
    const cause = new Error("private provider response");
    const app = await createTestApi({
      books: studyBooks,
      planners: [{ ...createPlanner(anthropicInfo), plan: () => Promise.reject(cause) }]
    });
    const logError = vi.fn<(...args: readonly unknown[]) => void>();
    app.addHook("onRequest", (request, _reply, done) => {
      const spy = vi.spyOn(request.log, "error").mockImplementation(logError);
      onTestFinished(() => spy.mockRestore());
      done();
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/learning-paths",
      payload: { topic: "圏論", planner: "anthropic" }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "planner_failed" });
    expect(logError.mock.calls.flat()).toContainEqual(expect.objectContaining({ err: cause }));
  });
});
