import dotenv from "dotenv";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";

import { openAppDb } from "../db/appDb";

import { createApiServer } from "./api";
import { getAppDbPath, getBooksDbPath, getWorkspaceRoot } from "./paths";
import { createReadingRecommenderService } from "./service";

async function main(): Promise<void> {
  dotenv.config({ path: join(getWorkspaceRoot(), ".env") });

  const appDb = openAppDb(getAppDbPath());
  const service = createReadingRecommenderService({ appDb, booksDbPath: getBooksDbPath() });
  const api = await createApiServer(service);
  const vite = await createViteServer({ server: { host: "0.0.0.0", port: 5173 } });

  await api.listen({ host: "127.0.0.1", port: 4174 });
  await vite.listen();
  vite.printUrls();
}

void main();
