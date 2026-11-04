import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, requestJson } from "@/lib/api-client";
import { getHeaders, stubFetch } from "@/testing/fetch-mock";

describe("JSON API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets a JSON content type when the request has a body", async () => {
    const fetchMock = stubFetch();

    await requestJson<null>("/api/example", {
      method: "POST",
      body: JSON.stringify({ topic: "圏論" })
    });

    expect(getHeaders(fetchMock.mock.calls[0]?.[1]).get("Content-Type")).toBe("application/json");
  });

  it.each([
    { name: "GET", init: undefined },
    { name: "POST", init: { method: "POST" } }
  ])("omits the content type for a bodyless $name request", async ({ init }) => {
    const fetchMock = stubFetch();

    await requestJson<null>("/api/example", init);

    expect(getHeaders(fetchMock.mock.calls[0]?.[1]).has("Content-Type")).toBe(false);
  });

  it("preserves headers supplied by the caller", async () => {
    const fetchMock = stubFetch();

    await requestJson<null>("/api/example", {
      method: "POST",
      headers: {
        "content-type": "application/merge-patch+json",
        Authorization: "Bearer caller-token"
      },
      body: JSON.stringify({ topic: "圏論" })
    });

    const headers = getHeaders(fetchMock.mock.calls[0]?.[1]);
    expect(headers.get("Content-Type")).toBe("application/merge-patch+json");
    expect(headers.get("Authorization")).toBe("Bearer caller-token");
  });

  it("rejects with the response status and error code", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "no_random_candidate" }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    );

    const request = requestJson<null>("/api/example");

    await expect(request).rejects.toBeInstanceOf(ApiRequestError);
    await expect(request).rejects.toMatchObject({ status: 409, code: "no_random_candidate" });
  });

  it("rejects responses without an error code with a different error type", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      })
    );

    const request = requestJson<null>("/api/example");

    await expect(request).rejects.toBeInstanceOf(Error);
    await expect(request).rejects.not.toBeInstanceOf(ApiRequestError);
  });
});
