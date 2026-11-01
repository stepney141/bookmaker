import { afterEach, describe, expect, it, vi } from "vitest";

import { getHeaders, jsonResponse, stubFetch } from "@/testing/fetch-mock";

import { createLearningPath } from "../create-learning-path";
import { fetchLearningPathPlanners } from "../fetch-learning-path-planners";

describe("client API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches enabled learning-path planners in server order", async () => {
    const fetchMock = stubFetch();
    const planners = [
      { id: "anthropic", label: "Claude", modelId: "claude-opus-5-5" },
      { id: "openai", label: "OpenAI", modelId: "configured-model" }
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(planners));

    expect(await fetchLearningPathPlanners()).toEqual(planners);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/learning-paths/planners");
    expect(getHeaders(fetchMock.mock.calls[0]?.[1]).has("Content-Type")).toBe(false);
  });

  it("requests a learning path with the topic and selected planner", async () => {
    const fetchMock = stubFetch();
    const learningPath = {
      topic: "測度論的確率論を勉強したい",
      overview: "測度論を基礎に確率論を学びます。",
      stages: [],
      gaps: ["リストに該当する本がありません。"],
      planner: { id: "anthropic", label: "Claude", modelId: "claude-opus-5-5" }
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(learningPath));

    expect(await createLearningPath(learningPath.topic, "anthropic")).toEqual(learningPath);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/learning-paths");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ topic: learningPath.topic, planner: "anthropic" }));
    expect(getHeaders(init).get("Content-Type")).toBe("application/json");
  });

  it.each([
    { status: 400, code: "invalid_request" },
    { status: 409, code: "planner_unavailable" },
    { status: 409, code: "no_candidates" },
    { status: 502, code: "planner_failed" }
  ])("exposes the learning-path error $code", async ({ status, code }) => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: code }), {
        headers: { "Content-Type": "application/json" },
        status
      })
    );

    await expect(createLearningPath("圏論を勉強したい", "openai")).rejects.toMatchObject({
      name: "ApiRequestError",
      status,
      code
    });
  });
});
