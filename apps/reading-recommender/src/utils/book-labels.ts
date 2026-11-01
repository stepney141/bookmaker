import type { SearchResult } from "@/types/api";

export function listLabel(book: { readonly inStacked: boolean; readonly inWish: boolean }): string {
  if (book.inStacked && book.inWish) {
    return "積読本 / 読みたい本";
  }
  return book.inStacked ? "積読本" : "読みたい本";
}

export function catalogNumber(book: {
  readonly wishRowid: number | null;
  readonly stackedRowid: number | null;
  readonly remoteRank: number;
}): string {
  const source = book.stackedRowid ?? book.wishRowid ?? book.remoteRank;
  const value = Number.isFinite(source) ? Math.max(0, Math.trunc(source)) : 0;
  return `No. ${String(value).padStart(4, "0")}`;
}

export function stampLabel(book: { readonly inStacked: boolean }): {
  readonly text: string;
  readonly modifier: string;
} {
  return book.inStacked ? { text: "積読", modifier: "" } : { text: "読みたい", modifier: " stamp--wish" };
}

export function libraryLabel(book: {
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
