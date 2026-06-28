import { useState } from "react";

import { SEARCH_PAGE_SIZE, canLoadMoreSearchResults, nextSearchLimit } from "../../shared/searchLimits";
import { searchBooks } from "../api";
import { BookDetailDialog, OpacLinks, isActivationKey, libraryLabel, listLabel } from "../components/bookUi";

import type { BookListKind, SearchFilters, SearchLibraryFilter, SearchResult } from "../../shared/types";
import type { JSX } from "react";

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

export function SearchPage(): JSX.Element {
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
