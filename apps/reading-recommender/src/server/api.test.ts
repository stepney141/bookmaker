import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { createApiServer } from "./api";

import type { ReadingRecommenderService } from "./service";
import type { LearningPath } from "../shared/types";

const learningPath: LearningPath = {
  topic: "圏論",
  overview: "入門書から定義を学びます。",
  stages: [
    {
      title: "入門",
      goal: "関手を理解する",
      books: [
        {
          bookmeterUrl: "https://bookmeter.com/books/1",
          isbnOrAsin: null,
          title: "圏論入門",
          author: "著者",
          publisher: "出版社",
          publishedDate: "2025",
          description: "圏と関手を解説します。",
          inWish: true,
          inStacked: false,
          sophiaLibraryStatus: "unknown",
          utokyoLibraryStatus: "available",
          sophiaOpacUrl: "",
          utokyoOpacUrl: "https://example.com/opac/1",
          wishRowid: 1,
          stackedRowid: null,
          remoteRank: 1,
          remoteRankSource: "wish",
          reason: "基礎概念を順に学べます。"
        }
      ]
    }
  ],
  gaps: ["発展的な内容を扱う本がありません。"],
  planner: { id: "anthropic", label: "Claude", modelId: "actual-model" }
};

function createService(): {
  readonly service: ReadingRecommenderService;
  readonly randomize: ReturnType<typeof vi.fn<ReadingRecommenderService["randomize"]>>;
  readonly search: ReturnType<typeof vi.fn<ReadingRecommenderService["search"]>>;
  readonly createLearningPath: ReturnType<typeof vi.fn<ReadingRecommenderService["createLearningPath"]>>;
  readonly listLearningPathPlanners: ReturnType<typeof vi.fn<ReadingRecommenderService["listLearningPathPlanners"]>>;
} {
  const randomize = vi.fn<ReadingRecommenderService["randomize"]>(() =>
    Promise.resolve({ status: "no_random_candidate" })
  );
  const search = vi.fn<ReadingRecommenderService["search"]>(() => Promise.resolve([]));
  const createLearningPath = vi.fn<ReadingRecommenderService["createLearningPath"]>(() =>
    Promise.resolve({ status: "created", learningPath })
  );
  const listLearningPathPlanners = vi.fn<ReadingRecommenderService["listLearningPathPlanners"]>(() => [
    { id: "anthropic", label: "Claude", modelId: "configured-model" },
    { id: "openai", label: "OpenAI", modelId: "configured-openai-model" }
  ]);

  return {
    randomize,
    search,
    createLearningPath,
    listLearningPathPlanners,
    service: {
      run: () => Promise.resolve(null),
      runScheduled: () => Promise.resolve(null),
      runIfSourceChanged: () => Promise.resolve({ changed: false, current: null }),
      current: () => Promise.resolve(null),
      randomize,
      promote: () => Promise.resolve(null),
      search,
      createLearningPath,
      listLearningPathPlanners,
      diagnostics: () => [],
      getSettings: () => DEFAULT_SETTINGS,
      getLatestScheduledFor: () => null,
      updateSettings: (settings) => settings,
      onSettingsChanged: () => () => {},
      onClose: () => () => {},
      close() {}
    }
  };
}

describe("search API", () => {
  it("returns the updated recommendation after random selection", async () => {
    const { service, randomize } = createService();
    randomize.mockResolvedValue({
      status: "selected",
      current: {
        cycleId: 7,
        status: "active",
        reason: "scheduled",
        createdAt: "2026-07-20T00:00:00.000Z",
        primary: null,
        secondaries: [],
        relatedBooks: []
      }
    });
    const app = await createApiServer(service);

    try {
      const response = await app.inject({ method: "POST", url: "/api/recommendations/random" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ cycleId: 7, reason: "scheduled" });
    } finally {
      await app.close();
    }
  });

  it("returns a conflict when no random candidate is available", async () => {
    const { service } = createService();
    const app = await createApiServer(service);

    try {
      const response = await app.inject({ method: "POST", url: "/api/recommendations/random" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "no_random_candidate" });
    } finally {
      await app.close();
    }
  });

  it("accepts a search limit up to 100", async () => {
    const { service, search } = createService();
    const app = await createApiServer(service);

    try {
      await app.inject({ method: "GET", url: "/api/search?q=%E6%9A%97%E5%8F%B7&limit=100" });

      expect(search).toHaveBeenCalledWith("暗号", 100);
    } finally {
      await app.close();
    }
  });

  it("ignores a search limit above 100", async () => {
    const { service, search } = createService();
    const app = await createApiServer(service);

    try {
      await app.inject({ method: "GET", url: "/api/search?q=%E6%9A%97%E5%8F%B7&limit=101" });

      expect(search).toHaveBeenCalledWith("暗号", undefined);
    } finally {
      await app.close();
    }
  });

  it("passes validated search filters to the service", async () => {
    const { service, search } = createService();
    const app = await createApiServer(service);

    try {
      await app.inject({
        method: "GET",
        url: "/api/search?q=%E6%9A%97%E5%8F%B7&list=wish,stacked&library=utokyo,neither,invalid"
      });

      expect(search).toHaveBeenCalledWith("暗号", undefined, {
        lists: ["wish", "stacked"],
        libraries: ["utokyo", "neither"]
      });
    } finally {
      await app.close();
    }
  });
});

describe("learning path API", () => {
  it("lists enabled planners in service order", async () => {
    const { service } = createService();
    const app = await createApiServer(service);

    try {
      const response = await app.inject({ method: "GET", url: "/api/learning-paths/planners" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        { id: "anthropic", label: "Claude", modelId: "configured-model" },
        { id: "openai", label: "OpenAI", modelId: "configured-openai-model" }
      ]);
    } finally {
      await app.close();
    }
  });

  it("returns an empty list when no planners are enabled", async () => {
    const { service, listLearningPathPlanners } = createService();
    listLearningPathPlanners.mockReturnValue([]);
    const app = await createApiServer(service);

    try {
      const response = await app.inject({ method: "GET", url: "/api/learning-paths/planners" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("returns the generated path with book reasons and the actual response model", async () => {
    const { service, createLearningPath } = createService();
    const app = await createApiServer(service);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/learning-paths",
        payload: { topic: "圏論", planner: "anthropic" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(learningPath);
      expect(createLearningPath).toHaveBeenCalledWith("圏論", "anthropic");
    } finally {
      await app.close();
    }
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
    const { service, createLearningPath } = createService();
    const app = await createApiServer(service);

    try {
      const response = await app.inject({ method: "POST", url: "/api/learning-paths", payload });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_request" });
      expect(createLearningPath).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([1, 200])("accepts a topic with %i characters and the OpenAI planner", async (length) => {
    const { service, createLearningPath } = createService();
    const app = await createApiServer(service);
    const topic = "圏".repeat(length);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/learning-paths",
        payload: { topic, planner: "openai" }
      });

      expect(response.statusCode).toBe(200);
      expect(createLearningPath).toHaveBeenCalledWith(topic, "openai");
    } finally {
      await app.close();
    }
  });

  it.each(["planner_unavailable", "no_candidates"] as const)("returns 409 for %s", async (status) => {
    const { service, createLearningPath } = createService();
    createLearningPath.mockResolvedValue({ status });
    const app = await createApiServer(service);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/learning-paths",
        payload: { topic: "圏論", planner: "anthropic" }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: status });
    } finally {
      await app.close();
    }
  });

  it("logs the provider cause and returns only the error code with 502", async () => {
    const { service, createLearningPath } = createService();
    const cause = new Error("private provider response");
    createLearningPath.mockResolvedValue({ status: "planner_failed", cause });
    const app = await createApiServer(service);
    const logError = vi.fn();
    app.addHook("onRequest", (request, _reply, done) => {
      vi.spyOn(request.log, "error").mockImplementation(logError);
      done();
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/learning-paths",
        payload: { topic: "圏論", planner: "anthropic" }
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: "planner_failed" });
      expect(logError).toHaveBeenCalledWith({ err: cause });
    } finally {
      await app.close();
    }
  });
});
