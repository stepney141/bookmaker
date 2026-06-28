import type { AppSettings, BookSnapshot, ScoreContribution } from "../shared/types";

export type ScoredBook = BookSnapshot & {
  readonly score: number;
  readonly scoreBreakdown: readonly ScoreContribution[];
  readonly reasons: readonly string[];
};

type SeriesPosition = {
  readonly key: string;
  readonly order: number;
};

type SeriesOrderContext = SeriesPosition & {
  readonly value: number;
};

const JAPANESE_NUMERAL_VALUES = new Map([
  ["一", 1],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9]
]);

const TRAILING_PUBLICATION_NOTE = String.raw`(?:\s*[（(][^()（）]*[）)])*`;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function weightedContribution(id: string, value: number, weight: number, explanation: string): ScoreContribution {
  const normalized = clamp01(value);

  return {
    id,
    value: normalized,
    weight,
    weightedValue: normalized * weight,
    explanation
  };
}

function listPriority(book: BookSnapshot): ScoreContribution {
  if (book.inStacked && book.inWish) {
    return weightedContribution("listPriority", 1, 0.25, "積読本と読みたい本の両方に登録されています。");
  }
  if (book.inStacked) {
    return weightedContribution("listPriority", 0.95, 0.25, "積読本に登録されています。");
  }
  return weightedContribution("listPriority", 0.15, 0.25, "読みたい本に登録されています。");
}

function remoteAge(book: BookSnapshot, settings: AppSettings, maxRemoteRank: number): ScoreContribution {
  if (settings.remoteOrderAgeDirection === "disabled" || maxRemoteRank <= 1) {
    return weightedContribution("remoteAge", 0, 0.2, "表示順による古さ評価は無効です。");
  }

  const largerIsOlder = (book.remoteRank - 1) / (maxRemoteRank - 1);
  const value = settings.remoteOrderAgeDirection === "larger_is_older" ? largerIsOlder : 1 - largerIsOlder;
  return weightedContribution("remoteAge", value, 0.2, "読書メーター上の表示順を古さの近似として使っています。");
}

function metadataQuality(book: BookSnapshot): ScoreContribution {
  const fields = [book.title, book.author, book.publisher, book.publishedDate, book.description];
  const presentCount = fields.filter((field) => field.trim().length > 0).length;
  return weightedContribution("metadataQuality", presentCount / fields.length, 0.1, "書誌情報と説明文が推薦理由に使えます。");
}

function normalizeSeriesText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSeriesKey(value: string): string {
  return normalizeSeriesText(value)
    .replace(/[\s:：,、.。・\-ー－―~〜(（[［【「『]+$/u, "")
    .trim();
}

function parseJapaneseNumber(value: string): number | null {
  if (/^\d+$/u.test(value)) {
    return Number(value);
  }

  if (value === "十") {
    return 10;
  }

  const tenIndex = value.indexOf("十");

  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : JAPANESE_NUMERAL_VALUES.get(value.slice(0, tenIndex));
    const onesText = value.slice(tenIndex + 1);
    const ones = onesText.length === 0 ? 0 : JAPANESE_NUMERAL_VALUES.get(onesText);

    if (tens && ones !== undefined) {
      return tens * 10 + ones;
    }
  }

  return JAPANESE_NUMERAL_VALUES.get(value) ?? null;
}

function parseSeriesPosition(title: string): SeriesPosition | null {
  const normalizedTitle = normalizeSeriesText(title);
  const volumeWordMatch = normalizedTitle.match(
    new RegExp(
      String.raw`^(?<key>.+?)[\s:：,、・\-ー－―(（[［【「『]*(?:第\s*)?(?<volume>\d+|[一二三四五六七八九十]+)\s*巻[)\]）］】」』]*${TRAILING_PUBLICATION_NOTE}$`,
      "u"
    )
  );

  if (volumeWordMatch?.groups) {
    const order = parseJapaneseNumber(volumeWordMatch.groups.volume);
    const key = normalizeSeriesKey(volumeWordMatch.groups.key);

    if (order && key) {
      return { key, order };
    }
  }

  const partMatch = normalizedTitle.match(
    /^(?<key>.+?)[\s:：,、・\-ー－―(（[［【「『]+(?<volume>\d{1,2})[)\]）］】」』]*$/u
  );

  if (partMatch?.groups) {
    const key = normalizeSeriesKey(partMatch.groups.key);

    if (key) {
      return { key, order: Number(partMatch.groups.volume) };
    }
  }

  const namedPartMatch = normalizedTitle.match(
    new RegExp(
      String.raw`^(?<key>.+?)[\s:：,、・\-ー－―(（[［【「『]*(?<volume>[上中下])巻?[)\]）］】」』]*${TRAILING_PUBLICATION_NOTE}$`,
      "u"
    )
  );

  if (namedPartMatch?.groups) {
    const key = normalizeSeriesKey(namedPartMatch.groups.key);
    const order = { 上: 1, 中: 2, 下: 3 }[namedPartMatch.groups.volume as "上" | "中" | "下"];

    if (key) {
      return { key, order };
    }
  }

  return null;
}

function seriesOrderContexts(books: readonly BookSnapshot[]): ReadonlyMap<string, SeriesOrderContext> {
  const parsedByUrl = new Map<string, SeriesPosition>();
  const groups = new Map<string, SeriesPosition[]>();

  for (const book of books) {
    const parsed = parseSeriesPosition(book.title);

    if (!parsed) {
      continue;
    }

    parsedByUrl.set(book.bookmeterUrl, parsed);
    groups.set(parsed.key, [...(groups.get(parsed.key) ?? []), parsed]);
  }

  const contexts = new Map<string, SeriesOrderContext>();

  for (const book of books) {
    const parsed = parsedByUrl.get(book.bookmeterUrl);
    const group = parsed ? groups.get(parsed.key) : null;
    const distinctOrders = group ? [...new Set(group.map((item) => item.order))].sort((a, b) => a - b) : [];

    if (!parsed || distinctOrders.length < 2) {
      continue;
    }

    const orderIndex = distinctOrders.indexOf(parsed.order);
    const value = 1 - orderIndex / (distinctOrders.length - 1);
    contexts.set(book.bookmeterUrl, { ...parsed, value });
  }

  return contexts;
}

function seriesOrder(context: SeriesOrderContext | undefined): ScoreContribution {
  if (!context) {
    return weightedContribution("seriesOrder", 0, 0.12, "シリーズ内の巻順は検出されていません。");
  }

  if (context.value === 1) {
    return weightedContribution("seriesOrder", 1, 0.12, "同一シリーズ内で最も若い巻です。");
  }

  return weightedContribution("seriesOrder", context.value, 0.12, "同一シリーズ内では前の巻を先に読む候補として扱います。");
}

function placeholderComponent(id: string, weight: number, explanation: string): ScoreContribution {
  return weightedContribution(id, 0, weight, explanation);
}

function reasonsFromBreakdown(book: BookSnapshot, scoreBreakdown: readonly ScoreContribution[]): readonly string[] {
  const scoreReasons = scoreBreakdown
    .filter((contribution) => contribution.value > 0.5)
    .slice(0, 3)
    .map((contribution) => contribution.explanation);
  const sourceReason = book.inStacked ? "積読本を優先しています。" : "読みたい本から選んでいます。";
  return [...new Set([sourceReason, ...scoreReasons])];
}

function compareBaseOrder(a: ScoredBook, b: ScoredBook): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.remoteRankSource !== b.remoteRankSource) {
    return a.remoteRankSource === "stacked" ? -1 : 1;
  }
  return a.remoteRank - b.remoteRank;
}

function applySeriesOrder(
  scoredBooks: readonly ScoredBook[],
  contexts: ReadonlyMap<string, SeriesOrderContext>
): readonly ScoredBook[] {
  const positionsBySeries = new Map<string, number[]>();

  for (const [index, book] of scoredBooks.entries()) {
    const context = contexts.get(book.bookmeterUrl);

    if (!context) {
      continue;
    }

    positionsBySeries.set(context.key, [...(positionsBySeries.get(context.key) ?? []), index]);
  }

  const replacements = new Map<number, ScoredBook>();

  for (const positions of positionsBySeries.values()) {
    if (positions.length < 2) {
      continue;
    }

    const booksInSeriesOrder = positions
      .map((position) => scoredBooks[position])
      .sort((a, b) => {
        const aContext = contexts.get(a.bookmeterUrl);
        const bContext = contexts.get(b.bookmeterUrl);
        const orderComparison = (aContext?.order ?? 0) - (bContext?.order ?? 0);
        return orderComparison === 0 ? compareBaseOrder(a, b) : orderComparison;
      });

    for (const [positionIndex, book] of booksInSeriesOrder.entries()) {
      replacements.set(positions[positionIndex], book);
    }
  }

  return scoredBooks.map((book, index) => replacements.get(index) ?? book);
}

export function findEarlierSeriesCandidate(input: {
  readonly book: BookSnapshot;
  readonly candidates: readonly ScoredBook[];
}): ScoredBook | null {
  const contexts = seriesOrderContexts(input.candidates);
  const bookContext = contexts.get(input.book.bookmeterUrl);

  if (!bookContext) {
    return null;
  }

  return (
    input.candidates.find((candidate) => {
      const candidateContext = contexts.get(candidate.bookmeterUrl);
      return (
        candidateContext?.key === bookContext.key &&
        candidateContext.order < bookContext.order
      );
    }) ?? null
  );
}

export function scoreBooks(books: readonly BookSnapshot[], settings: AppSettings): readonly ScoredBook[] {
  const maxRemoteRank = books.reduce((maxRank, book) => Math.max(maxRank, book.remoteRank), 1);
  const contexts = seriesOrderContexts(books);

  const scoredBooks = books
    .map((book) => {
      const scoreBreakdown = [
        listPriority(book),
        remoteAge(book, settings, maxRemoteRank),
        seriesOrder(contexts.get(book.bookmeterUrl)),
        placeholderComponent("clusterCentrality", 0.2, "意味的な近さは embedding 実装後に評価します。"),
        placeholderComponent("semanticDensity", 0.15, "意味的な密度は embedding 実装後に評価します。"),
        metadataQuality(book),
        placeholderComponent("novelty", 0.1, "履歴に基づく新規性は後続段階で評価します。")
      ];
      const score = scoreBreakdown.reduce((total, contribution) => total + contribution.weightedValue, 0);

      return {
        ...book,
        score,
        scoreBreakdown,
        reasons: reasonsFromBreakdown(book, scoreBreakdown)
      };
    })
    .sort(compareBaseOrder);

  return applySeriesOrder(scoredBooks, contexts);
}
