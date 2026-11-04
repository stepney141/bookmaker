import type { Book, BookList } from "../domain/book";
import type { ISBN10 } from "../domain/isbn";

export const makeBook = (bookmeterUrl: string, overrides: Partial<Book> = {}): Book => ({
  bookmeter_url: bookmeterUrl,
  isbn_or_asin: "4062938428" as ISBN10,
  book_title: `title:${bookmeterUrl}`,
  author: "author",
  publisher: "publisher",
  published_date: "2024-01-01",
  sophia_opac: "",
  utokyo_opac: "",
  exist_in_sophia: "No",
  exist_in_utokyo: "No",
  sophia_mathlib_opac: "",
  description: "",
  ...overrides
});

export const toBookList = (books: readonly Book[]): BookList =>
  new Map(books.map((book) => [book.bookmeter_url, book]));
