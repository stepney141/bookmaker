import { z } from "zod/v4";

import { createLearningPathPrompt } from "./prompt";
import { plannerOutputSchema } from "./schema";

import type { LearningPathPlanner, LearningPathPlanResult } from "./types";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
// Drop the dialect URI: the request only needs the schema body.
export const outputJsonSchema = Object.fromEntries(
  Object.entries(z.toJSONSchema(plannerOutputSchema)).filter(([key]) => key !== "$schema")
);

const responseSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().refine((reason) => reason !== "length", "OpenAI truncated the learning path"),
        message: z.object({
          refusal: z.null().optional(),
          content: z.string()
        })
      })
    )
    .min(1)
});

export function interpretOpenAILearningPathResponse(response: unknown): LearningPathPlanResult {
  const parsed = responseSchema.parse(response);
  const output = plannerOutputSchema.parse(JSON.parse(parsed.choices[0].message.content));
  return { output, modelId: parsed.model };
}

export function createOpenAILearningPathPlannerFromEnv(env: NodeJS.ProcessEnv): LearningPathPlanner | null {
  const apiKey = env.OPENAI_API_KEY;
  const modelId = env.OPENAI_LEARNING_PATH_MODEL;
  if (!apiKey || !modelId) {
    return null;
  }

  return {
    id: "openai",
    label: "OpenAI",
    modelId,
    async plan(request): Promise<LearningPathPlanResult> {
      const prompt = createLearningPathPrompt(request);
      const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user }
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "learning_path", strict: true, schema: outputJsonSchema }
          }
        })
      });

      if (!response.ok) {
        return Promise.reject(new Error(`OpenAI learning path request failed with status ${response.status}`));
      }

      return interpretOpenAILearningPathResponse(await response.json());
    }
  };
}
