export type BookListKind = "wish" | "stacked";

export type LibraryAvailability = "available" | "unavailable" | "unknown";

export type SearchLibraryFilter = "utokyo" | "sophia" | "neither";

export type SearchFilters = {
  readonly lists: readonly BookListKind[];
  readonly libraries: readonly SearchLibraryFilter[];
};

export type RemoteOrderAgeDirection = "larger_is_older" | "larger_is_newer" | "disabled";

export type RecommendationReason = "initial" | "manual" | "scheduled" | "source_changed" | "skip" | "promote";

export type RecommendationSlot = "primary" | "secondary";

export type SourceBook = {
  readonly bookmeterUrl: string;
  readonly isbnOrAsin: string | null;
  readonly title: string;
  readonly author: string;
  readonly publisher: string;
  readonly publishedDate: string;
  readonly description: string;
  readonly inWish: boolean;
  readonly inStacked: boolean;
  readonly sophiaLibraryStatus: LibraryAvailability;
  readonly utokyoLibraryStatus: LibraryAvailability;
  readonly sophiaOpacUrl: string;
  readonly utokyoOpacUrl: string;
  readonly wishRowid: number | null;
  readonly stackedRowid: number | null;
  readonly remoteRank: number;
  readonly remoteRankSource: BookListKind;
};

export type BookSnapshot = SourceBook & {
  readonly contentHash: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly lastScanRunId: number;
};

export type ScoreContribution = {
  readonly id: string;
  readonly value: number;
  readonly weight: number;
  readonly weightedValue: number;
  readonly explanation: string;
};

export type RecommendationBook = SourceBook & {
  readonly score: number;
  readonly scoreBreakdown: readonly ScoreContribution[];
  readonly reasons: readonly string[];
};

export type RelatedBook = SourceBook & {
  readonly score: number;
  readonly reasons: readonly string[];
};

export type CurrentRecommendation = {
  readonly cycleId: number;
  readonly status: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly primary: RecommendationBook | null;
  readonly secondaries: readonly RecommendationBook[];
  readonly relatedBooks: readonly RelatedBook[];
};

export type SearchResult = SourceBook & {
  readonly rank: number;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly snippet: string;
};

export type AppSettings = {
  readonly recommendationDayOfWeek: number;
  readonly recommendationTime: string;
  readonly timezone: string;
  readonly primaryCount: number;
  readonly secondaryCount: number;
  readonly relatedCount: number;
  readonly searchResultCount: number;
  readonly remoteOrderAgeDirection: RemoteOrderAgeDirection;
};

export type RowOrderDiagnostics = {
  readonly tableName: BookListKind;
  readonly firstRows: readonly SourceOrderRow[];
  readonly lastRows: readonly SourceOrderRow[];
};

export type SourceOrderRow = {
  readonly rowid: number;
  readonly bookmeterUrl: string;
  readonly title: string;
  readonly author: string;
};
