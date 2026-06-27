import { getCurrentSnapshots, getSettings, saveSettings } from "../db/appDb";
import { createSourceBooksRepository } from "../db/sourceBooks";
import { syncSourceBooks } from "../db/sync";
import { ensureBookEmbeddings } from "../embedding/repository";
import { createSemanticScores, embedQuery } from "../embedding/search";
import { promoteRecommendation, runRecommendation, skipRecommendation } from "../recommendation/engine";
import { findRelatedBooks } from "../recommendation/relatedBooks";
import { getCurrentRecommendation } from "../recommendation/store";
import { searchBooks } from "../retrieval/search";

import type { AppDb } from "../db/appDb";
import type { EmbeddingProvider } from "../embedding/types";
import type {
  AppSettings,
  CurrentRecommendation,
  RecommendationReason,
  RowOrderDiagnostics,
  SearchResult
} from "../shared/types";

export type ReadingRecommenderService = {
  readonly sync: () => void;
  readonly run: (reason: RecommendationReason) => CurrentRecommendation | null;
  readonly current: () => CurrentRecommendation | null;
  readonly skip: () => CurrentRecommendation | null;
  readonly promote: (bookmeterUrl: string) => CurrentRecommendation | null;
  readonly search: (query: string, limit?: number) => Promise<readonly SearchResult[]>;
  readonly diagnostics: () => readonly RowOrderDiagnostics[];
  readonly getSettings: () => AppSettings;
  readonly updateSettings: (settings: AppSettings) => AppSettings;
  readonly close: () => void;
};

function currentWithRelated(appDb: AppDb, relatedLimit: number): CurrentRecommendation | null {
  const initial = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

  if (!initial) {
    return null;
  }

  const snapshots = getCurrentSnapshots(appDb.db);
  const primarySnapshot = initial.primary
    ? (snapshots.find((book) => book.bookmeterUrl === initial.primary?.bookmeterUrl) ?? null)
    : null;
  const relatedBooks = findRelatedBooks({ primary: primarySnapshot, candidates: snapshots, limit: relatedLimit });
  return getCurrentRecommendation({ db: appDb.db, relatedBooks });
}

export function createReadingRecommenderService(input: {
  readonly appDb: AppDb;
  readonly booksDbPath: string;
  readonly embeddingProvider?: EmbeddingProvider | null;
}): ReadingRecommenderService {
  const sourceRepository = createSourceBooksRepository(input.booksDbPath);

  return {
    sync() {
      const sourceBooks = sourceRepository.loadCurrentBooks();
      syncSourceBooks({ db: input.appDb.db, booksDbPath: input.booksDbPath, sourceBooks });
    },

    run(reason) {
      const sourceBooks = sourceRepository.loadCurrentBooks();
      syncSourceBooks({ db: input.appDb.db, booksDbPath: input.booksDbPath, sourceBooks });
      const settings = getSettings(input.appDb.db);
      runRecommendation({ db: input.appDb.db, settings, reason });
      return currentWithRelated(input.appDb, settings.relatedCount);
    },

    current() {
      const settings = getSettings(input.appDb.db);
      const current = currentWithRelated(input.appDb, settings.relatedCount);

      if (current) {
        return current;
      }

      return this.run("initial");
    },

    skip() {
      const settings = getSettings(input.appDb.db);
      skipRecommendation({ db: input.appDb.db, settings });
      return currentWithRelated(input.appDb, settings.relatedCount);
    },

    promote(bookmeterUrl) {
      const settings = getSettings(input.appDb.db);
      promoteRecommendation({ db: input.appDb.db, settings, bookmeterUrl });
      return currentWithRelated(input.appDb, settings.relatedCount);
    },

    async search(query, limit) {
      const settings = getSettings(input.appDb.db);
      const resultLimit = limit ?? settings.searchResultCount;

      if (!input.embeddingProvider) {
        return searchBooks({ db: input.appDb.db, query, limit: resultLimit });
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
          return searchBooks({ db: input.appDb.db, query, limit: resultLimit });
        }

        return searchBooks({
          db: input.appDb.db,
          query,
          limit: resultLimit,
          semantic: { scoresByUrl: createSemanticScores({ queryVector, embeddings }) }
        });
      } catch {
        return searchBooks({ db: input.appDb.db, query, limit: resultLimit });
      }
    },

    diagnostics() {
      return sourceRepository.loadRowOrderDiagnostics(5);
    },

    getSettings() {
      return getSettings(input.appDb.db);
    },

    updateSettings(settings) {
      saveSettings(input.appDb.db, settings);
      return settings;
    },

    close() {
      sourceRepository.close();
      input.appDb.close();
    }
  };
}
