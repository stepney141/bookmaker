import { useEffect, useState } from "react";

import { SEARCH_PAGE_SIZE, canLoadMoreSearchResults, nextSearchLimit } from "../shared/searchLimits";

import {
  fetchCurrentRecommendation,
  fetchDiagnostics,
  fetchSettings,
  promoteRecommendation,
  runRecommendation,
  searchBooks,
  skipRecommendation,
  updateSettings
} from "./api";

import type {
  AppSettings,
  BookListKind,
  CurrentRecommendation,
  RecommendationBook,
  RowOrderDiagnostics,
  SearchFilters,
  SearchLibraryFilter,
  SearchResult
} from "../shared/types";
import type { JSX, KeyboardEvent } from "react";

type View = "current" | "search" | "settings" | "diagnostics";

const RECOMMENDATION_DAY_OPTIONS = [
  { value: 0, label: "日曜日" },
  { value: 1, label: "月曜日" },
  { value: 2, label: "火曜日" },
  { value: 3, label: "水曜日" },
  { value: 4, label: "木曜日" },
  { value: 5, label: "金曜日" },
  { value: 6, label: "土曜日" }
] as const;

const EMPTY_SEARCH_FILTERS: SearchFilters = { lists: [], libraries: [] };

const SEARCH_LIST_FILTER_OPTIONS: readonly { readonly value: BookListKind; readonly label: string }[] = [
  { value: "wish", label: "読みたい本" },
  { value: "stacked", label: "積読本" }
];

const SEARCH_LIBRARY_FILTER_OPTIONS: readonly { readonly value: SearchLibraryFilter; readonly label: string }[] = [
  { value: "utokyo", label: "東大図書館にある" },
  { value: "sophia", label: "上智図書館にある" },
  { value: "neither", label: "東大にも上智にもない" }
];

function listLabel(book: { readonly inStacked: boolean; readonly inWish: boolean }): string {
  if (book.inStacked && book.inWish) {
    return "積読本 / 読みたい本";
  }
  return book.inStacked ? "積読本" : "読みたい本";
}

function libraryLabel(book: {
  readonly sophiaLibraryStatus: SearchResult["sophiaLibraryStatus"];
  readonly utokyoLibraryStatus: SearchResult["utokyoLibraryStatus"];
}): string {
  const availableLibraries = [
    book.utokyoLibraryStatus === "available" ? "東大" : null,
    book.sophiaLibraryStatus === "available" ? "上智" : null
  ].filter((label): label is string => label !== null);

  if (availableLibraries.length > 0) {
    return `${availableLibraries.join(" / ")}にあり`;
  }
  if (book.utokyoLibraryStatus === "unavailable" && book.sophiaLibraryStatus === "unavailable") {
    return "東大にも上智にもない";
  }
  return "所蔵確認中";
}

function toggleListFilter(filters: SearchFilters, value: BookListKind): SearchFilters {
  return {
    ...filters,
    lists: filters.lists.includes(value) ? filters.lists.filter((item) => item !== value) : [...filters.lists, value]
  };
}

function toggleLibraryFilter(filters: SearchFilters, value: SearchLibraryFilter): SearchFilters {
  if (value === "neither") {
    return {
      ...filters,
      libraries: filters.libraries.includes(value) ? [] : [value]
    };
  }

  const currentLibraries = filters.libraries.filter((item) => item !== "neither");
  return {
    ...filters,
    libraries: currentLibraries.includes(value)
      ? currentLibraries.filter((item) => item !== value)
      : [...currentLibraries, value]
  };
}

function OpacLinks(input: {
  readonly book: {
    readonly sophiaOpacUrl: string;
    readonly utokyoOpacUrl: string;
  };
  readonly stopPropagation?: boolean;
}): JSX.Element | null {
  const links = [
    { label: "東大OPAC", url: input.book.utokyoOpacUrl.trim(), className: "button-link--utokyo" },
    { label: "上智OPAC", url: input.book.sophiaOpacUrl.trim(), className: "button-link--sophia" }
  ].filter((link) => link.url.length > 0);

  if (links.length === 0) {
    return null;
  }

  return (
    <div className="opac-links" aria-label="OPACリンク">
      {links.map((link) => (
        <a
          key={link.label}
          className={`button-link ${link.className}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          onClick={input.stopPropagation ? (event) => event.stopPropagation() : undefined}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function BookPanel(input: {
  readonly book: RecommendationBook;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}): JSX.Element {
  return (
    <article className="book-panel">
      <div className="book-panel__meta">
        <span>{listLabel(input.book)}</span>
        <span>score {input.book.score.toFixed(3)}</span>
      </div>
      <h3>{input.book.title || "無題"}</h3>
      <p className="book-panel__author">{input.book.author || "著者不明"}</p>
      <p>{input.book.description || "説明文はまだ取得されていません。"}</p>
      <ul>
        {input.book.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="book-panel__actions">
        <a
          className="button-link button-link--bookmeter"
          href={input.book.bookmeterUrl}
          target="_blank"
          rel="noreferrer"
        >
          Bookmeter
        </a>
        <OpacLinks book={input.book} />
        {input.actionLabel && input.onAction ? <button onClick={input.onAction}>{input.actionLabel}</button> : null}
      </div>
    </article>
  );
}

function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

function BookDetailDialog(input: {
  readonly book: CurrentRecommendation["relatedBooks"][number] | SearchResult;
  readonly titleId: string;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={input.onClose}>
      <article
        className="book-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={input.titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="book-panel__meta">
          <span>{listLabel(input.book)}</span>
          <span>score {input.book.score.toFixed(3)}</span>
        </div>
        <h3 id={input.titleId}>{input.book.title || "無題"}</h3>
        <p className="book-panel__author">{input.book.author || "著者不明"}</p>
        <p>
          {input.book.publisher || "出版社不明"} / {input.book.publishedDate || "刊行日不明"}
        </p>
        <p>{libraryLabel(input.book)}</p>
        {input.book.isbnOrAsin ? <p>ISBN/ASIN {input.book.isbnOrAsin}</p> : null}
        <p>{input.book.description || "説明文はまだ取得されていません。"}</p>
        <ul>
          {input.book.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <div className="book-panel__actions">
          <a
            className="button-link button-link--bookmeter"
            href={input.book.bookmeterUrl}
            target="_blank"
            rel="noreferrer"
          >
            Bookmeter
          </a>
          <OpacLinks book={input.book} />
          <button type="button" onClick={input.onClose}>
            閉じる
          </button>
        </div>
      </article>
    </div>
  );
}

function CurrentView(input: {
  readonly current: CurrentRecommendation | null;
  readonly loading: boolean;
  readonly onRun: () => void;
  readonly onSkip: () => void;
  readonly onPromote: (bookmeterUrl: string) => void;
}): JSX.Element {
  const [selectedRelatedBook, setSelectedRelatedBook] = useState<CurrentRecommendation["relatedBooks"][number] | null>(
    null
  );

  if (input.loading) {
    return <p className="status">読み込み中です。</p>;
  }

  if (!input.current?.primary) {
    return (
      <section className="view">
        <h2>今週読む本</h2>
        <p className="status">推薦を作成できる書籍がありません。</p>
        <button onClick={input.onRun}>推薦を更新</button>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="view-heading">
        <div>
          <h2>今週読む本</h2>
          <p>
            cycle {input.current.cycleId} / {input.current.reason}
          </p>
        </div>
        <div className="toolbar">
          <button onClick={input.onRun}>更新</button>
          <button onClick={input.onSkip}>skip</button>
        </div>
      </div>
      <BookPanel book={input.current.primary} />
      <h2>副推薦</h2>
      <div className="grid">
        {input.current.secondaries.map((book) => (
          <BookPanel
            key={book.bookmeterUrl}
            book={book}
            actionLabel="今週はこれを読む"
            onAction={() => input.onPromote(book.bookmeterUrl)}
          />
        ))}
      </div>
      <h2>近い内容の本</h2>
      <div className="related-list">
        {input.current.relatedBooks.map((book) => (
          <article
            key={book.bookmeterUrl}
            className="related-row"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedRelatedBook(book)}
            onKeyDown={(event) => {
              if (isActivationKey(event)) {
                event.preventDefault();
                setSelectedRelatedBook(book);
              }
            }}
          >
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <p>{book.reasons.join(" ")}</p>
            </div>
            <div className="related-row__actions">
              <span>{book.score.toFixed(3)}</span>
              <a
                className="button-link button-link--bookmeter"
                href={book.bookmeterUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Bookmeter
              </a>
              <OpacLinks book={book} stopPropagation />
            </div>
          </article>
        ))}
      </div>
      {selectedRelatedBook ? (
        <BookDetailDialog
          book={selectedRelatedBook}
          titleId="related-book-title"
          onClose={() => setSelectedRelatedBook(null)}
        />
      ) : null}
    </section>
  );
}

function SearchView(): JSX.Element {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [searchedFilters, setSearchedFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [requestedLimit, setRequestedLimit] = useState(SEARCH_PAGE_SIZE);
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);

  async function loadResults(searchQuery: string, limit: number, searchFilters: SearchFilters): Promise<void> {
    setSearching(true);
    setStatus("検索中です。");
    try {
      const nextResults = await searchBooks(searchQuery, limit, searchFilters);
      setRequestedLimit(limit);
      setSearchedQuery(searchQuery);
      setSearchedFilters(searchFilters);
      setResults(nextResults);
      setSelectedResult(null);
      setStatus(nextResults.length === 0 ? "該当する書籍はありません。" : "");
    } finally {
      setSearching(false);
    }
  }

  async function submit(): Promise<void> {
    await loadResults(query, SEARCH_PAGE_SIZE, filters);
  }

  async function loadMore(): Promise<void> {
    await loadResults(searchedQuery, nextSearchLimit(requestedLimit), searchedFilters);
  }

  function applyFilters(nextFilters: SearchFilters): void {
    setFilters(nextFilters);

    if (searchedQuery.length > 0) {
      void loadResults(searchedQuery, SEARCH_PAGE_SIZE, nextFilters);
    }
  }

  function handleListFilterClick(value: BookListKind): void {
    applyFilters(toggleListFilter(filters, value));
  }

  function handleLibraryFilterClick(value: SearchLibraryFilter): void {
    applyFilters(toggleLibraryFilter(filters, value));
  }

  const canLoadMore = canLoadMoreSearchResults({ resultCount: results.length, currentLimit: requestedLimit });

  return (
    <section className="view">
      <h2>検索</h2>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="セキュリティに関連する本はどれ？"
        />
        <button type="submit" disabled={searching}>
          検索
        </button>
      </form>
      <div className="search-filters" aria-label="検索フィルター">
        <div className="filter-group">
          {SEARCH_LIST_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filters.lists.includes(option.value) ? "active" : ""}
              aria-pressed={filters.lists.includes(option.value)}
              disabled={searching}
              onClick={() => handleListFilterClick(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="filter-group">
          {SEARCH_LIBRARY_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filters.libraries.includes(option.value) ? "active" : ""}
              aria-pressed={filters.libraries.includes(option.value)}
              disabled={searching}
              onClick={() => handleLibraryFilterClick(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {status ? <p className="status">{status}</p> : null}
      <div className="result-list">
        {results.map((result) => (
          <article
            key={result.bookmeterUrl}
            className="result-row"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedResult(result)}
            onKeyDown={(event) => {
              if (isActivationKey(event)) {
                event.preventDefault();
                setSelectedResult(result);
              }
            }}
          >
            <span>{result.rank}</span>
            <div>
              <h3>{result.title}</h3>
              <p>
                {result.author} / {listLabel(result)} / {libraryLabel(result)}
              </p>
              <p>{result.snippet}</p>
              <p>{result.reasons.join(" ")}</p>
            </div>
            <div className="result-row__actions">
              <OpacLinks book={result} stopPropagation />
            </div>
          </article>
        ))}
      </div>
      {selectedResult ? (
        <BookDetailDialog book={selectedResult} titleId="search-result-title" onClose={() => setSelectedResult(null)} />
      ) : null}
      {canLoadMore ? (
        <div className="load-more">
          <button type="button" onClick={() => void loadMore()} disabled={searching}>
            さらに読み込む
          </button>
        </div>
      ) : null}
    </section>
  );
}

function SettingsView(input: {
  readonly settings: AppSettings | null;
  readonly onSave: (settings: Partial<AppSettings>) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Partial<AppSettings>>({});
  const settings = input.settings;

  if (!settings) {
    return <p className="status">設定を読み込み中です。</p>;
  }

  const merged = { ...settings, ...draft };

  return (
    <section className="view compact">
      <h2>設定</h2>
      <label>
        推薦曜日
        <select
          value={String(merged.recommendationDayOfWeek)}
          onChange={(event) => setDraft({ ...draft, recommendationDayOfWeek: Number(event.target.value) })}
        >
          {RECOMMENDATION_DAY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        推薦時刻
        <input
          value={merged.recommendationTime}
          onChange={(event) => setDraft({ ...draft, recommendationTime: event.target.value })}
        />
      </label>
      <label>
        remote rank
        <select
          value={merged.remoteOrderAgeDirection}
          onChange={(event) =>
            setDraft({
              ...draft,
              remoteOrderAgeDirection: event.target.value as AppSettings["remoteOrderAgeDirection"]
            })
          }
        >
          <option value="larger_is_older">大きいほど古い</option>
          <option value="larger_is_newer">大きいほど新しい</option>
          <option value="disabled">使わない</option>
        </select>
      </label>
      <button onClick={() => input.onSave(draft)}>保存</button>
    </section>
  );
}

function DiagnosticsView(input: { readonly diagnostics: readonly RowOrderDiagnostics[] }): JSX.Element {
  return (
    <section className="view">
      <h2>診断</h2>
      {input.diagnostics.map((diagnostic) => (
        <div key={diagnostic.tableName} className="diagnostic">
          <h3>{diagnostic.tableName}</h3>
          <div className="grid">
            <div>
              <h4>先頭</h4>
              {diagnostic.firstRows.map((row) => (
                <p key={row.rowid}>
                  {row.rowid}. {row.title} / {row.author}
                </p>
              ))}
            </div>
            <div>
              <h4>末尾</h4>
              {diagnostic.lastRows.map((row) => (
                <p key={row.rowid}>
                  {row.rowid}. {row.title} / {row.author}
                </p>
              ))}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>("current");
  const [current, setCurrent] = useState<CurrentRecommendation | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly RowOrderDiagnostics[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh(): Promise<void> {
    setLoading(true);
    const [nextCurrent, nextSettings, nextDiagnostics] = await Promise.all([
      fetchCurrentRecommendation(),
      fetchSettings(),
      fetchDiagnostics()
    ]);
    setCurrent(nextCurrent);
    setSettings(nextSettings);
    setDiagnostics(nextDiagnostics);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <main className="app-shell">
      <nav>
        <button className={view === "current" ? "active" : ""} onClick={() => setView("current")}>
          推薦
        </button>
        <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>
          検索
        </button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
          設定
        </button>
        <button className={view === "diagnostics" ? "active" : ""} onClick={() => setView("diagnostics")}>
          診断
        </button>
      </nav>
      {view === "current" ? (
        <CurrentView
          current={current}
          loading={loading}
          onRun={() => {
            void runRecommendation().then(setCurrent);
          }}
          onSkip={() => {
            void skipRecommendation().then(setCurrent);
          }}
          onPromote={(bookmeterUrl) => {
            void promoteRecommendation(bookmeterUrl).then(setCurrent);
          }}
        />
      ) : null}
      {view === "search" ? <SearchView /> : null}
      {view === "settings" ? (
        <SettingsView
          settings={settings}
          onSave={(nextSettings) => {
            void updateSettings(nextSettings).then(setSettings);
          }}
        />
      ) : null}
      {view === "diagnostics" ? <DiagnosticsView diagnostics={diagnostics} /> : null}
    </main>
  );
}
