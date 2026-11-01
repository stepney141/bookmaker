import type { LearningPathPlanRequest } from "./types";

const SYSTEM_PROMPT = [
  "あなたは読書による学習の順序を提案します。出力は日本語にしてください。",
  "候補リストにある本だけを使い、候補の ID で指定してください。リストにない本は挙げないでください。",
  "候補には意味の類似度で拾った無関係な本も混ざっています。テーマと無関係な候補は使わないでください。",
  "入門から発展へ 2〜5 段階に分け、各段階に名前、到達目標、読む順序で並べた本、各本の選定理由を書いてください。",
  "同じ本は一度だけ使ってください。書誌の「入門」「講義」「専門書」、シリーズ名、出版社、説明文を難易度の根拠にし、推測で断定しないでください。",
  "overview にはテーマの学び方の全体像を 2〜3 文で書いてください。",
  "不足する段階や分野は gaps に「リストに該当する本がない」と文章で示してください。候補だけでは段階を埋められない場合も、無関係な本で補わないでください。"
].join("\n");

export function createLearningPathPrompt(request: LearningPathPlanRequest): {
  readonly system: string;
  readonly user: string;
} {
  return {
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      topic: request.topic,
      candidates: request.candidates.map(({ id, book }) => ({
        id,
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        publishedDate: book.publishedDate,
        lists: [book.inWish ? "読みたい本" : null, book.inStacked ? "積読" : null].filter((list) => list !== null),
        description: book.description.replace(/\s+/gu, " ").trim().slice(0, 1200)
      }))
    })
  };
}
