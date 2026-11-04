import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";

import { SEARCH_MAX_RESULTS } from "../utils/search-limits";

import { DEFAULT_SETTINGS } from "./settings";

import type { ReadingRecommenderService } from "./service";
import type { FastifyInstance } from "fastify";

const settingsSchema = z.object({
  recommendationDayOfWeek: z.number().int().min(0).max(6).default(DEFAULT_SETTINGS.recommendationDayOfWeek),
  recommendationTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/u)
    .default(DEFAULT_SETTINGS.recommendationTime),
  timezone: z.string().min(1).default(DEFAULT_SETTINGS.timezone),
  primaryCount: z.number().int().min(1).max(3).default(DEFAULT_SETTINGS.primaryCount),
  secondaryCount: z.number().int().min(0).max(5).default(DEFAULT_SETTINGS.secondaryCount),
  relatedCount: z.number().int().min(0).max(20).default(DEFAULT_SETTINGS.relatedCount),
  searchResultCount: z.number().int().min(1).max(SEARCH_MAX_RESULTS).default(DEFAULT_SETTINGS.searchResultCount),
  remoteOrderAgeDirection: z
    .enum(["larger_is_older", "larger_is_newer", "disabled"])
    .default(DEFAULT_SETTINGS.remoteOrderAgeDirection)
});

const promoteSchema = z.object({
  bookmeterUrl: z.string().min(1)
});

const learningPathSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  planner: z.enum(["anthropic", "openai"])
});

function parseQueryValues(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  const values: readonly string[] = typeof value === "string" ? [value] : value;
  return values.flatMap((item) => item.split(",").map((part) => part.trim()));
}

const queryValuesSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform(parseQueryValues);

const searchQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_RESULTS).optional(),
  list: queryValuesSchema.pipe(z.array(z.enum(["wish", "stacked"]))),
  library: queryValuesSchema.pipe(z.array(z.enum(["utokyo", "sophia", "neither"])))
});

export async function createApiServer(service: ReadingRecommenderService): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/api/health", () => ({ ok: true }));

  app.get("/api/recommendations/current", () => service.current());
  app.post("/api/recommendations/run", () => service.run("manual"));
  app.post("/api/recommendations/random", async (_request, reply) => {
    const result = await service.randomize();

    if (result.status !== "selected") {
      return reply.code(409).send({ error: result.status });
    }

    return result.current;
  });
  app.post("/api/recommendations/promote", (request, reply) => {
    const parsed = promoteSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    return service.promote(parsed.data.bookmeterUrl);
  });

  app.get("/api/search", (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const query = parsed.data;
    return service.search(query.q ?? "", query.limit, {
      lists: [...new Set(query.list)],
      libraries: [...new Set(query.library)]
    });
  });

  app.get("/api/books/diagnostics/row-order", () => service.diagnostics());

  app.get("/api/learning-paths/planners", () => service.listLearningPathPlanners());
  app.post("/api/learning-paths", async (request, reply) => {
    const parsed = learningPathSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = await service.createLearningPath(parsed.data.topic, parsed.data.planner);

    if (result.status === "planner_failed") {
      request.log.error({ err: result.cause });
      return reply.code(502).send({ error: "planner_failed" });
    }

    if (result.status !== "created") {
      return reply.code(409).send({ error: result.status });
    }

    return result.learningPath;
  });

  app.get("/api/settings", () => service.getSettings());
  app.patch("/api/settings", (request, reply) => {
    const current = service.getSettings();
    const parsed = settingsSchema.partial().safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    return service.updateSettings({ ...current, ...parsed.data });
  });

  app.addHook("onClose", (_instance, done) => {
    service.close();
    done();
  });

  return app;
}
