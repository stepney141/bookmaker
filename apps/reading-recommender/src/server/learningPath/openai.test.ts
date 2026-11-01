import { describe, expect, it } from "vitest";

import {
  createOpenAILearningPathPlannerFromEnv,
  interpretOpenAILearningPathResponse,
  outputJsonSchema
} from "./openai";

describe("outputJsonSchema", () => {
  it("sends the schema body without the dialect URI", () => {
    expect(outputJsonSchema).not.toHaveProperty("$schema");
    expect(outputJsonSchema).toMatchObject({ type: "object", additionalProperties: false });
  });
});

const output = {
  overview: "入門から専門的な内容へ進みます。",
  stages: [{ title: "入門", goal: "基礎を理解する", books: [{ id: "b1", reason: "基礎を扱うため" }] }],
  gaps: []
};

describe("interpretOpenAILearningPathResponse", () => {
  it("parses the content and returns the actual response model", () => {
    expect(
      interpretOpenAILearningPathResponse({
        model: "actual-openai-model",
        choices: [{ finish_reason: "stop", message: { refusal: null, content: JSON.stringify(output) } }]
      })
    ).toEqual({ output, modelId: "actual-openai-model" });
  });

  it("rejects refusals even if content is valid", () => {
    expect(() =>
      interpretOpenAILearningPathResponse({
        model: "response-model",
        choices: [{ finish_reason: "stop", message: { refusal: "I cannot comply.", content: JSON.stringify(output) } }]
      })
    ).toThrow();
  });

  it("rejects truncated output even if content is valid", () => {
    expect(() =>
      interpretOpenAILearningPathResponse({
        model: "response-model",
        choices: [{ finish_reason: "length", message: { content: JSON.stringify(output) } }]
      })
    ).toThrow();
  });

  it.each([null, "{", JSON.stringify({ ...output, gaps: "演習書が不足" })])(
    "rejects missing content, invalid JSON or schema mismatches",
    (content) => {
      expect(() =>
        interpretOpenAILearningPathResponse({
          model: "response-model",
          choices: [{ finish_reason: "stop", message: { content } }]
        })
      ).toThrow();
    }
  );

  it("rejects an empty choices array", () => {
    expect(() => interpretOpenAILearningPathResponse({ model: "response-model", choices: [] })).toThrow();
  });
});

describe("createOpenAILearningPathPlannerFromEnv", () => {
  it.each([{}, { OPENAI_API_KEY: "test-key" }, { OPENAI_LEARNING_PATH_MODEL: "explicit-model" }])(
    "is disabled unless both the key and explicit model are configured",
    (env) => {
      expect(createOpenAILearningPathPlannerFromEnv(env)).toBeNull();
    }
  );

  it("uses the explicitly configured model", () => {
    expect(
      createOpenAILearningPathPlannerFromEnv({
        OPENAI_API_KEY: "test-key",
        OPENAI_LEARNING_PATH_MODEL: "explicit-model"
      })
    ).toMatchObject({ id: "openai", label: "OpenAI", modelId: "explicit-model" });
  });
});
