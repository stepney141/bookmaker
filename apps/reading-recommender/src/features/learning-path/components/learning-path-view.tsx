import { useEffect, useState } from "react";

import { BookDetailDialog } from "@/components/book-detail-dialog";
import { OpacLinks } from "@/components/opac-links";
import { libraryLabel, listLabel } from "@/utils/book-labels";
import { isActivationKey } from "@/utils/is-activation-key";

import { createLearningPath } from "../api/create-learning-path";
import { fetchLearningPathPlanners } from "../api/fetch-learning-path-planners";
import { learningPathErrorMessage } from "../utils/learning-path-error-message";

import type { LearningPath, LearningPathBook, LearningPathPlannerId, LearningPathPlannerInfo } from "@/types/api";
import type { JSX } from "react";

export function LearningPathView(): JSX.Element {
  const [topic, setTopic] = useState("");
  const [planners, setPlanners] = useState<readonly LearningPathPlannerInfo[] | null>(null);
  const [plannerId, setPlannerId] = useState<LearningPathPlannerId | null>(null);
  const [learningPath, setLearningPath] = useState<LearningPath | null>(null);
  const [selectedBook, setSelectedBook] = useState<LearningPathBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetchLearningPathPlanners()
      .then((nextPlanners) => {
        setPlanners(nextPlanners);
        setPlannerId(nextPlanners.length > 0 ? nextPlanners[0].id : null);
      })
      .catch(() => {
        setError("生成元の読み込みに失敗しました。再読み込みしてください。");
      });
  }, []);

  async function submit(): Promise<void> {
    if (pending || plannerId === null) {
      return;
    }
    const trimmedTopic = topic.trim();
    if (trimmedTopic.length < 1 || trimmedTopic.length > 200) {
      setError("学びたいテーマを1〜200文字で入力してください。");
      return;
    }

    setError(null);
    setLearningPath(null);
    setSelectedBook(null);
    setPending(true);
    try {
      setLearningPath(await createLearningPath(trimmedTopic, plannerId));
    } catch (cause) {
      setError(learningPathErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  const formDisabled = pending || plannerId === null;

  return (
    <section className="view" aria-busy={pending}>
      <h2>学習ルート</h2>
      <p className="status">読みたい本と積読本から、学びたいテーマに沿った読む順番を作成します。</p>
      {planners === null && error === null ? <p className="status">生成元を読み込んでいます。</p> : null}
      {planners?.length === 0 ? (
        <p className="status">
          生成元が設定されていません。Claude を使う場合は ANTHROPIC_API_KEY、OpenAI を使う場合は OPENAI_API_KEY と
          OPENAI_LEARNING_PATH_MODEL を設定して、サーバーを再起動してください。
        </p>
      ) : null}
      <form
        className="view compact"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          学びたいテーマ
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="測度論的確率論を勉強したい"
            maxLength={200}
            required
            disabled={formDisabled}
          />
        </label>
        {planners !== null && planners.length >= 2 && plannerId !== null ? (
          <label>
            生成元
            <select
              value={plannerId}
              onChange={(event) => setPlannerId(event.target.value as LearningPathPlannerId)}
              disabled={formDisabled}
            >
              {planners.map((planner) => (
                <option key={planner.id} value={planner.id}>
                  {planner.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="toolbar">
          <button type="submit" disabled={formDisabled}>
            学習ルートを作成
          </button>
        </div>
      </form>
      {pending ? (
        <p className="status" role="status">
          学習ルートを作成しています。数十秒かかることがあります。
        </p>
      ) : null}
      {error ? (
        <p className="status status--error" role="alert">
          {error}
        </p>
      ) : null}
      {learningPath ? (
        <div className="view">
          <p className="book-panel__desc">{learningPath.overview}</p>
          {learningPath.stages.map((stage, stageIndex) => (
            <section key={stageIndex} className="view">
              <h3>
                {stageIndex + 1}. {stage.title}
              </h3>
              <p className="status">{stage.goal}</p>
              <div className="result-list">
                {stage.books.map((book, bookIndex) => (
                  <article
                    key={book.bookmeterUrl}
                    className="result-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedBook(book)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && isActivationKey(event)) {
                        event.preventDefault();
                        setSelectedBook(book);
                      }
                    }}
                  >
                    <span>{bookIndex + 1}</span>
                    <div>
                      <h4>{book.title}</h4>
                      <p>
                        {book.author} / {listLabel(book)} / {libraryLabel(book)}
                      </p>
                      <p className="learning-path-reason">{book.reason}</p>
                    </div>
                    <div className="result-row__actions">
                      <OpacLinks book={book} stopPropagation />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {learningPath.gaps.length > 0 ? (
            <section className="view">
              <h3>リストで不足している内容</h3>
              {learningPath.gaps.map((gap, index) => (
                <p key={index} className="book-panel__desc">
                  {gap}
                </p>
              ))}
            </section>
          ) : null}
          <p className="status">
            {learningPath.planner.label}（{learningPath.planner.modelId}）が作成しました。
          </p>
        </div>
      ) : null}
      {selectedBook ? (
        <BookDetailDialog
          book={selectedBook}
          reasons={[selectedBook.reason]}
          titleId="learning-path-book-title"
          onClose={() => setSelectedBook(null)}
        />
      ) : null}
    </section>
  );
}
