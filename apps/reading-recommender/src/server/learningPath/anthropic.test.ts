import { describe, expect, it } from "vitest";

import { createAnthropicLearningPathPlannerFromEnv, interpretAnthropicLearningPathResponse } from "./anthropic";

const output = {
  overview: "基礎から順に学びます。",
  stages: [{ title: "入門", goal: "基礎を理解する", books: [{ id: "b1", reason: "基礎を扱うため" }] }],
  gaps: ["リストに演習書がありません。"]
};

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
  it("is disabled without an API key", () => {
    expect(createAnthropicLearningPathPlannerFromEnv({})).toBeNull();
    expect(createAnthropicLearningPathPlannerFromEnv({ ANTHROPIC_API_KEY: "" })).toBeNull();
  });

  it("enables Claude with the specified model when an API key is configured", () => {
    expect(createAnthropicLearningPathPlannerFromEnv({ ANTHROPIC_API_KEY: "test-key" })).toMatchObject({
      id: "anthropic",
      label: "Claude",
      modelId: "claude-opus-5-5"
    });
  });
});
