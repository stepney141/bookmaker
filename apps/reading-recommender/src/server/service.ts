import { getCurrentSnapshots, getSettings, saveSettings } from "./db/appDb";
import { createSourceBooksRepository } from "./db/sourceBooks";
import { syncSourceBooks, syncSourceBooksIfChanged } from "./db/sync";
import { createRelatedSemanticScores } from "./embedding/related";
import { ensureBookEmbeddings } from "./embedding/repository";
import { createSemanticScores, embedQuery } from "./embedding/search";
import { mergeLearningPathCandidates } from "./learningPath/candidates";
import { normalizeLearningPath } from "./learningPath/normalize";
import { promoteRecommendation, randomizeRecommendation, runRecommendation } from "./recommendation/engine";
import { findRelatedBooks } from "./recommendation/relatedBooks";
import {
  getCurrentRecommendation,
  getLatestScheduledFor as selectLatestScheduledFor,
  hasScheduledCycle
} from "./recommendation/store";
import { searchBooks } from "./retrieval/search";

import type { AppDb } from "./db/appDb";
import type { EmbeddingProvider } from "./embedding/types";
import type { LearningPathCandidate, LearningPathPlanner } from "./learningPath/types";
import type {
  AppSettings,
  CurrentRecommendation,
  LearningPath,
  LearningPathPlannerId,
  LearningPathPlannerInfo,
  RecommendationReason,
  RowOrderDiagnostics,
  SearchFilters,
  SearchResult,
  SourceBook
} from "../types/api";

export type SourceChangeRunResult = {
  readonly changed: boolean;
  readonly current: CurrentRecommendation | null;
};

export type RandomizeResult =
  | { readonly status: "selected"; readonly current: CurrentRecommendation }
  | { readonly status: "no_active_recommendation" | "no_random_candidate" };

export type LearningPathResult =
  | { readonly status: "created"; readonly learningPath: LearningPath }
  | { readonly status: "planner_unavailable" | "no_candidates" }
  | { readonly status: "planner_failed"; readonly cause: unknown };

export type ReadingRecommenderService = {
  readonly run: (reason: RecommendationReason) => Promise<CurrentRecommendation | null>;
  readonly runScheduled: (scheduledFor: string) => Promise<CurrentRecommendation | null>;
  readonly runIfSourceChanged: () => Promise<SourceChangeRunResult>;
  readonly current: () => Promise<CurrentRecommendation | null>;
  readonly randomize: () => Promise<RandomizeResult>;
  readonly promote: (bookmeterUrl: string) => Promise<CurrentRecommendation | null>;
  readonly search: (query: string, limit?: number, filters?: SearchFilters) => Promise<readonly SearchResult[]>;
  readonly listLearningPathPlanners: () => readonly LearningPathPlannerInfo[];
  readonly createLearningPath: (topic: string, plannerId: LearningPathPlannerId) => Promise<LearningPathResult>;
  readonly diagnostics: () => readonly RowOrderDiagnostics[];
  readonly getSettings: () => AppSettings;
  readonly getLatestScheduledFor: () => string | null;
  readonly updateSettings: (settings: AppSettings) => AppSettings;
  readonly onSettingsChanged: (listener: () => void) => () => void;
  readonly onClose: (listener: () => void) => () => void;
  readonly close: () => void;
};

async function currentWithRelated(
  appDb: AppDb,
  relatedLimit: number,
  embeddingProvider: EmbeddingProvider | null | undefined
): Promise<CurrentRecommendation | null> {
  const initial = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

  if (!initial) {
    return null;
  }

  const snapshots = getCurrentSnapshots(appDb.db);
  const primarySnapshot = initial.primary
    ? (snapshots.find((book) => book.bookmeterUrl === initial.primary?.bookmeterUrl) ?? null)
    : null;
  let semanticScoresByUrl: ReadonlyMap<string, number> | undefined;

  if (embeddingProvider && primarySnapshot) {
    try {
      const embeddings = await ensureBookEmbeddings({
        db: appDb.db,
        provider: embeddingProvider,
        books: snapshots
      });
      const scores = createRelatedSemanticScores({
        primaryBookmeterUrl: primarySnapshot.bookmeterUrl,
        embeddings
      });
      semanticScoresByUrl = scores.size > 0 ? scores : undefined;
    } catch {
      semanticScoresByUrl = undefined;
    }
  }

  const relatedBooks = findRelatedBooks({
    primary: primarySnapshot,
    candidates: snapshots,
    limit: relatedLimit,
    semanticScoresByUrl
  });
  return getCurrentRecommendation({ db: appDb.db, relatedBooks });
}

export function createReadingRecommenderService(input: {
  readonly appDb: AppDb;
  readonly booksDbPath: string;
  readonly embeddingProvider?: EmbeddingProvider | null;
  readonly learningPathPlanners?: readonly LearningPathPlanner[];
}): ReadingRecommenderService {
  let mutationQueue: Promise<void> = Promise.resolve();
  const learningPathPlanners = input.learningPathPlanners ?? [];
  const settingsListeners = new Set<() => void>();
  const closeListeners = new Set<() => void>();

  function enqueueMutation<T>(task: () => Promise<T> | T): Promise<T> {
    const next = mutationQueue.then(task, task);
    mutationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  function loadCurrentSourceBooks(): readonly SourceBook[] {
    const sourceRepository = createSourceBooksRepository(input.booksDbPath);
    try {
      return sourceRepository.loadCurrentBooks();
    } finally {
      sourceRepository.close();
    }
  }

  function syncSourceAndReconcileIfChanged(): boolean {
    const sourceBooks = loadCurrentSourceBooks();
    const syncResult = syncSourceBooksIfChanged({
      db: input.appDb.db,
      booksDbPath: input.booksDbPath,
      sourceBooks
    });

    if (!syncResult) {
      return false;
    }

    runRecommendation({ db: input.appDb.db, settings: getSettings(input.appDb.db), reason: "source_changed" });
    return true;
  }

  async function currentInternal(): Promise<CurrentRecommendation | null> {
    const settings = getSettings(input.appDb.db);
    const current = await currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider);

    if (current) {
      return current;
    }

    return runInternal("initial", null);
  }

  async function runInternal(
    reason: RecommendationReason,
    scheduledFor: string | null
  ): Promise<CurrentRecommendation | null> {
    const sourceBooks = loadCurrentSourceBooks();
    syncSourceBooks({ db: input.appDb.db, booksDbPath: input.booksDbPath, sourceBooks });
    const settings = getSettings(input.appDb.db);
    runRecommendation({ db: input.appDb.db, settings, reason, scheduledFor });
    return currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider);
  }

  async function prepareLearningPathCandidates(topic: string): Promise<readonly LearningPathCandidate[]> {
    syncSourceAndReconcileIfChanged();
    const snapshots = getCurrentSnapshots(input.appDb.db);
    const snapshotsByUrl = new Map(snapshots.map((book) => [book.bookmeterUrl, book]));
    const lexical = searchBooks({ db: input.appDb.db, query: topic, limit: 15 }).flatMap((result) => {
      const snapshot = snapshotsByUrl.get(result.bookmeterUrl);
      return snapshot ? [snapshot] : [];
    });
    let semanticScores: ReadonlyMap<string, number> = new Map();

    if (input.embeddingProvider) {
      const embeddings = await ensureBookEmbeddings({
        db: input.appDb.db,
        provider: input.embeddingProvider,
        books: snapshots
      });
      const queryVector = await embedQuery({ provider: input.embeddingProvider, query: topic });

      if (queryVector) {
        semanticScores = createSemanticScores({ queryVector, embeddings });
      }
    }

    const semantic = snapshots.flatMap((book) => {
      const score = semanticScores.get(book.bookmeterUrl);
      return score === undefined ? [] : [{ book, score }];
    });
    return mergeLearningPathCandidates({ lexical, semantic, limit: 40 }).map((book, index) => ({
      id: `b${index + 1}`,
      book
    }));
  }

  return {
    async run(reason) {
      return enqueueMutation(() => runInternal(reason, null));
    },

    async runScheduled(scheduledFor) {
      return enqueueMutation(async () => {
        if (hasScheduledCycle(input.appDb.db, scheduledFor)) {
          return currentInternal();
        }

        return runInternal("scheduled", scheduledFor);
      });
    },

    async runIfSourceChanged() {
      return enqueueMutation(async () => {
        const changed = syncSourceAndReconcileIfChanged();
        const settings = getSettings(input.appDb.db);

        return {
          changed,
          current: await currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider)
        };
      });
    },

    async current() {
      return enqueueMutation(currentInternal);
    },

    async randomize() {
      return enqueueMutation(async () => {
        syncSourceAndReconcileIfChanged();
        const settings = getSettings(input.appDb.db);
        const result = randomizeRecommendation({ db: input.appDb.db, settings, randomValue: Math.random() });

        if (result.status !== "selected") {
          return result;
        }

        const current = await currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider);

        if (!current) {
          throw new Error("Random recommendation was saved without an active recommendation");
        }

        return { status: "selected" as const, current };
      });
    },

    async promote(bookmeterUrl) {
      return enqueueMutation(() => {
        const settings = getSettings(input.appDb.db);
        promoteRecommendation({ db: input.appDb.db, settings, bookmeterUrl });
        return currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider);
      });
    },

    async search(query, limit, filters) {
      return enqueueMutation(async () => {
        syncSourceAndReconcileIfChanged();
        const settings = getSettings(input.appDb.db);
        const resultLimit = limit ?? settings.searchResultCount;

        if (!input.embeddingProvider) {
          return searchBooks({ db: input.appDb.db, query, limit: resultLimit, filters });
        }

        try {
          const snapshots = getCurrentSnapshots(input.appDb.db);
          const embeddings = await ensureBookEmbeddings({
            db: input.appDb.db,
            provider: input.embeddingProvider,
            books: snapshots
          });
          const queryVector = await embedQuery({ provider: input.embeddingProvider, query });

          if (!queryVector) {
            return searchBooks({ db: input.appDb.db, query, limit: resultLimit, filters });
          }

          return searchBooks({
            db: input.appDb.db,
            query,
            limit: resultLimit,
            filters,
            semantic: { scoresByUrl: createSemanticScores({ queryVector, embeddings }) }
          });
        } catch {
          return searchBooks({ db: input.appDb.db, query, limit: resultLimit, filters });
        }
      });
    },

    listLearningPathPlanners() {
      return learningPathPlanners.map(({ id, label, modelId }) => ({ id, label, modelId }));
    },

    async createLearningPath(topic, plannerId) {
      const planner = learningPathPlanners.find(({ id }) => id === plannerId);

      if (!planner) {
        return { status: "planner_unavailable" };
      }

      const candidates = await enqueueMutation(() => prepareLearningPathCandidates(topic));

      if (candidates.length === 0) {
        return { status: "no_candidates" };
      }

      // The captured candidates remain stable while other queued work proceeds.
      try {
        const { output, modelId } = await planner.plan({ topic, candidates });
        return {
          status: "created",
          learningPath: normalizeLearningPath({
            topic,
            planner: { id: planner.id, label: planner.label, modelId },
            candidates,
            output
          })
        };
      } catch (cause) {
        return { status: "planner_failed", cause };
      }
    },

    diagnostics() {
      const sourceRepository = createSourceBooksRepository(input.booksDbPath);
      try {
        return sourceRepository.loadRowOrderDiagnostics(5);
      } finally {
        sourceRepository.close();
      }
    },

    getSettings() {
      return getSettings(input.appDb.db);
    },

    getLatestScheduledFor() {
      return selectLatestScheduledFor(input.appDb.db);
    },

    updateSettings(settings) {
      saveSettings(input.appDb.db, settings);
      for (const listener of settingsListeners) {
        listener();
      }
      return settings;
    },

    onSettingsChanged(listener) {
      settingsListeners.add(listener);
      return () => {
        settingsListeners.delete(listener);
      };
    },

    onClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },

    close() {
      for (const listener of closeListeners) {
        listener();
      }
      input.appDb.close();
    }
  };
}
