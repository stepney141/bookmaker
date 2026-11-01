import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";

import { createLearningPathPrompt } from "./prompt";
import { plannerOutputSchema } from "./schema";

import type { LearningPathPlanner, LearningPathPlanResult } from "./types";

const MODEL_ID = "claude-opus-5-5";

const responseSchema = z.object({
  model: z.string(),
  stop_reason: z
    .string()
    .nullable()
    .refine(
      (reason) => reason !== "refusal" && reason !== "max_tokens",
      "Claude refused or truncated the learning path"
    ),
  parsed_output: plannerOutputSchema
});

export function interpretAnthropicLearningPathResponse(response: {
  readonly model: string;
  readonly stop_reason: string | null;
  readonly parsed_output: unknown;
}): LearningPathPlanResult {
  const parsed = responseSchema.parse(response);
  return { output: parsed.parsed_output, modelId: parsed.model };
}

export function createAnthropicLearningPathPlannerFromEnv(env: NodeJS.ProcessEnv): LearningPathPlanner | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  const client = new Anthropic({ apiKey });

  return {
    id: "anthropic",
    label: "Claude",
    modelId: MODEL_ID,
    async plan(request): Promise<LearningPathPlanResult> {
      const prompt = createLearningPathPrompt(request);
      const response = await client.beta.messages.parse({
        model: MODEL_ID,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        output_config: { effort: "medium", format: zodOutputFormat(plannerOutputSchema) },
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default"
      });

      return interpretAnthropicLearningPathResponse(response);
    }
  };
}
