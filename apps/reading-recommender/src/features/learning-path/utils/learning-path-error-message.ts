import { ApiRequestError } from "@/lib/api-client";

export function learningPathErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "invalid_request":
        return "学びたいテーマを1〜200文字で入力し、生成元を選んでください。";
      case "planner_unavailable":
        return "選択した生成元を利用できません。設定を確認して再読み込みしてください。";
      case "no_candidates":
        return "リストに該当する本がありません。テーマを変えてお試しください。";
      case "planner_failed":
        return "生成元が学習ルートを作成できませんでした。少し時間をおいて再度お試しください。";
    }
  }
  return "学習ルートの作成に失敗しました。少し時間をおいて再度お試しください。";
}
