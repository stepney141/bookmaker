import type { AppSettings, BookSnapshot, ScoreContribution } from "../shared/types";

export type ScoredBook = BookSnapshot & {
  readonly score: number;
  readonly scoreBreakdown: readonly ScoreContribution[];
  readonly reasons: readonly string[];
};

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

export function scoreBooks(books: readonly BookSnapshot[], settings: AppSettings): readonly ScoredBook[] {
  const maxRemoteRank = books.reduce((maxRank, book) => Math.max(maxRank, book.remoteRank), 1);

  return books
    .map((book) => {
      const scoreBreakdown = [
        listPriority(book),
        remoteAge(book, settings, maxRemoteRank),
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
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.remoteRankSource !== b.remoteRankSource) {
        return a.remoteRankSource === "stacked" ? -1 : 1;
      }
      return a.remoteRank - b.remoteRank;
    });
}
