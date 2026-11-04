import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { snapshotOf, stackedBook } from "../testing/books";

import { createAnthropicLearningPathPlannerFromEnv, interpretAnthropicLearningPathResponse } from "./anthropic";
import { createLearningPathPrompt } from "./prompt";

import type { LearningPathPlanRequest } from "./types";

const output = {
  overview: "基礎から順に学びます。",
  stages: [{ title: "入門", goal: "基礎を理解する", books: [{ id: "b1", reason: "基礎を扱うため" }] }],
  gaps: ["リストに演習書がありません。"]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("interpretAnthropicLearningPathResponse", () => {
  it("returns parsed output and the actual response model", () => {
    expect(
      interpretAnthropicLearningPathResponse({
        stop_reason: "end_turn",
        parsed_output: output,
        model: "fallback-model"
      })
    ).toEqual({ output, modelId: "fallback-model" });
  });

  it.each(["refusal", "max_tokens"] as const)("rejects %s even when parsed output exists", (stopReason) => {
    expect(() =>
      interpretAnthropicLearningPathResponse({
        stop_reason: stopReason,
        parsed_output: output,
        model: "response-model"
      })
    ).toThrow();
  });

  it("rejects absent parsed output", () => {
    expect(() =>
      interpretAnthropicLearningPathResponse({ stop_reason: "end_turn", parsed_output: null, model: "response-model" })
    ).toThrow();
  });

  it("rejects output that violates the planner schema", () => {
    expect(() =>
      interpretAnthropicLearningPathResponse({
        stop_reason: "end_turn",
        parsed_output: { ...output, stages: [{ title: "入門", goal: "基礎", books: [{ id: "b1" }] }] },
        model: "response-model"
      })
    ).toThrow();
  });
});

describe("createAnthropicLearningPathPlannerFromEnv", () => {
  it.each([{}, { ANTHROPIC_API_KEY: "" }])("is disabled without an API key in %j", (env) => {
    expect(createAnthropicLearningPathPlannerFromEnv(env)).toBeNull();
  });

  it("sends the prompt with the advertised model and returns the response model and output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "message-learning-path",
        type: "message",
        role: "assistant",
        model: "actual-anthropic-model",
        content: [{ type: "text", text: JSON.stringify(output) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const planner = createAnthropicLearningPathPlannerFromEnv({ ANTHROPIC_API_KEY: "test-key" });
    assert(planner !== null);
    expect(planner).toMatchObject({ id: "anthropic", label: "Claude" });
    const request: LearningPathPlanRequest = {
      topic: "数学",
      candidates: [
        {
          id: "b1",
          book: snapshotOf(
            stackedBook({ bookmeterUrl: "https://bookmeter.com/books/1", title: "数学入門", remoteRank: 1 })
          )
        }
      ]
    };
    const prompt = createLearningPathPrompt(request);

    await expect(planner.plan(request)).resolves.toEqual({ output, modelId: "actual-anthropic-model" });

    const sentRequest = new Request(...fetchMock.mock.calls[0]);
    const body: unknown = await sentRequest.json();
    expect(body).toMatchObject({
      model: planner.modelId,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }]
    });
  });
});
