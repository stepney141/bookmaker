
import { getCurrentSnapshots, insertRecommendationEvent } from "../db/appDb";

import { findEarlierSeriesCandidate, scoreBooks, type ScoredBook } from "./scoring";
import { getActiveCycleId, saveRecommendationSelection, type RecommendationSelection } from "./store";

import type { AppSettings, BookSnapshot, RecommendationReason } from "../shared/types";
import type Database from "better-sqlite3";

type ActiveItemRow = {
  readonly slot: "primary" | "secondary";
  readonly rank: number;
  readonly bookmeter_url: string;
};

function activeItems(db: Database.Database): readonly ActiveItemRow[] {
  const cycleId = getActiveCycleId(db);

  if (!cycleId) {
    return [];
  }

  return db
    .prepare("SELECT slot, rank, bookmeter_url FROM recommendation_item WHERE cycle_id = ? ORDER BY slot ASC, rank ASC")
    .all(cycleId) as readonly ActiveItemRow[];
}

function chooseSelection(scoredBooks: readonly ScoredBook[], secondaryCount: number, excludedUrls: ReadonlySet<string>): RecommendationSelection | null {
  const available = scoredBooks.filter((book) => !excludedUrls.has(book.bookmeterUrl));
  const primary = available[0];

  if (!primary) {
    return null;
  }

  return {
    primary,
    secondaries: available.filter((book) => book.bookmeterUrl !== primary.bookmeterUrl).slice(0, secondaryCount)
  };
}

function chooseSelectionWithPrimary(input: {
  readonly primary: ScoredBook;
  readonly scoredBooks: readonly ScoredBook[];
  readonly secondaryCount: number;
}): RecommendationSelection {
  return {
    primary: input.primary,
    secondaries: input.scoredBooks
      .filter((book) => book.bookmeterUrl !== input.primary.bookmeterUrl)
      .slice(0, input.secondaryCount)
  };
}

function findByUrl<T extends BookSnapshot>(books: readonly T[], url: string | null): T | null {
  if (!url) {
    return null;
  }

  return books.find((book) => book.bookmeterUrl === url) ?? null;
}

export function runRecommendation(input: {
  readonly db: Database.Database;
  readonly settings: AppSettings;
  readonly reason: RecommendationReason;
  readonly scheduledFor?: string | null;
}): number | null {
  const currentSnapshots = getCurrentSnapshots(input.db);
  const scoredBooks = scoreBooks(currentSnapshots, input.settings);
  const existingItems = activeItems(input.db);
  const activeCycleId = getActiveCycleId(input.db);
  const primaryUrl = existingItems.find((item) => item.slot === "primary")?.bookmeter_url ?? null;
  const activePrimary = findByUrl(scoredBooks, primaryUrl);
  const earlierSeriesPrimary = activePrimary
    ? findEarlierSeriesCandidate({ book: activePrimary, candidates: scoredBooks })
    : null;

  if (activePrimary && !earlierSeriesPrimary) {
    const selection = chooseSelectionWithPrimary({
      primary: activePrimary,
      scoredBooks,
      secondaryCount: input.settings.secondaryCount
    });
    return saveRecommendationSelection({ db: input.db, reason: input.reason, selection, scheduledFor: input.scheduledFor });
  }

  if (activePrimary && earlierSeriesPrimary && activeCycleId) {
    insertRecommendationEvent({
      db: input.db,
      eventType: "primary_replaced_by_series_predecessor",
      bookmeterUrl: activePrimary.bookmeterUrl,
      cycleId: activeCycleId,
      reason: input.reason,
      payload: {
        previousPrimary: activePrimary.bookmeterUrl,
        replacementPrimary: earlierSeriesPrimary.bookmeterUrl
      }
    });
    const selection = chooseSelectionWithPrimary({
      primary: earlierSeriesPrimary,
      scoredBooks,
      secondaryCount: input.settings.secondaryCount
    });
    return saveRecommendationSelection({ db: input.db, reason: input.reason, selection, scheduledFor: input.scheduledFor });
  }

  if (primaryUrl && !activePrimary && activeCycleId) {
    insertRecommendationEvent({
      db: input.db,
      eventType: "primary_completed_by_db_absence",
      bookmeterUrl: primaryUrl,
      cycleId: activeCycleId,
      reason: input.reason,
      payload: { primaryUrl }
    });
  }

  const previousSecondaries = existingItems.filter((item) => item.slot === "secondary").map((item) => item.bookmeter_url);
  const promotedCandidates = previousSecondaries.flatMap((url) => {
    const book = findByUrl(scoredBooks, url);
    return book ? [book] : [];
  });
  const remainingCandidates = scoredBooks.filter((book) => !previousSecondaries.includes(book.bookmeterUrl));
  const selection = chooseSelection([...promotedCandidates, ...remainingCandidates], input.settings.secondaryCount, new Set());

  if (!selection) {
    return null;
  }

  return saveRecommendationSelection({ db: input.db, reason: input.reason, selection, scheduledFor: input.scheduledFor });
}

export function skipRecommendation(input: {
  readonly db: Database.Database;
  readonly settings: AppSettings;
}): number | null {
  const currentSnapshots = getCurrentSnapshots(input.db);
  const scoredBooks = scoreBooks(currentSnapshots, input.settings);
  const existingItems = activeItems(input.db);
  const primaryUrl = existingItems.find((item) => item.slot === "primary")?.bookmeter_url ?? null;
  const selection = chooseSelection(scoredBooks, input.settings.secondaryCount, new Set(primaryUrl ? [primaryUrl] : []));

  if (!selection) {
    return null;
  }

  const cycleId = saveRecommendationSelection({ db: input.db, reason: "skip", selection });
  insertRecommendationEvent({
    db: input.db,
    eventType: "primary_skipped",
    bookmeterUrl: primaryUrl,
    cycleId,
    reason: "skip",
    payload: { skipped: primaryUrl }
  });
  return cycleId;
}

export function promoteRecommendation(input: {
  readonly db: Database.Database;
  readonly settings: AppSettings;
  readonly bookmeterUrl: string;
}): number | null {
  const currentSnapshots = getCurrentSnapshots(input.db);
  const scoredBooks = scoreBooks(currentSnapshots, input.settings);
  const promoted = findByUrl(scoredBooks, input.bookmeterUrl);

  if (!promoted) {
    return null;
  }

  const selection = chooseSelectionWithPrimary({
    primary: promoted,
    scoredBooks,
    secondaryCount: input.settings.secondaryCount
  });
  const cycleId = saveRecommendationSelection({ db: input.db, reason: "promote", selection });
  insertRecommendationEvent({
    db: input.db,
    eventType: "secondary_promoted",
    bookmeterUrl: input.bookmeterUrl,
    cycleId,
    reason: "promote",
    payload: { promoted: input.bookmeterUrl }
  });
  return cycleId;
}
