import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { createApiServer } from "./api";

import type { ReadingRecommenderService } from "./service";

function createService(): {
  readonly service: ReadingRecommenderService;
  readonly randomize: ReturnType<typeof vi.fn<ReadingRecommenderService["randomize"]>>;
  readonly search: ReturnType<typeof vi.fn<ReadingRecommenderService["search"]>>;
} {
  const randomize = vi.fn<ReadingRecommenderService["randomize"]>(() =>
    Promise.resolve({ status: "no_random_candidate" })
  );
  const search = vi.fn<ReadingRecommenderService["search"]>(() => Promise.resolve([]));

  return {
    randomize,
    search,
    service: {
      sync() {},
      run: () => Promise.resolve(null),
      runScheduled: () => Promise.resolve(null),
      runIfSourceChanged: () => Promise.resolve({ changed: false, current: null }),
      current: () => Promise.resolve(null),
      randomize,
      promote: () => Promise.resolve(null),
      search,
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
