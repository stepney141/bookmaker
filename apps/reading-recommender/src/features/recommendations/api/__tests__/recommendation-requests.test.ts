import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api-client";
import { getHeaders, stubFetch } from "@/testing/fetch-mock";

import { promoteRecommendation } from "../promote-recommendation";
import { randomizeRecommendation } from "../randomize-recommendation";
import { runRecommendation } from "../run-recommendation";

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
});
