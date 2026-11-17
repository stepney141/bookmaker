import { ApiRequestError } from "@/lib/api-client";

export function recommendationActionErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "no_random_candidate":
        return "ほかに選べる本がありません。";
      case "book_not_found":
        return "この本は現在のリストにありません。";
    }
  }
  return "操作に失敗しました。少し時間をおいて再度お試しください。";
}
