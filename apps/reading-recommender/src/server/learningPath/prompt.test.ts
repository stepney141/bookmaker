import { describe, expect, it } from "vitest";

import { snapshotOf, stackedBook, wishBook } from "../testing/books";

import { createLearningPathPrompt } from "./prompt";

describe("createLearningPathPrompt", () => {
  it("includes the topic, IDs, bibliography and list memberships without URLs", () => {
    const prompt = createLearningPathPrompt({
      topic: "測度論的確率論を勉強したい",
      candidates: [
        {
          id: "b1",
          book: snapshotOf(
            wishBook({
              bookmeterUrl: "https://bookmeter.example/books/1",
              title: "測度論入門",
              author: "山田太郎",
              publisher: "数学出版",
              publishedDate: "2026-10",
              description: "測度と積分の基礎。",
              sophiaOpacUrl: "https://opac.example/sophia/1",
              utokyoOpacUrl: "https://opac.example/utokyo/1",
              remoteRank: 1
            })
          )
        },
        {
          id: "b2",
          book: snapshotOf(
            stackedBook({
              bookmeterUrl: "https://bookmeter.example/books/2",
              title: "確率論講義",
              author: "佐藤花子",
              publisher: "確率書房",
              publishedDate: "2025-04",
              description: "確率変数と分布を学ぶ。",
              sophiaOpacUrl: "https://opac.example/sophia/2",
              utokyoOpacUrl: "https://opac.example/utokyo/2",
              remoteRank: 2
            })
          )
        },
        {
          id: "b3",
          book: snapshotOf({
            ...stackedBook({
              bookmeterUrl: "https://bookmeter.example/books/3",
              title: "確率過程演習",
              author: "鈴木一郎",
              publisher: "解析社",
              publishedDate: "2024-08",
              description: "確率過程の問題を解く。",
              sophiaOpacUrl: "https://opac.example/sophia/3",
              utokyoOpacUrl: "https://opac.example/utokyo/3",
              remoteRank: 3
            }),
            inWish: true,
            wishRowid: 3
          })
        }
      ]
    });
    const user: unknown = JSON.parse(prompt.user);

    expect(user).toEqual({
      topic: "測度論的確率論を勉強したい",
      candidates: [
        {
          id: "b1",
          title: "測度論入門",
          author: "山田太郎",
          publisher: "数学出版",
          publishedDate: "2026-10",
          lists: ["読みたい本"],
          description: "測度と積分の基礎。"
        },
        {
          id: "b2",
          title: "確率論講義",
          author: "佐藤花子",
          publisher: "確率書房",
          publishedDate: "2025-04",
          lists: ["積読"],
          description: "確率変数と分布を学ぶ。"
        },
        {
          id: "b3",
          title: "確率過程演習",
          author: "鈴木一郎",
          publisher: "解析社",
          publishedDate: "2024-08",
          lists: ["読みたい本", "積読"],
          description: "確率過程の問題を解く。"
        }
      ]
    });
  });

  it("limits each description to 1200 characters", () => {
    const description = `${"あ".repeat(1199)}境除外`;
    const prompt = createLearningPathPrompt({
      topic: "数学",
      candidates: [
        {
          id: "b1",
          book: snapshotOf(
            wishBook({
              bookmeterUrl: "https://bookmeter.example/books/1",
              title: "測度論入門",
              author: "山田太郎",
              publisher: "数学出版",
              publishedDate: "2026-10",
              description,
              remoteRank: 1
            })
          )
        }
      ]
    });
    const user: unknown = JSON.parse(prompt.user);

    expect(user).toEqual({
      topic: "数学",
      candidates: [
        {
          id: "b1",
          title: "測度論入門",
          author: "山田太郎",
          publisher: "数学出版",
          publishedDate: "2026-10",
          lists: ["読みたい本"],
          description: `${"あ".repeat(1199)}境`
        }
      ]
    });
  });
});
