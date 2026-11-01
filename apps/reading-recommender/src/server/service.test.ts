import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentSnapshots, getSettings, openAppDb } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";
import { ensureBookEmbeddings } from "../embedding/repository";
import { runRecommendation } from "../recommendation/engine";

import { createReadingRecommenderService } from "./service";

import type { EmbeddingProvider } from "../embedding/types";
import type { LearningPathPlanner, LearningPathPlanResult } from "../learningPath/types";
import type { SourceBook } from "../shared/types";

function book(input: Partial<SourceBook> & Pick<SourceBook, "bookmeterUrl" | "title" | "remoteRank">): SourceBook {
  return {
    isbnOrAsin: null,
    author: "別著者",
    publisher: "別出版社",
    publishedDate: "2024",
    description: "",
    inWish: false,
    inStacked: true,
    sophiaLibraryStatus: "unknown",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "",
    utokyoOpacUrl: "",
    wishRowid: null,
    stackedRowid: input.remoteRank,
    remoteRankSource: "stacked",
    ...input
  };
}

function createSourceDb(path: string): void {
  const db = new Database(path);
  db.close();
}

function createSourceDbWithBooks(path: string, books: readonly SourceBook[]): void {
  const db = new Database(path);
  const createTable = (tableName: "wish" | "stacked"): void => {
    db.exec(`CREATE TABLE ${tableName} (
      bookmeter_url TEXT PRIMARY KEY,
      isbn_or_asin TEXT,
      book_title TEXT,
      author TEXT,
      publisher TEXT,
      published_date TEXT,
      sophia_opac TEXT,
      utokyo_opac TEXT,
      exist_in_Sophia TEXT,
      exist_in_UTokyo TEXT,
      sophia_mathlib_opac TEXT,
      description TEXT
    )`);
  };
  createTable("wish");
  createTable("stacked");

  for (const sourceBook of books) {
    db.prepare(
      `INSERT INTO stacked (
        bookmeter_url,
        isbn_or_asin,
        book_title,
        author,
        publisher,
        published_date,
        description
      )
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sourceBook.bookmeterUrl,
      sourceBook.isbnOrAsin,
      sourceBook.title,
      sourceBook.author,
      sourceBook.publisher,
      sourceBook.publishedDate,
      sourceBook.description
    );
  }

  db.close();
}

function insertStackedBook(path: string, sourceBook: SourceBook): void {
  const db = new Database(path);
  db.prepare(
    `INSERT INTO stacked (
      bookmeter_url,
      isbn_or_asin,
      book_title,
      author,
      publisher,
      published_date,
      description
    )
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sourceBook.bookmeterUrl,
    sourceBook.isbnOrAsin,
    sourceBook.title,
    sourceBook.author,
    sourceBook.publisher,
    sourceBook.publishedDate,
    sourceBook.description
  );
  db.close();
}

function deleteStackedBook(path: string, bookmeterUrl: string): void {
  const db = new Database(path);
  try {
    db.prepare("DELETE FROM stacked WHERE bookmeter_url = ?").run(bookmeterUrl);
  } finally {
    db.close();
  }
}

function cycleCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM recommendation_cycle").get() as { readonly count: number };
  return row.count;
}

function mockEmbeddingProvider(): EmbeddingProvider {
  return {
    providerId: "mock",
    modelId: "mock-related",
    dimension: 2,
    embed(input) {
      return Promise.resolve(
        input.texts.map((text) => {
          if (text.startsWith("title: 臨床 試験\n")) {
            return Float32Array.from([1, 0]);
          }
          if (text.startsWith("title: ベイズ 推論\n")) {
            return Float32Array.from([0.95, 0.05]);
          }
          return Float32Array.from([0, 1]);
        })
      );
    }
  };
}

function mockLearningPathPlanner(): LearningPathPlanner & {
  readonly plan: ReturnType<typeof vi.fn<LearningPathPlanner["plan"]>>;
} {
  return {
    id: "anthropic",
    label: "Claude",
    modelId: "requested-model",
    plan: vi.fn<LearningPathPlanner["plan"]>(() =>
      Promise.resolve({
        modelId: "actual-model",
        output: {
          overview: "定義から学びます。",
          stages: [{ title: "基礎", goal: "定義を理解する", books: [{ id: "b1", reason: "定義を学べます。" }] }],
          gaps: ["応用の本がありません。"]
        }
      })
    )
  };
}

describe("reading recommender service", () => {
  const tempDirs = new Set<string>();

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  function learningPathFixture(
    books: readonly SourceBook[],
    embeddingProvider?: EmbeddingProvider
  ): {
    readonly appDb: ReturnType<typeof openAppDb>;
    readonly sourceDbPath: string;
    readonly service: ReturnType<typeof createReadingRecommenderService>;
    readonly planner: ReturnType<typeof mockLearningPathPlanner>;
  } {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-learning-path-"));
    tempDirs.add(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    createSourceDbWithBooks(sourceDbPath, books);
    const appDb = openAppDb(join(dir, "app.sqlite"));
    syncSourceBooks({ db: appDb.db, booksDbPath: sourceDbPath, sourceBooks: books });
    const planner = mockLearningPathPlanner();
    const service = createReadingRecommenderService({
      appDb,
      booksDbPath: sourceDbPath,
      embeddingProvider,
      learningPathPlanners: [planner]
    });
    return { appDb, sourceDbPath, service, planner };
  }

  it("lists enabled planners and creates a path using their actual response model", async () => {
    const sourceBook = book({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 });
    const { service, planner } = learningPathFixture([sourceBook]);

    try {
      const result = await service.createLearningPath("圏論", "anthropic");

      expect(service.listLearningPathPlanners()).toEqual([
        { id: "anthropic", label: "Claude", modelId: "requested-model" }
      ]);
      expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
        topic: "圏論",
        candidates: [{ id: "b1", book: sourceBook }]
      });
      expect(result).toMatchObject({
        status: "created",
        learningPath: {
          topic: "圏論",
          overview: "定義から学びます。",
          stages: [
            {
              title: "基礎",
              goal: "定義を理解する",
              books: [{ ...sourceBook, reason: "定義を学べます。" }]
            }
          ],
          gaps: ["応用の本がありません。"],
          planner: { id: "anthropic", label: "Claude", modelId: "actual-model" }
        }
      });
    } finally {
      service.close();
    }
  });

  it("reports an unavailable planner without invoking a configured planner", async () => {
    const { service, planner } = learningPathFixture([]);

    try {
      expect(await service.createLearningPath("圏論", "openai")).toEqual({ status: "planner_unavailable" });
      expect(planner.plan).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  });

  it("reports no candidates when the current list has no relevant lexical books", async () => {
    const { service, planner } = learningPathFixture([
      book({ bookmeterUrl: "history", title: "日本の近代史", remoteRank: 1 })
    ]);

    try {
      expect(await service.createLearningPath("圏論", "anthropic")).toEqual({ status: "no_candidates" });
      expect(planner.plan).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  });

  it("preserves a planner rejection as the failure cause", async () => {
    const { service, planner } = learningPathFixture([
      book({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 })
    ]);
    const cause = new Error("private provider response");
    planner.plan.mockRejectedValue(cause);

    try {
      expect(await service.createLearningPath("圏論", "anthropic")).toEqual({ status: "planner_failed", cause });
    } finally {
      service.close();
    }
  });

  it("uses low-similarity current books and excludes deleted books from the embedding cache", async () => {
    const retained = book({ bookmeterUrl: "retained", title: "測度と積分", remoteRank: 1 });
    const deleted = book({ bookmeterUrl: "deleted", title: "削除された本", remoteRank: 2 });
    const provider: EmbeddingProvider = {
      providerId: "fake",
      modelId: "semantic",
      dimension: 2,
      embed: ({ texts, kind }) =>
        Promise.resolve(texts.map(() => Float32Array.from(kind === "query" ? [1, 0] : [0.4, 0.9])))
    };
    const { appDb, sourceDbPath, service, planner } = learningPathFixture([retained, deleted], provider);

    try {
      await ensureBookEmbeddings({ db: appDb.db, provider, books: getCurrentSnapshots(appDb.db) });
      deleteStackedBook(sourceDbPath, "deleted");
      const result = await service.createLearningPath("確率論", "anthropic");

      expect(result.status).toBe("created");
      expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
        topic: "確率論",
        candidates: [{ id: "b1", book: { bookmeterUrl: "retained" } }]
      });
    } finally {
      service.close();
    }
  });

  it("keeps lexical candidates when query embedding returns no vector", async () => {
    const provider: EmbeddingProvider = {
      providerId: "fake",
      modelId: "empty-query",
      dimension: 2,
      embed: ({ texts, kind }) => Promise.resolve(kind === "query" ? [] : texts.map(() => Float32Array.from([1, 0])))
    };
    const { service, planner } = learningPathFixture(
      [
        book({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 }),
        book({ bookmeterUrl: "history", title: "日本の近代史", remoteRank: 2 })
      ],
      provider
    );

    try {
      expect((await service.createLearningPath("圏論", "anthropic")).status).toBe("created");
      expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
        topic: "圏論",
        candidates: [{ id: "b1", book: { bookmeterUrl: "category" } }]
      });
    } finally {
      service.close();
    }
  });

  it.each(["document", "query"] as const)(
    "propagates %s embedding rejection without calling the planner",
    async (failedKind) => {
      const cause = new Error("embedding unavailable");
      const provider: EmbeddingProvider = {
        providerId: "fake",
        modelId: "rejected-embedding",
        dimension: 2,
        embed: ({ texts, kind }) =>
          kind === failedKind ? Promise.reject(cause) : Promise.resolve(texts.map(() => Float32Array.from([1, 0])))
      };
      const { service, planner } = learningPathFixture(
        [book({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 })],
        provider
      );

      try {
        await expect(service.createLearningPath("圏論", "anthropic")).rejects.toBe(cause);
        expect(planner.plan).not.toHaveBeenCalled();
      } finally {
        service.close();
      }
    }
  );

  it("syncs and reconciles source changes before preparing learning-path candidates", async () => {
    const { appDb, sourceDbPath, service, planner } = learningPathFixture([
      book({ bookmeterUrl: "original", title: "圏論入門", remoteRank: 1 })
    ]);

    try {
      const before = await service.run("initial");
      insertStackedBook(sourceDbPath, book({ bookmeterUrl: "new", title: "圏論講義", remoteRank: 2 }));
      deleteStackedBook(sourceDbPath, "original");
      await service.createLearningPath("圏論", "anthropic");
      const current = await service.current();
      const completionEvents = appDb.db
        .prepare("SELECT bookmeter_url, cycle_id, reason FROM recommendation_event WHERE event_type = ?")
        .all("primary_completed_by_db_absence");

      expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
        topic: "圏論",
        candidates: [{ id: "b1", book: { bookmeterUrl: "new" } }]
      });
      expect(completionEvents).toEqual([
        { bookmeter_url: "original", cycle_id: before?.cycleId, reason: "source_changed" }
      ]);
      expect(current?.primary?.bookmeterUrl).toBe("new");
      expect(current?.reason).toBe("source_changed");
      expect(await service.runIfSourceChanged()).toEqual({ changed: false, current });
    } finally {
      service.close();
    }
  });

  it("allows queued reads and source sync during a pending plan while preserving its captured books", async () => {
    const sourceBook = book({ bookmeterUrl: "original", title: "圏論入門", remoteRank: 1 });
    const { sourceDbPath, service, planner } = learningPathFixture([sourceBook]);
    const started = Promise.withResolvers<void>();
    const planned = Promise.withResolvers<LearningPathPlanResult>();
    const response: LearningPathPlanResult = {
      modelId: "actual-model",
      output: {
        overview: "定義から学びます。",
        stages: [{ title: "基礎", goal: "定義を理解する", books: [{ id: "b1", reason: "定義を学べます。" }] }],
        gaps: []
      }
    };
    planner.plan.mockImplementation(() => {
      started.resolve();
      return planned.promise;
    });
    await service.run("initial");
    const pending = service.createLearningPath("圏論", "anthropic");

    try {
      await started.promise;
      expect(await service.current()).not.toBeNull();
      const sourceDb = new Database(sourceDbPath);
      try {
        sourceDb.prepare("UPDATE stacked SET book_title = ? WHERE bookmeter_url = ?").run("圏論の改訂版", "original");
      } finally {
        sourceDb.close();
      }
      expect((await service.runIfSourceChanged()).changed).toBe(true);
      planned.resolve(response);
      const result = await pending;

      expect(result.status).toBe("created");
      expect(result.status === "created" ? result.learningPath.stages[0]?.books[0]?.title : null).toBe("圏論入門");
      expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
        topic: "圏論",
        candidates: [{ id: "b1", book: { title: "圏論入門" } }]
      });
    } finally {
      planned.resolve(response);
      await pending;
      service.close();
    }
  });

  it("uses document embeddings for related books when a provider is available", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.add(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    createSourceDb(sourceDbPath);
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const books = [
      book({ bookmeterUrl: "primary", title: "臨床 試験", remoteRank: 10 }),
      book({ bookmeterUrl: "lexical", title: "臨床 試験 入門", remoteRank: 2 }),
      book({ bookmeterUrl: "semantic", title: "ベイズ 推論", remoteRank: 9 })
    ];

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
    const service = createReadingRecommenderService({
      appDb,
      booksDbPath: sourceDbPath,
      embeddingProvider: mockEmbeddingProvider()
    });

    try {
      const current = await service.current();

      expect(current?.primary?.bookmeterUrl).toBe("primary");
      expect(current?.relatedBooks.map((item) => item.bookmeterUrl)).toEqual(["semantic", "lexical"]);
      expect(current?.relatedBooks[0]?.reasons).toContain("説明文の意味が近い候補です。");
    } finally {
      service.close();
    }
  });

  it("reconciles a removed primary before searching and leaves no source change for the watcher", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.add(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    const appDb = openAppDb(join(dir, "app.sqlite"));
    createSourceDbWithBooks(sourceDbPath, [
      book({ bookmeterUrl: "remaining", title: "次の候補", remoteRank: 1 }),
      book({ bookmeterUrl: "primary", title: "現在の候補", remoteRank: 2 })
    ]);
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    try {
      const before = await service.current();
      deleteStackedBook(sourceDbPath, "primary");
      const results = await service.search("候補");
      const current = await service.current();
      const completionEvents = appDb.db
        .prepare("SELECT bookmeter_url, cycle_id, reason FROM recommendation_event WHERE event_type = ?")
        .all("primary_completed_by_db_absence");

      expect(before?.primary?.bookmeterUrl).toBe("primary");
      expect(results.map((result) => result.bookmeterUrl)).toEqual(["remaining"]);
      expect(completionEvents).toEqual([
        { bookmeter_url: "primary", cycle_id: before?.cycleId, reason: "source_changed" }
      ]);
      expect(current?.primary?.bookmeterUrl).toBe("remaining");
      expect(current?.reason).toBe("source_changed");
      expect(current?.cycleId).not.toBe(before?.cycleId);
      expect(await service.runIfSourceChanged()).toEqual({ changed: false, current });
    } finally {
      service.close();
    }
  });

  it("records primary completion before randomizing the reconciled cycle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.add(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    const appDb = openAppDb(join(dir, "app.sqlite"));
    createSourceDbWithBooks(sourceDbPath, [
      book({ bookmeterUrl: "candidate", title: "確率論", remoteRank: 1 }),
      book({ bookmeterUrl: "secondary-3", title: "統計学", remoteRank: 2 }),
      book({ bookmeterUrl: "secondary-2", title: "代数学", remoteRank: 3 }),
      book({ bookmeterUrl: "secondary-1", title: "幾何学", remoteRank: 4 }),
      book({ bookmeterUrl: "primary", title: "解析学", remoteRank: 5 })
    ]);
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    try {
      const before = await service.current();
      deleteStackedBook(sourceDbPath, "primary");
      const result = await service.randomize();
      const current = await service.current();
      const events = appDb.db
        .prepare(
          `SELECT event_type, bookmeter_url, cycle_id, reason FROM recommendation_event
           WHERE event_type IN (?, ?) ORDER BY id`
        )
        .all("primary_completed_by_db_absence", "primary_randomized");

      expect(before?.primary?.bookmeterUrl).toBe("primary");
      expect(result).toEqual({ status: "selected", current });
      expect(events).toEqual([
        {
          event_type: "primary_completed_by_db_absence",
          bookmeter_url: "primary",
          cycle_id: before?.cycleId,
          reason: "source_changed"
        },
        {
          event_type: "primary_randomized",
          bookmeter_url: "candidate",
          cycle_id: current?.cycleId,
          reason: "random"
        }
      ]);
      expect(current?.primary?.bookmeterUrl).toBe("candidate");
      expect(current?.reason).toBe("source_changed");
      expect(current?.cycleId).not.toBe(before?.cycleId);
      expect(await service.runIfSourceChanged()).toEqual({ changed: false, current });
    } finally {
      service.close();
    }
  });

  it("syncs the source before selecting a random recommendation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.add(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    const appDb = openAppDb(join(dir, "app.sqlite"));
    createSourceDbWithBooks(sourceDbPath, [
      book({ bookmeterUrl: "book-1", title: "候補1", remoteRank: 3 }),
      book({ bookmeterUrl: "book-2", title: "候補2", remoteRank: 2 }),
      book({ bookmeterUrl: "book-3", title: "候補3", remoteRank: 1 })
    ]);
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    try {
      const before = await service.current();
      insertStackedBook(sourceDbPath, book({ bookmeterUrl: "new-book", title: "新しい候補", remoteRank: 4 }));
      const result = await service.randomize();

      expect(result.status).toBe("selected");
      expect(result.status === "selected" ? result.current.primary?.bookmeterUrl : null).toBe("book-1");
      expect(result.status === "selected" ? result.current.secondaries.map((item) => item.bookmeterUrl) : []).toContain(
        "new-book"
      );
      expect(result.status === "selected" ? result.current.cycleId : null).not.toBe(before?.cycleId);
      expect(result.status === "selected" ? result.current.reason : null).toBe("source_changed");
    } finally {
      service.close();
    }
  });

  it("does not create the same scheduled cycle twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.add(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    const appDb = openAppDb(join(dir, "app.sqlite"));
    createSourceDbWithBooks(sourceDbPath, [
      book({ bookmeterUrl: "primary", title: "定期推薦", remoteRank: 10 }),
      book({ bookmeterUrl: "secondary", title: "副推薦", remoteRank: 9 })
    ]);
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    try {
      await service.runScheduled("2026-06-28T22:30:00Z");
      await service.runScheduled("2026-06-28T22:30:00Z");
      const row = appDb.db
        .prepare("SELECT scheduled_for FROM recommendation_cycle WHERE reason = ?")
        .get("scheduled") as { readonly scheduled_for: string } | undefined;

      expect(cycleCount(appDb.db)).toBe(1);
      expect(row?.scheduled_for).toBe("2026-06-28T22:30:00Z");
    } finally {
      service.close();
    }
  });

  it("runs a source-changed recommendation only when the source hash changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
    tempDirs.add(dir);
    const sourceDbPath = join(dir, "source.sqlite");
    const appDb = openAppDb(join(dir, "app.sqlite"));
    createSourceDbWithBooks(sourceDbPath, [
      book({ bookmeterUrl: "primary", title: "初回推薦", remoteRank: 10 }),
      book({ bookmeterUrl: "secondary", title: "副推薦", remoteRank: 9 })
    ]);
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    try {
      await service.run("initial");
      const unchanged = await service.runIfSourceChanged();
      insertStackedBook(sourceDbPath, book({ bookmeterUrl: "new-book", title: "前倒し推薦", remoteRank: 8 }));
      const changed = await service.runIfSourceChanged();
      const latestCycle = appDb.db.prepare("SELECT reason FROM recommendation_cycle ORDER BY id DESC LIMIT 1").get() as
        | { readonly reason: string }
        | undefined;

      expect(unchanged.changed).toBe(false);
      expect(changed.changed).toBe(true);
      expect(latestCycle?.reason).toBe("source_changed");
    } finally {
      service.close();
    }
  });
});
