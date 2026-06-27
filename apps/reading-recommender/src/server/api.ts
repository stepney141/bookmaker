import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";

import { SEARCH_MAX_RESULTS } from "../shared/searchLimits";
import { DEFAULT_SETTINGS } from "../shared/settings";

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

function parseSearchLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= SEARCH_MAX_RESULTS ? limit : undefined;
}

export async function createApiServer(service: ReadingRecommenderService): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/api/health", () => ({ ok: true }));

  app.get("/api/recommendations/current", () => service.current());
  app.post("/api/recommendations/run", () => service.run("manual"));
  app.post("/api/recommendations/skip", () => service.skip());
  app.post("/api/recommendations/promote", (request, reply) => {
    const parsed = promoteSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    return service.promote(parsed.data.bookmeterUrl);
  });

  app.get("/api/search", (request) => {
    const query = request.query as { readonly q?: string; readonly limit?: string };
    return service.search(query.q ?? "", parseSearchLimit(query.limit));
  });

  app.get("/api/books/diagnostics/row-order", () => service.diagnostics());

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
