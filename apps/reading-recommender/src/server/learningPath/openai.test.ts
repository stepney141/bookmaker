import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { snapshotOf, stackedBook } from "../testing/books";

import { createOpenAILearningPathPlannerFromEnv, interpretOpenAILearningPathResponse } from "./openai";
import { createLearningPathPrompt } from "./prompt";

import type { LearningPathPlanRequest } from "./types";

const output = {
  overview: "入門から専門的な内容へ進みます。",
  stages: [{ title: "入門", goal: "基礎を理解する", books: [{ id: "b1", reason: "基礎を扱うため" }] }],
  gaps: []
};

const request: LearningPathPlanRequest = {
  topic: "数学",
  candidates: [
    {
      id: "b1",
      book: snapshotOf(stackedBook({ bookmeterUrl: "https://bookmeter.com/books/1", title: "数学入門", remoteRank: 1 }))
    }
  ]
};

function expectStrictSchema(schema: unknown): void {
  if (schema === null || typeof schema !== "object") {
    return;
  }

  expect(schema).not.toHaveProperty("$schema");
  if ("type" in schema && schema.type === "object") {
    assert("properties" in schema && schema.properties !== null && typeof schema.properties === "object");
    assert("required" in schema && Array.isArray(schema.required));
    expect(schema).toHaveProperty("additionalProperties", false);
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(schema.properties)));
  }
  Object.values(schema).forEach(expectStrictSchema);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    "rejects missing content, invalid JSON or schema mismatches: %j",
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
    "is disabled for incomplete configuration %j",
    (env) => {
      expect(createOpenAILearningPathPlannerFromEnv(env)).toBeNull();
    }
  );

  it("sends the prompt with a strict schema and returns the response model and output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "actual-openai-model",
        choices: [{ finish_reason: "stop", message: { refusal: null, content: JSON.stringify(output) } }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const planner = createOpenAILearningPathPlannerFromEnv({
      OPENAI_API_KEY: "test-key",
      OPENAI_LEARNING_PATH_MODEL: "explicit-model"
    });
    assert(planner !== null);
    expect(planner).toMatchObject({ id: "openai", label: "OpenAI", modelId: "explicit-model" });
    const prompt = createLearningPathPrompt(request);

    await expect(planner.plan(request)).resolves.toEqual({ output, modelId: "actual-openai-model" });

    const sentRequest = new Request(...fetchMock.mock.calls[0]);
    expect(sentRequest.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sentRequest.method).toBe("POST");
    expect(sentRequest.headers.get("Authorization")).toBe("Bearer test-key");
    const body = (await sentRequest.json()) as {
      readonly response_format: { readonly json_schema: { readonly schema: unknown } };
    };
    expect(body).toMatchObject({
      model: "explicit-model",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      response_format: { type: "json_schema", json_schema: { strict: true } }
    });
    const schema = body.response_format.json_schema.schema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        overview: { type: "string" },
        stages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              goal: { type: "string" },
              books: {
                type: "array",
                items: {
                  type: "object",
                  properties: { id: { type: "string" }, reason: { type: "string" } }
                }
              }
            }
          }
        },
        gaps: { type: "array", items: { type: "string" } }
      }
    });
    expectStrictSchema(schema);
  });

  it.each([302, 400, 500])("rejects an HTTP %i response", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            model: "actual-openai-model",
            choices: [{ finish_reason: "stop", message: { refusal: null, content: JSON.stringify(output) } }]
          },
          { status }
        )
      )
    );
    const planner = createOpenAILearningPathPlannerFromEnv({
      OPENAI_API_KEY: "test-key",
      OPENAI_LEARNING_PATH_MODEL: "explicit-model"
    });
    assert(planner !== null);

    await expect(planner.plan(request)).rejects.toThrow();
  });
});
