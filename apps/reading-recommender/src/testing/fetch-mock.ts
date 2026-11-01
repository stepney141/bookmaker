import { expect, vi } from "vitest";

export function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

export function stubFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(null)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function getHeaders(init: RequestInit | undefined): Headers {
  expect(init).toBeDefined();
  expect(init?.headers).toBeInstanceOf(Headers);
  return init?.headers as Headers;
}
