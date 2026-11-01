import type { BookListKind, SearchFilters, SearchLibraryFilter } from "@/types/api";

export const EMPTY_SEARCH_FILTERS: SearchFilters = { lists: [], libraries: [] };

export function toggleListFilter(filters: SearchFilters, value: BookListKind): SearchFilters {
  return {
    ...filters,
    lists: filters.lists.includes(value) ? filters.lists.filter((item) => item !== value) : [...filters.lists, value]
  };
}

export function toggleLibraryFilter(filters: SearchFilters, value: SearchLibraryFilter): SearchFilters {
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
