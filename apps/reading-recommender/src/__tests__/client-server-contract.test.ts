import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createLearningPath } from "@/features/learning-path/api/create-learning-path";
import { fetchLearningPathPlanners } from "@/features/learning-path/api/fetch-learning-path-planners";
import { promoteRecommendation } from "@/features/recommendations/api/promote-recommendation";
import { randomizeRecommendation } from "@/features/recommendations/api/randomize-recommendation";
import { runRecommendation } from "@/features/recommendations/api/run-recommendation";
import { searchBooks } from "@/features/search/api/search-books";
import { ApiRequestError } from "@/lib/api-client";
import { createApiServer } from "@/server/api";
import { createReadingRecommenderService } from "@/server/service";
import { openTestAppDb } from "@/server/testing/appDb";
import { createSourceDb } from "@/server/testing/sourceDb";
import { stubFetch } from "@/testing/fetch-mock";

import type { LearningPathPlanner } from "@/server/learningPath/types";
import type { SourceBookLists } from "@/server/testing/sourceDb";
import type { FastifyInstance, InjectOptions } from "fastify";

function routeFetchToApp(app: FastifyInstance): void {
  stubFetch().mockImplementation(async (input, init) => {
    const request = new Request(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    const response = await app.inject({
      method: request.method as InjectOptions["method"],
      url: request.url,
      headers: Object.fromEntries(request.headers),
      payload: request.body === null ? undefined : await request.text()
    });

    return new Response(response.body, { status: response.statusCode });
  });
}

async function connectClient(
  books: SourceBookLists,
  learningPathPlanners: readonly LearningPathPlanner[]
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "reading-recommender-contract-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const booksDbPath = join(directory, "books.sqlite");
  createSourceDb(booksDbPath, books);
  const app = await createApiServer(
    createReadingRecommenderService({
      appDb: openTestAppDb(),
      booksDbPath,
      learningPathPlanners
    })
  );
  onTestFinished(() => app.close());
  routeFetchToApp(app);
}

const searchBooksFixture: SourceBookLists = {
  stacked: [
    {
      bookmeter_url: "https://bookmeter.com/books/topology-utokyo",
      book_title: "Topology foundations",
      exist_in_sophia: "No",
      exist_in_utokyo: "Yes"
    },
    {
      bookmeter_url: "https://bookmeter.com/books/topology-sophia",
      book_title: "Topology exercises",
      exist_in_sophia: "Yes",
      exist_in_utokyo: "No"
    }
  ],
  wish: [
    {
      bookmeter_url: "https://bookmeter.com/books/topology-wish",
      book_title: "Topology applications",
      exist_in_sophia: "No",
      exist_in_utokyo: "Yes"
    }
  ]
};

describe("client and server API contracts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs a recommendation and returns the selected book", async () => {
    await connectClient(
      {
        stacked: [{ bookmeter_url: "https://bookmeter.com/books/stacked", book_title: "Stacked book" }],
        wish: [{ bookmeter_url: "https://bookmeter.com/books/wish", book_title: "Wish book" }]
      },
      []
    );

    await expect(runRecommendation()).resolves.toMatchObject({
      reason: "manual",
      primary: {
        bookmeterUrl: "https://bookmeter.com/books/stacked",
        title: "Stacked book",
        inStacked: true,
        inWish: false
      }
    });
  });

  it("randomizes to the book outside the current recommendation", async () => {
    await connectClient(
      {
        stacked: [
          { bookmeter_url: "https://bookmeter.com/books/random-candidate", book_title: "Undisplayed candidate" },
          { bookmeter_url: "https://bookmeter.com/books/secondary-b", book_title: "Second alternative" },
          { bookmeter_url: "https://bookmeter.com/books/secondary-a", book_title: "First alternative" },
          { bookmeter_url: "https://bookmeter.com/books/primary", book_title: "Initial recommendation" }
        ],
        wish: []
      },
      []
    );
    await runRecommendation();

    await expect(randomizeRecommendation()).resolves.toMatchObject({
      primary: {
        bookmeterUrl: "https://bookmeter.com/books/random-candidate",
        title: "Undisplayed candidate"
      }
    });
  });

  it("promotes the requested book to the primary recommendation", async () => {
    await connectClient(
      {
        stacked: [{ bookmeter_url: "https://bookmeter.com/books/stacked", book_title: "Stacked book" }],
        wish: [{ bookmeter_url: "https://bookmeter.com/books/wish", book_title: "Wish book" }]
      },
      []
    );
    await runRecommendation();

    await expect(promoteRecommendation("https://bookmeter.com/books/wish")).resolves.toMatchObject({
      primary: {
        bookmeterUrl: "https://bookmeter.com/books/wish",
        title: "Wish book",
        inWish: true
      }
    });
  });

  it("searches within the requested list and library", async () => {
    await connectClient(searchBooksFixture, []);

    const results = await searchBooks("Topology", 10, { lists: ["stacked"], libraries: ["utokyo"] });

    expect(results.map(({ bookmeterUrl }) => bookmeterUrl)).toEqual(["https://bookmeter.com/books/topology-utokyo"]);
  });

  it("applies the search limit with comma-separated list and library filters", async () => {
    await connectClient(searchBooksFixture, []);

    const results = await searchBooks("Topology", 1, {
      lists: ["wish", "stacked"],
      libraries: ["utokyo", "sophia"]
    });

    expect(results).toHaveLength(1);
    expect([
      "https://bookmeter.com/books/topology-utokyo",
      "https://bookmeter.com/books/topology-sophia",
      "https://bookmeter.com/books/topology-wish"
    ]).toContain(results[0]?.bookmeterUrl);
  });

  it("lists the configured learning path planners in order", async () => {
    const plan: LearningPathPlanner["plan"] = () =>
      Promise.resolve({
        modelId: "unused-model",
        output: { overview: "", stages: [], gaps: [] }
      });
    await connectClient({ stacked: [], wish: [] }, [
      { id: "openai", label: "OpenAI", modelId: "openai-contract", plan },
      { id: "anthropic", label: "Claude", modelId: "anthropic-contract", plan }
    ]);

    await expect(fetchLearningPathPlanners()).resolves.toEqual([
      { id: "openai", label: "OpenAI", modelId: "openai-contract" },
      { id: "anthropic", label: "Claude", modelId: "anthropic-contract" }
    ]);
  });

  it("creates a learning path with the requested topic and planner", async () => {
    const planner: LearningPathPlanner = {
      id: "openai",
      label: "OpenAI",
      modelId: "configured-model",
      plan: ({ topic, candidates }) =>
        Promise.resolve({
          modelId: "returned-model",
          output: {
            overview: `Study ${topic} from the foundations.`,
            stages: [
              {
                title: "Foundations",
                goal: "Understand basic topological spaces.",
                books: candidates.map(({ id }) => ({ id, reason: "Introduces topological spaces." }))
              }
            ],
            gaps: ["Advanced examples are not in the collection."]
          }
        })
    };
    await connectClient(
      {
        stacked: [{ bookmeter_url: "https://bookmeter.com/books/topology", book_title: "Topology foundations" }],
        wish: []
      },
      [planner]
    );

    await expect(createLearningPath("Topology", "openai")).resolves.toMatchObject({
      topic: "Topology",
      overview: "Study Topology from the foundations.",
      planner: { id: "openai", label: "OpenAI", modelId: "returned-model" },
      stages: [
        {
          title: "Foundations",
          goal: "Understand basic topological spaces.",
          books: [
            {
              bookmeterUrl: "https://bookmeter.com/books/topology",
              title: "Topology foundations",
              reason: "Introduces topological spaces."
            }
          ]
        }
      ],
      gaps: ["Advanced examples are not in the collection."]
    });
  });

  it("exposes a random-selection conflict as an API request error", async () => {
    await connectClient(
      {
        stacked: [{ bookmeter_url: "https://bookmeter.com/books/only", book_title: "Only book" }],
        wish: []
      },
      []
    );

    const result = randomizeRecommendation();

    await expect(result).rejects.toBeInstanceOf(ApiRequestError);
    await expect(result).rejects.toMatchObject({ status: 409, code: "no_random_candidate" });
  });
});
