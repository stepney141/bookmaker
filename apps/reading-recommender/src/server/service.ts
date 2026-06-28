import { getCurrentSnapshots, getSettings, saveSettings } from "../db/appDb";
import { createSourceBooksRepository } from "../db/sourceBooks";
import { syncSourceBooks, syncSourceBooksIfChanged } from "../db/sync";
import { createRelatedSemanticScores } from "../embedding/related";
import { ensureBookEmbeddings } from "../embedding/repository";
import { createSemanticScores, embedQuery } from "../embedding/search";
import { promoteRecommendation, runRecommendation, skipRecommendation } from "../recommendation/engine";
import { findRelatedBooks } from "../recommendation/relatedBooks";
import { getCurrentRecommendation, getLatestScheduledFor as selectLatestScheduledFor, hasScheduledCycle } from "../recommendation/store";
import { searchBooks } from "../retrieval/search";

import type { AppDb } from "../db/appDb";
import type { EmbeddingProvider } from "../embedding/types";
import type {
  AppSettings,
  CurrentRecommendation,
  RecommendationReason,
  RowOrderDiagnostics,
  SearchFilters,
  SearchResult,
  SourceBook
} from "../shared/types";

export type SourceChangeRunResult = {
  readonly changed: boolean;
  readonly current: CurrentRecommendation | null;
};

export type ReadingRecommenderService = {
  readonly sync: () => void;
  readonly run: (reason: RecommendationReason) => Promise<CurrentRecommendation | null>;
  readonly runScheduled: (scheduledFor: string) => Promise<CurrentRecommendation | null>;
  readonly runIfSourceChanged: () => Promise<SourceChangeRunResult>;
  readonly current: () => Promise<CurrentRecommendation | null>;
  readonly skip: () => Promise<CurrentRecommendation | null>;
  readonly promote: (bookmeterUrl: string) => Promise<CurrentRecommendation | null>;
  readonly search: (query: string, limit?: number, filters?: SearchFilters) => Promise<readonly SearchResult[]>;
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
}): ReadingRecommenderService {
  let mutationQueue: Promise<void> = Promise.resolve();
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

  async function currentInternal(): Promise<CurrentRecommendation | null> {
    const settings = getSettings(input.appDb.db);
    const current = await currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider);

    if (current) {
      return current;
    }

    return runInternal("initial", null);
  }

  async function runInternal(reason: RecommendationReason, scheduledFor: string | null): Promise<CurrentRecommendation | null> {
    const sourceBooks = loadCurrentSourceBooks();
    syncSourceBooks({ db: input.appDb.db, booksDbPath: input.booksDbPath, sourceBooks });
    const settings = getSettings(input.appDb.db);
    runRecommendation({ db: input.appDb.db, settings, reason, scheduledFor });
    return currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider);
  }

  return {
    sync() {
      void enqueueMutation(() => {
        const sourceBooks = loadCurrentSourceBooks();
        syncSourceBooks({ db: input.appDb.db, booksDbPath: input.booksDbPath, sourceBooks });
      }).catch(() => undefined);
    },

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
        const sourceBooks = loadCurrentSourceBooks();
        const syncResult = syncSourceBooksIfChanged({ db: input.appDb.db, booksDbPath: input.booksDbPath, sourceBooks });
        const settings = getSettings(input.appDb.db);

        if (!syncResult) {
          return {
            changed: false,
            current: await currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider)
          };
        }

        runRecommendation({ db: input.appDb.db, settings, reason: "source_changed" });
        return {
          changed: true,
          current: await currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider)
        };
      });
    },

    async current() {
      return enqueueMutation(currentInternal);
    },

    async skip() {
      return enqueueMutation(() => {
        const settings = getSettings(input.appDb.db);
        skipRecommendation({ db: input.appDb.db, settings });
        return currentWithRelated(input.appDb, settings.relatedCount, input.embeddingProvider);
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
        const sourceBooks = loadCurrentSourceBooks();
        syncSourceBooksIfChanged({ db: input.appDb.db, booksDbPath: input.booksDbPath, sourceBooks });
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
