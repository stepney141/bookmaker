import type { SearchFilters, SearchResult } from "../shared/types";
import type Database from "better-sqlite3";

type SearchRow = {
  readonly bookmeter_url: string;
  readonly rank_score: number;
};

type SnapshotRow = {
  readonly bookmeter_url: string;
  readonly isbn_or_asin: string | null;
  readonly book_title: string;
  readonly author: string;
  readonly publisher: string;
  readonly published_date: string;
  readonly description: string;
  readonly in_wish: number;
  readonly in_stacked: number;
  readonly sophia_library_status: "available" | "unavailable" | "unknown";
  readonly utokyo_library_status: "available" | "unavailable" | "unknown";
  readonly sophia_opac_url: string;
  readonly utokyo_opac_url: string;
  readonly wish_rowid: number | null;
  readonly stacked_rowid: number | null;
  readonly remote_rank: number;
  readonly remote_rank_source: "wish" | "stacked";
};

type QueryAnalysis = {
  readonly original: string;
  readonly normalized: string;
  readonly terms: readonly string[];
  readonly identifier: string | null;
  readonly isShortQuery: boolean;
};

type RankedRow = {
  readonly row: SnapshotRow;
  readonly score: number;
  readonly reasons: readonly string[];
};

export type SemanticSearchInput = {
  readonly scoresByUrl: ReadonlyMap<string, number>;
};

const QUERY_PHRASES = [
  /に関連する/gu,
  /に関する/gu,
  /について/gu,
  /(?:本|書籍)(?:は|が|を)?(?:どれ|どの|何|なに)/gu,
  /(?:おすすめ|推薦|探したい|探す|読みたい)/gu,
  /\b(?:related|about|recommend|recommendation|books?)\b/giu
];

const STOP_TERMS = new Set([
  "関連",
  "近い",
  "分野",
  "ジャンル",
  "トピック",
  "本",
  "書籍",
  "どれ",
  "どの",
  "何",
  "なに",
  "は",
  "が",
  "を",
  "に",
  "の",
  "と",
  "で",
  "する",
  "です",
  "ます",
  "related",
  "about",
  "book",
  "books",
  "recommend",
  "recommendation"
]);

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\u2010-\u2015ー－―]/gu, "-")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~。、，．・！？「」『』【】（）［］〔〕〈〉《》]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeIdentifier(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[^0-9a-z]/gu, "");
}

function stripQueryPhrases(query: string): string {
  return QUERY_PHRASES.reduce((current, pattern) => current.replace(pattern, " "), query)
    .replace(/\s+/gu, " ")
    .trim();
}

function extractTerms(normalizedQuery: string): readonly string[] {
  const stripped = stripQueryPhrases(normalizedQuery);
  const matches = stripped.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-z0-9-]+/gu) ?? [];
  const terms = matches
    .map((term) => term.replace(/^-+|-+$/gu, ""))
    .filter((term) => term.length > 0 && !STOP_TERMS.has(term));

  return [...new Set(terms)];
}

function analyzeQuery(query: string): QueryAnalysis {
  const original = query.trim();
  const normalized = normalizeSearchText(original);
  const terms = extractTerms(normalized);
  const identifier = normalizeIdentifier(normalized);
  const isIdentifier = /^(?:[0-9]{9}[0-9x]|[0-9]{13}|b[0-9a-z]{9})$/u.test(identifier);

  return {
    original,
    normalized,
    terms: terms.length > 0 ? terms : normalized.length > 0 ? [normalized] : [],
    identifier: isIdentifier ? identifier : null,
    isShortQuery: normalized.length <= 2
  };
}

function escapeFtsTerm(term: string): string {
  return term.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function snippet(description: string, analysis: QueryAnalysis): string {
  const normalizedDescription = normalizeSearchText(description);

  if (description.length <= 160) {
    return description;
  }

  const matchingTerm = analysis.terms.find((term) => normalizedDescription.includes(term));
  const index = matchingTerm ? normalizedDescription.indexOf(matchingTerm) : -1;
  const start = index >= 0 ? Math.max(0, index - 50) : 0;
  return `${description.slice(start, start + 160)}...`;
}

function rowToSearchResult(input: {
  readonly row: SnapshotRow;
  readonly rank: number;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly analysis: QueryAnalysis;
}): SearchResult {
  return {
    bookmeterUrl: input.row.bookmeter_url,
    isbnOrAsin: input.row.isbn_or_asin,
    title: input.row.book_title,
    author: input.row.author,
    publisher: input.row.publisher,
    publishedDate: input.row.published_date,
    description: input.row.description,
    inWish: input.row.in_wish === 1,
    inStacked: input.row.in_stacked === 1,
    sophiaLibraryStatus: input.row.sophia_library_status,
    utokyoLibraryStatus: input.row.utokyo_library_status,
    sophiaOpacUrl: input.row.sophia_opac_url,
    utokyoOpacUrl: input.row.utokyo_opac_url,
    wishRowid: input.row.wish_rowid,
    stackedRowid: input.row.stacked_rowid,
    remoteRank: input.row.remote_rank,
    remoteRankSource: input.row.remote_rank_source,
    rank: input.rank,
    score: input.score,
    reasons: input.reasons,
    snippet: snippet(input.row.description, input.analysis)
  };
}

function textIncludesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function countMatches(text: string, terms: readonly string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function selectFtsRows(db: Database.Database, analysis: QueryAnalysis, limit: number): Map<string, number> {
  const rankByUrl = new Map<string, number>();
  const ftsTerms = [
    ...new Set([analysis.normalized, ...analysis.terms].map(escapeFtsTerm).filter((term) => term.length >= 3))
  ].slice(0, 8);

  for (const term of ftsTerms) {
    const rows = db
      .prepare(
        `SELECT bookmeter_url, bm25(book_fts, 6.0, 3.0, 1.5, 1.0) AS rank_score
         FROM book_fts
         WHERE book_fts MATCH ?
         ORDER BY rank_score ASC
         LIMIT ?`
      )
      .all(term, limit) as readonly SearchRow[];

    for (const [index, row] of rows.entries()) {
      const rankScore = 40 / (index + 1);
      const existing = rankByUrl.get(row.bookmeter_url);
      rankByUrl.set(row.bookmeter_url, Math.max(existing ?? 0, rankScore));
    }
  }

  return rankByUrl;
}

function matchesFilters(row: SnapshotRow, filters: SearchFilters | undefined): boolean {
  const listMatches =
    !filters ||
    filters.lists.length === 0 ||
    filters.lists.some((list) => (list === "wish" ? row.in_wish === 1 : row.in_stacked === 1));
  const libraryMatches =
    !filters ||
    filters.libraries.length === 0 ||
    filters.libraries.some((library) => {
      if (library === "utokyo") {
        return row.utokyo_library_status === "available";
      }
      if (library === "sophia") {
        return row.sophia_library_status === "available";
      }
      return row.utokyo_library_status === "unavailable" && row.sophia_library_status === "unavailable";
    });

  return listMatches && libraryMatches;
}

function selectCurrentRows(
  db: Database.Database,
  scanRunId: number,
  filters: SearchFilters | undefined
): readonly SnapshotRow[] {
  return db
    .prepare(
      `SELECT *
       FROM book_snapshot
       WHERE last_scan_run_id = ?`
    )
    .all(scanRunId)
    .filter((row): row is SnapshotRow => matchesFilters(row as SnapshotRow, filters));
}

function scoreMetadata(input: {
  readonly row: SnapshotRow;
  readonly analysis: QueryAnalysis;
  readonly ftsScore: number;
  readonly semanticScore: number;
}): RankedRow | null {
  const { row, analysis, ftsScore, semanticScore } = input;
  const title = normalizeSearchText(row.book_title);
  const author = normalizeSearchText(row.author);
  const publisher = normalizeSearchText(row.publisher);
  const description = normalizeSearchText(row.description);
  const isbnOrAsin = row.isbn_or_asin ? normalizeIdentifier(row.isbn_or_asin) : "";
  const exactMatches = {
    identifier: analysis.identifier !== null && isbnOrAsin === analysis.identifier,
    title: !analysis.isShortQuery && title.includes(analysis.normalized),
    author: !analysis.isShortQuery && author.includes(analysis.normalized),
    publisher: !analysis.isShortQuery && publisher.includes(analysis.normalized)
  };

  const titleMatches = countMatches(title, analysis.terms);
  const authorMatches = countMatches(author, analysis.terms);
  const publisherMatches = countMatches(publisher, analysis.terms);
  const descriptionMatches = countMatches(description, analysis.terms);
  const exactScore =
    (exactMatches.identifier ? 140 : 0) +
    (exactMatches.title ? 90 : 0) +
    (exactMatches.author ? 75 : 0) +
    (exactMatches.publisher ? 25 : 0);
  const termScore = titleMatches * 35 + authorMatches * 30 + publisherMatches * 12 + descriptionMatches * 8;
  const multiTermBonus = textIncludesAny(`${title} ${author} ${publisher} ${description}`, analysis.terms)
    ? analysis.terms.length > 1
      ? (titleMatches + authorMatches + publisherMatches + descriptionMatches) * 3
      : 0
    : 0;
  const listBonus = row.in_stacked === 1 ? 2 : 1;
  const semanticBoost = semanticScore * 60;
  const score =
    ftsScore + exactScore + termScore + multiTermBonus + semanticBoost + listBonus + 1 / Math.max(row.remote_rank, 1);
  const reasons = [
    exactMatches.identifier ? "ISBNまたはASINが一致します。" : null,
    exactMatches.title ? "タイトルが入力語句と一致します。" : null,
    exactMatches.author ? "著者名が入力語句と一致します。" : null,
    exactMatches.publisher ? "出版社名が入力語句と一致します。" : null,
    titleMatches > 0 && !exactMatches.title ? "タイトルに検索語が含まれます。" : null,
    authorMatches > 0 && !exactMatches.author ? "著者名に検索語が含まれます。" : null,
    descriptionMatches > 0 ? "説明文に検索語が含まれます。" : null,
    ftsScore > 0 ? "全文検索で関連度が高い候補です。" : null,
    semanticScore >= 0.65 ? "説明文の意味が近い候補です。" : null
  ].filter((reason): reason is string => reason !== null);

  if (score <= 2.1 || reasons.length === 0) {
    return null;
  }

  return {
    row,
    score,
    reasons: [...reasons, row.in_stacked === 1 ? "積読本に登録されています。" : "読みたい本に登録されています。"]
  };
}

export function searchBooks(input: {
  readonly db: Database.Database;
  readonly query: string;
  readonly limit: number;
  readonly filters?: SearchFilters;
  readonly semantic?: SemanticSearchInput;
}): readonly SearchResult[] {
  const analysis = analyzeQuery(input.query);

  if (analysis.normalized.length === 0 || analysis.terms.length === 0) {
    return [];
  }

  const currentScanRun = input.db.prepare("SELECT id FROM scan_run ORDER BY id DESC LIMIT 1").get() as
    | { readonly id: number }
    | undefined;

  if (!currentScanRun) {
    return [];
  }

  const ftsScores = selectFtsRows(input.db, analysis, input.limit * 5);
  const rows = selectCurrentRows(input.db, currentScanRun.id, input.filters);

  return rows
    .flatMap((row) => {
      const ranked = scoreMetadata({
        row,
        analysis,
        ftsScore: ftsScores.get(row.bookmeter_url) ?? 0,
        semanticScore: input.semantic?.scoresByUrl.get(row.bookmeter_url) ?? 0
      });
      return ranked ? [ranked] : [];
    })
    .toSorted((a, b) => b.score - a.score || a.row.remote_rank - b.row.remote_rank)
    .slice(0, input.limit)
    .map((ranked, index) =>
      rowToSearchResult({
        row: ranked.row,
        rank: index + 1,
        score: ranked.score,
        reasons: ranked.reasons,
        analysis
      })
    );
}
