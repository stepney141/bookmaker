import { join } from "node:path";

import fastifyStatic from "@fastify/static";
import dotenv from "dotenv";

import { openAppDb } from "../db/appDb";
import { createOpenAIEmbeddingProviderFromEnv } from "../embedding/openai";

import { createApiServer } from "./api";
import { getAppDbPath, getBooksDbPath, getClientDistPath, getWorkspaceRoot } from "./paths";
import { createReadingRecommenderService } from "./service";

async function main(): Promise<void> {
  dotenv.config({ path: join(getWorkspaceRoot(), ".env") });

  const appDb = openAppDb(getAppDbPath());
  const service = createReadingRecommenderService({
    appDb,
    booksDbPath: getBooksDbPath(),
    embeddingProvider: createOpenAIEmbeddingProviderFromEnv(process.env)
  });
  const app = await createApiServer(service);

  await app.register(fastifyStatic, {
    root: getClientDistPath(),
    prefix: "/"
  });

  const port = Number(process.env.PORT ?? 4174);
  await app.listen({ host: "0.0.0.0", port });
}

void main();
