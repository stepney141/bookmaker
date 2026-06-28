import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { createApiServer } from "./api";

import type { ReadingRecommenderService } from "./service";

function createService(): {
  readonly service: ReadingRecommenderService;
  readonly search: ReturnType<typeof vi.fn<ReadingRecommenderService["search"]>>;
} {
  const search = vi.fn<ReadingRecommenderService["search"]>(() => Promise.resolve([]));

  return {
    search,
    service: {
      sync() {},
      run: () => Promise.resolve(null),
      runScheduled: () => Promise.resolve(null),
      runIfSourceChanged: () => Promise.resolve({ changed: false, current: null }),
      current: () => Promise.resolve(null),
      skip: () => Promise.resolve(null),
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
