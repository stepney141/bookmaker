import { z } from "zod/v4";

export const plannerOutputSchema = z.strictObject({
  overview: z.string(),
  stages: z.array(
    z.strictObject({
      title: z.string(),
      goal: z.string(),
      books: z.array(z.strictObject({ id: z.string(), reason: z.string() }))
    })
  ),
  gaps: z.array(z.string())
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
