import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

import { createApiServer } from "./api";
import { createRecommendationAutomation } from "./automation";
import { openAppDb } from "./db/appDb";
import { createOpenAIEmbeddingProviderFromEnv } from "./embedding/openai";
import { createAnthropicLearningPathPlannerFromEnv } from "./learningPath/anthropic";
import { createOpenAILearningPathPlannerFromEnv } from "./learningPath/openai";
import { getAppDbPath, getBooksDbPath, getEnvPath } from "./paths";
import { createReadingRecommenderService } from "./service";

async function main(): Promise<void> {
  dotenv.config({ path: getEnvPath() });

  const appDb = openAppDb(getAppDbPath());
  const booksDbPath = getBooksDbPath();
  const service = createReadingRecommenderService({
    appDb,
    booksDbPath,
    embeddingProvider: createOpenAIEmbeddingProviderFromEnv(process.env),
    learningPathPlanners: [
      createAnthropicLearningPathPlannerFromEnv(process.env),
      createOpenAILearningPathPlannerFromEnv(process.env)
    ].filter((planner) => planner !== null)
  });
  const api = await createApiServer(service);
  createRecommendationAutomation({ service, booksDbPath }).start();
  const vite = await createViteServer({ server: { host: "0.0.0.0", port: 5173 } });

  await api.listen({ host: "127.0.0.1", port: 4175 });
  await vite.listen();
  vite.printUrls();
}

void main();
