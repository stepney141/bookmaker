import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { plannerOutputSchema } from "./schema";

describe("plannerOutputSchema", () => {
  it("derives a strict JSON Schema with every property required at all object levels", () => {
    expect(z.toJSONSchema(plannerOutputSchema)).toMatchObject({
      type: "object",
      required: ["overview", "stages", "gaps"],
      additionalProperties: false,
      properties: {
        stages: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "goal", "books"],
            additionalProperties: false,
            properties: {
              books: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "reason"],
                  additionalProperties: false
                }
              }
            }
          }
        }
      }
    });
  });
});
