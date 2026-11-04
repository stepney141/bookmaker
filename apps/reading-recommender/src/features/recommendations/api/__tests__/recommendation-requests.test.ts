import { afterEach, describe, expect, it, vi } from "vitest";

import { promoteRecommendation } from "@/features/recommendations/api/promote-recommendation";
import { randomizeRecommendation } from "@/features/recommendations/api/randomize-recommendation";
import { runRecommendation } from "@/features/recommendations/api/run-recommendation";
import { stubFetch } from "@/testing/fetch-mock";

describe("recommendation requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { name: "run", action: runRecommendation, path: "/api/recommendations/run" },
    { name: "random", action: randomizeRecommendation, path: "/api/recommendations/random" }
  ])("posts to the $name endpoint without a body", async ({ action, path }) => {
    const fetchMock = stubFetch();

    await action();

    const request = new Request(
      new URL(fetchMock.mock.calls[0]?.[0] as string, "http://localhost"),
      fetchMock.mock.calls[0]?.[1]
    );
    expect(request.url).toBe(`http://localhost${path}`);
    expect(request.method).toBe("POST");
    expect(request.body).toBeNull();
  });

  it("posts the selected book URL to the promote endpoint", async () => {
    const fetchMock = stubFetch();

    await promoteRecommendation("https://bookmeter.com/books/1");

    const request = new Request(
      new URL(fetchMock.mock.calls[0]?.[0] as string, "http://localhost"),
      fetchMock.mock.calls[0]?.[1]
    );
    expect(request.url).toBe("http://localhost/api/recommendations/promote");
    expect(request.method).toBe("POST");
    expect(await request.json()).toEqual({ bookmeterUrl: "https://bookmeter.com/books/1" });
  });
});
