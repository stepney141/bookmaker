/**
 * fetchers モジュール内で共有される型定義。
 * ドメイン型（Book 等）は domain/ から re-export しない。
 */

import type { FetcherError } from "./errors";
import type { Book } from "../domain/book";
import type { Result } from "../libs/lib";

/** 統一された fetcher 戻り値の状態型 */
export type FetchStatus = "found" | "notFound" | "owning" | "notOwning";
export type FetchResult = { book: Book; status: FetchStatus };

/** fetcher 関数の統一戻り値型 */
export type FetcherResult = Result<FetchResult, FetcherError>;

export type BiblioinfoErrorStatus =
  | "Not_found_in_OpenBD"
  | "Not_found_in_ISBNdb"
  | "Not_found_in_NDL"
  | "Not_found_in_GoogleBooks";

export type FetcherCredentials = {
  cinii: string;
  google: string;
  isbnDb: string;
};
