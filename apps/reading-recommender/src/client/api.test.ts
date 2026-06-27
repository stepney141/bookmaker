import { afterEach, describe, expect, it, vi } from "vitest";

import { promoteRecommendation, runRecommendation, searchBooks, skipRecommendation } from "./api";

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
    await skipRecommendation();

    const runInit = fetchMock.mock.calls[0]?.[1];
    const skipInit = fetchMock.mock.calls[1]?.[1];

    expect(runInit?.method).toBe("POST");
    expect(skipInit?.method).toBe("POST");
    expect(getHeaders(runInit).has("Content-Type")).toBe(false);
    expect(getHeaders(skipInit).has("Content-Type")).toBe(false);
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
});
