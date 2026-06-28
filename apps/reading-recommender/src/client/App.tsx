import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router";

import {
  fetchCurrentRecommendation,
  fetchDiagnostics,
  fetchSettings,
  promoteRecommendation,
  runRecommendation,
  skipRecommendation,
  updateSettings
} from "./api";
import { BookDetailDialog, BookPanel, OpacLinks, isActivationKey } from "./components/bookUi";
import { SearchPage } from "./pages/SearchPage";

import type { AppSettings, CurrentRecommendation, RowOrderDiagnostics } from "../shared/types";
import type { JSX } from "react";

const RECOMMENDATION_DAY_OPTIONS = [
  { value: 0, label: "日曜日" },
  { value: 1, label: "月曜日" },
  { value: 2, label: "火曜日" },
  { value: 3, label: "水曜日" },
  { value: 4, label: "木曜日" },
  { value: 5, label: "金曜日" },
  { value: 6, label: "土曜日" }
] as const;

function CurrentView(input: {
  readonly current: CurrentRecommendation | null;
  readonly loading: boolean;
  readonly onRun: () => void;
  readonly onSkip: () => void;
  readonly onPromote: (bookmeterUrl: string) => void;
}): JSX.Element {
  const [selectedRelatedBook, setSelectedRelatedBook] = useState<CurrentRecommendation["relatedBooks"][number] | null>(
    null
  );

  if (input.loading) {
    return <p className="status">読み込み中です。</p>;
  }

  if (!input.current?.primary) {
    return (
      <section className="view">
        <h2>今週読む本</h2>
        <p className="status">推薦を作成できる書籍がありません。</p>
        <button onClick={input.onRun}>推薦を更新</button>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="view-heading">
        <div>
          <h2>今週読む本</h2>
          <p>
            cycle {input.current.cycleId} / {input.current.reason}
          </p>
        </div>
        <div className="toolbar">
          <button onClick={input.onRun}>更新</button>
          <button onClick={input.onSkip}>skip</button>
        </div>
      </div>
      <BookPanel book={input.current.primary} />
      <h2>副推薦</h2>
      <div className="grid">
        {input.current.secondaries.map((book) => (
          <BookPanel
            key={book.bookmeterUrl}
            book={book}
            actionLabel="今週はこれを読む"
            onAction={() => input.onPromote(book.bookmeterUrl)}
          />
        ))}
      </div>
      <h2>近い内容の本</h2>
      <div className="related-list">
        {input.current.relatedBooks.map((book) => (
          <article
            key={book.bookmeterUrl}
            className="related-row"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedRelatedBook(book)}
            onKeyDown={(event) => {
              if (isActivationKey(event)) {
                event.preventDefault();
                setSelectedRelatedBook(book);
              }
            }}
          >
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <p>{book.reasons.join(" ")}</p>
            </div>
            <div className="related-row__actions">
              <span>{book.score.toFixed(3)}</span>
              <a
                className="button-link button-link--bookmeter"
                href={book.bookmeterUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Bookmeter
              </a>
              <OpacLinks book={book} stopPropagation />
            </div>
          </article>
        ))}
      </div>
      {selectedRelatedBook ? (
        <BookDetailDialog
          book={selectedRelatedBook}
          titleId="related-book-title"
          onClose={() => setSelectedRelatedBook(null)}
        />
      ) : null}
    </section>
  );
}

function SettingsView(input: {
  readonly settings: AppSettings | null;
  readonly onSave: (settings: Partial<AppSettings>) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Partial<AppSettings>>({});
  const settings = input.settings;

  if (!settings) {
    return <p className="status">設定を読み込み中です。</p>;
  }

  const merged = { ...settings, ...draft };

  return (
    <section className="view compact">
      <h2>設定</h2>
      <label>
        推薦曜日
        <select
          value={String(merged.recommendationDayOfWeek)}
          onChange={(event) => setDraft({ ...draft, recommendationDayOfWeek: Number(event.target.value) })}
        >
          {RECOMMENDATION_DAY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        推薦時刻
        <input
          value={merged.recommendationTime}
          onChange={(event) => setDraft({ ...draft, recommendationTime: event.target.value })}
        />
      </label>
      <label>
        読書メーター表示順の扱い
        <select
          value={merged.remoteOrderAgeDirection}
          onChange={(event) =>
            setDraft({
              ...draft,
              remoteOrderAgeDirection: event.target.value as AppSettings["remoteOrderAgeDirection"]
            })
          }
        >
          <option value="larger_is_older">表示順の後ろを古い本として扱う</option>
          <option value="larger_is_newer">表示順の先頭を古い本として扱う</option>
          <option value="disabled">表示順を推薦に使わない</option>
        </select>
      </label>
      <button onClick={() => input.onSave(draft)}>保存</button>
    </section>
  );
}

function DiagnosticsView(input: { readonly diagnostics: readonly RowOrderDiagnostics[] }): JSX.Element {
  return (
    <section className="view">
      <h2>診断</h2>
      {input.diagnostics.map((diagnostic) => (
        <div key={diagnostic.tableName} className="diagnostic">
          <h3>{diagnostic.tableName}</h3>
          <div className="grid">
            <div>
              <h4>先頭</h4>
              {diagnostic.firstRows.map((row) => (
                <p key={row.rowid}>
                  {row.rowid}. {row.title} / {row.author}
                </p>
              ))}
            </div>
            <div>
              <h4>末尾</h4>
              {diagnostic.lastRows.map((row) => (
                <p key={row.rowid}>
                  {row.rowid}. {row.title} / {row.author}
                </p>
              ))}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

export function App(): JSX.Element {
  const [current, setCurrent] = useState<CurrentRecommendation | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly RowOrderDiagnostics[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh(): Promise<void> {
    setLoading(true);
    const [nextCurrent, nextSettings, nextDiagnostics] = await Promise.all([
      fetchCurrentRecommendation(),
      fetchSettings(),
      fetchDiagnostics()
    ]);
    setCurrent(nextCurrent);
    setSettings(nextSettings);
    setDiagnostics(nextDiagnostics);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <main className="app-shell">
      <nav>
        <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/" end>
          推薦
        </NavLink>
        <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/search">
          検索
        </NavLink>
        <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/settings">
          設定
        </NavLink>
        <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/diagnostics">
          診断
        </NavLink>
      </nav>
      <Routes>
        <Route
          path="/"
          element={
            <CurrentView
              current={current}
              loading={loading}
              onRun={() => {
                void runRecommendation().then(setCurrent);
              }}
              onSkip={() => {
                void skipRecommendation().then(setCurrent);
              }}
              onPromote={(bookmeterUrl) => {
                void promoteRecommendation(bookmeterUrl).then(setCurrent);
              }}
            />
          }
        />
        <Route path="/search" element={<SearchPage />} />
        <Route
          path="/settings"
          element={
            <SettingsView
              settings={settings}
              onSave={(nextSettings) => {
                void updateSettings(nextSettings).then(setSettings);
              }}
            />
          }
        />
        <Route path="/diagnostics" element={<DiagnosticsView diagnostics={diagnostics} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}
