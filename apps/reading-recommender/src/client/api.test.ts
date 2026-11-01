import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiRequestError,
  createLearningPath,
  fetchLearningPathPlanners,
  promoteRecommendation,
  randomizeRecommendation,
  runRecommendation,
  searchBooks
} from "./api";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

function stubFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(null)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function getHeaders(init: RequestInit | undefined): Headers {
  expect(init).toBeDefined();
  expect(init?.headers).toBeInstanceOf(Headers);
  return init?.headers as Headers;
}

describe("client API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send a JSON content type for bodyless recommendation actions", async () => {
    const fetchMock = stubFetch();

    await runRecommendation();
    await randomizeRecommendation();

    const runInit = fetchMock.mock.calls[0]?.[1];
    const randomInit = fetchMock.mock.calls[1]?.[1];

    expect(runInit?.method).toBe("POST");
    expect(randomInit?.method).toBe("POST");
    expect(getHeaders(runInit).has("Content-Type")).toBe(false);
    expect(getHeaders(randomInit).has("Content-Type")).toBe(false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/recommendations/random");
  });

  it("exposes the API error code for an unavailable random candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "no_random_candidate" }), {
            headers: { "Content-Type": "application/json" },
            status: 409
          })
        )
      )
    );

    try {
      await randomizeRecommendation();
      expect.fail("Expected randomizeRecommendation to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);

      if (!(error instanceof ApiRequestError)) {
        return;
      }

      expect(error.status).toBe(409);
      expect(error.code).toBe("no_random_candidate");
    }
  });

  it("sends a JSON content type when the request has a JSON body", async () => {
    const fetchMock = stubFetch();

    await promoteRecommendation("https://bookmeter.com/books/1");

    const init = fetchMock.mock.calls[0]?.[1];

    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ bookmeterUrl: "https://bookmeter.com/books/1" }));
    expect(getHeaders(init).get("Content-Type")).toBe("application/json");
  });

  it("sends a search limit when one is provided", async () => {
    const fetchMock = stubFetch();

    await searchBooks("暗号", 20);

    const request = fetchMock.mock.calls[0]?.[0];

    if (typeof request !== "string") {
      expect(request).toBeTypeOf("string");
      return;
    }

    const url = new URL(request, "http://localhost");

    expect(url.pathname).toBe("/api/search");
    expect(url.searchParams.get("q")).toBe("暗号");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("sends search filters when they are provided", async () => {
    const fetchMock = stubFetch();

    await searchBooks("暗号", 20, { lists: ["wish"], libraries: ["utokyo", "sophia"] });

    const request = fetchMock.mock.calls[0]?.[0];

    if (typeof request !== "string") {
      expect(request).toBeTypeOf("string");
      return;
    }

    const url = new URL(request, "http://localhost");

    expect(url.searchParams.get("list")).toBe("wish");
    expect(url.searchParams.get("library")).toBe("utokyo,sophia");
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
