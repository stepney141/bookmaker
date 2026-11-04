import { afterEach, describe, expect, it, vi } from "vitest";

import { createLearningPath } from "@/features/learning-path/api/create-learning-path";
import { fetchLearningPathPlanners } from "@/features/learning-path/api/fetch-learning-path-planners";
import { stubFetch } from "@/testing/fetch-mock";

describe("learning-path requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets the planners endpoint without a body", async () => {
    const fetchMock = stubFetch();

    await fetchLearningPathPlanners();

    const request = new Request(
      new URL(fetchMock.mock.calls[0]?.[0] as string, "http://localhost"),
      fetchMock.mock.calls[0]?.[1]
    );
    expect(request.url).toBe("http://localhost/api/learning-paths/planners");
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
  });

  it("requests a learning path with the topic and selected planner", async () => {
    const fetchMock = stubFetch();

    await createLearningPath("測度論的確率論を勉強したい", "anthropic");

    const request = new Request(
      new URL(fetchMock.mock.calls[0]?.[0] as string, "http://localhost"),
      fetchMock.mock.calls[0]?.[1]
    );
    expect(request.url).toBe("http://localhost/api/learning-paths");
    expect(request.method).toBe("POST");
    expect(await request.json()).toEqual({
      topic: "測度論的確率論を勉強したい",
      planner: "anthropic"
    });
  });
});
