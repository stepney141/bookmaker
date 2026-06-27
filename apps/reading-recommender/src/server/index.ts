import fastifyStatic from "@fastify/static";
import dotenv from "dotenv";
import { join } from "node:path";

import { openAppDb } from "../db/appDb";

import { createApiServer } from "./api";
import { getAppDbPath, getBooksDbPath, getClientDistPath, getWorkspaceRoot } from "./paths";
import { createReadingRecommenderService } from "./service";

async function main(): Promise<void> {
  dotenv.config({ path: join(getWorkspaceRoot(), ".env") });

  const appDb = openAppDb(getAppDbPath());
  const service = createReadingRecommenderService({ appDb, booksDbPath: getBooksDbPath() });
  const app = await createApiServer(service);

  await app.register(fastifyStatic, {
    root: getClientDistPath(),
    prefix: "/"
  });

  const port = Number(process.env.PORT ?? 4174);
  await app.listen({ host: "0.0.0.0", port });
}

void main();
