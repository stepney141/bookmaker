import { join } from "node:path";

import fastifyStatic from "@fastify/static";
import dotenv from "dotenv";

import { openAppDb } from "../db/appDb";
import { createOpenAIEmbeddingProviderFromEnv } from "../embedding/openai";

import { createApiServer } from "./api";
import { createRecommendationAutomation } from "./automation";
import { getAppDbPath, getBooksDbPath, getClientDistPath, getWorkspaceRoot } from "./paths";
import { createReadingRecommenderService } from "./service";

async function main(): Promise<void> {
  dotenv.config({ path: join(getWorkspaceRoot(), ".env") });

  const appDb = openAppDb(getAppDbPath());
  const booksDbPath = getBooksDbPath();
  const service = createReadingRecommenderService({
    appDb,
    booksDbPath,
    embeddingProvider: createOpenAIEmbeddingProviderFromEnv(process.env)
  });
  const app = await createApiServer(service);
  createRecommendationAutomation({ service, booksDbPath }).start();

  await app.register(fastifyStatic, {
    root: getClientDistPath(),
    prefix: "/"
  });
  app.setNotFoundHandler((request, reply) => {
    const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;

    if (request.method === "GET" && acceptsHtml && !request.url.startsWith("/api/")) {
      return reply.type("text/html").sendFile("index.html");
    }

    return reply.code(404).send({ error: "not_found" });
  });

  const port = Number(process.env.PORT ?? 4174);
  await app.listen({ host: "0.0.0.0", port });
}

void main();
