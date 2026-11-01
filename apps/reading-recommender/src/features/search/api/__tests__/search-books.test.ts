import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetch } from "@/testing/fetch-mock";

import { searchBooks } from "../search-books";

describe("client API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
