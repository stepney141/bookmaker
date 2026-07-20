
import { getCurrentSnapshots, insertRecommendationEvent } from "../db/appDb";

import { filterEarliestSeriesCandidates, findEarlierSeriesCandidate, scoreBooks, type ScoredBook } from "./scoring";
import {
  getActiveCycleId,
  replaceRecommendationItems,
  saveRecommendationSelection,
  type RecommendationSelection
} from "./store";

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

export function selectWeightedCandidate(input: {
  readonly candidates: readonly ScoredBook[];
  readonly randomValue: number;
}): ScoredBook | null {
  if (!Number.isFinite(input.randomValue) || input.randomValue < 0 || input.randomValue >= 1) {
    return null;
  }
  if (
    input.candidates.length === 0 ||
    input.candidates.some((candidate) => !Number.isFinite(candidate.score) || candidate.score <= 0)
  ) {
    return null;
  }

  const totalWeight = input.candidates.reduce((total, candidate) => total + candidate.score, 0);

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return null;
  }

  const threshold = input.randomValue * totalWeight;
  let cumulativeWeight = 0;

  for (const candidate of input.candidates) {
    cumulativeWeight += candidate.score;

    if (threshold < cumulativeWeight) {
      return candidate;
    }
  }

  return null;
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

export type RandomRecommendationResult =
  | { readonly status: "selected"; readonly cycleId: number }
  | { readonly status: "no_active_recommendation" }
  | { readonly status: "no_random_candidate" };

export function randomizeRecommendation(input: {
  readonly db: Database.Database;
  readonly settings: AppSettings;
  readonly randomValue: number;
}): RandomRecommendationResult {
  const currentSnapshots = getCurrentSnapshots(input.db);
  const scoredBooks = scoreBooks(currentSnapshots, input.settings);
  const existingItems = activeItems(input.db);
  const activeCycleId = getActiveCycleId(input.db);
  const primaryUrl = existingItems.find((item) => item.slot === "primary")?.bookmeter_url;

  if (!activeCycleId || !primaryUrl) {
    return { status: "no_active_recommendation" };
  }

  const previousSecondaries = existingItems
    .filter((item) => item.slot === "secondary")
    .map((item) => item.bookmeter_url);
  const displayedUrls = new Set(existingItems.map((item) => item.bookmeter_url));
  const eligibleCandidates = filterEarliestSeriesCandidates(scoredBooks).filter(
    (candidate) => !displayedUrls.has(candidate.bookmeterUrl)
  );
  const primary = selectWeightedCandidate({ candidates: eligibleCandidates, randomValue: input.randomValue });

  if (!primary) {
    return { status: "no_random_candidate" };
  }

  const selection = chooseSelectionWithPrimary({
    primary,
    scoredBooks,
    secondaryCount: input.settings.secondaryCount
  });
  const transaction = input.db.transaction(() => {
    replaceRecommendationItems({ db: input.db, cycleId: activeCycleId, selection });
    insertRecommendationEvent({
      db: input.db,
      eventType: "primary_randomized",
      bookmeterUrl: primary.bookmeterUrl,
      cycleId: activeCycleId,
      reason: "random",
      payload: {
        previous: { primary: primaryUrl, secondaries: previousSecondaries },
        next: {
          primary: primary.bookmeterUrl,
          secondaries: selection.secondaries.map((book) => book.bookmeterUrl)
        },
        eligibleCount: eligibleCandidates.length
      }
    });
  });
  transaction();
  return { status: "selected", cycleId: activeCycleId };
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
