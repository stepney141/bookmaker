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

const JP_WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const ONE_DAY_MS = 86_400_000;

function formatSlipDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, "0")} (${JP_WEEKDAYS[date.getDay()]})`;
}

function nextRecommendationDate(dayOfWeek: number, from: Date): Date {
  const base = Number.isNaN(from.getTime()) ? new Date() : from;
  const delta = ((dayOfWeek - base.getDay() + 6) % 7) + 1;
  return new Date(base.getTime() + delta * ONE_DAY_MS);
}

function CurrentView(input: {
  readonly current: CurrentRecommendation | null;
  readonly settings: AppSettings | null;
  readonly loading: boolean;
  readonly onRun: () => Promise<void>;
  readonly onSkip: () => Promise<void>;
  readonly onPromote: (bookmeterUrl: string) => Promise<void>;
}): JSX.Element {
  const [selectedRelatedBook, setSelectedRelatedBook] = useState<CurrentRecommendation["relatedBooks"][number] | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError("操作に失敗しました。少し時間をおいて再度お試しください。");
    }
  }

  if (input.loading) {
    return (
      <section className="view" aria-busy="true">
        <div className="skeleton-card">
          <div className="skeleton-line skeleton-line--kicker" />
          <div className="skeleton-line skeleton-line--title" />
          <div className="skeleton-line skeleton-line--title skeleton-line--short" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-line--short" />
        </div>
      </section>
    );
  }

  if (!input.current?.primary) {
    return (
      <section className="view">
        <h2 className="section-label">今週の一冊</h2>
        <p className="status">推薦を作成できる書籍がありません。</p>
        <button onClick={() => void runAction(input.onRun)}>推薦を更新</button>
        {actionError ? (
          <p className="status status--error" role="alert">
            {actionError}
          </p>
        ) : null}
      </section>
    );
  }

  const recommendationDate = new Date(input.current.createdAt);
  const plannedFinishDate = input.settings
    ? nextRecommendationDate(input.settings.recommendationDayOfWeek, recommendationDate)
    : null;
  const recommendationSlip = (
    <div className="recommendation-slip">
      <span className="recommendation-slip__col">
        <span className="recommendation-slip__key">推薦日</span>
        <span className="recommendation-slip__val">{formatSlipDate(recommendationDate)}</span>
      </span>
      <span className="recommendation-slip__sep" />
      <span className="recommendation-slip__col">
        <span className="recommendation-slip__key">読了予定</span>
        <span className="recommendation-slip__val">{plannedFinishDate ? formatSlipDate(plannedFinishDate) : "—"}</span>
      </span>
    </div>
  );

  return (
    <section className="view">
      <div className="view-heading">
        <p className="cycle-meta">
          CYCLE {input.current.cycleId} · {input.current.reason}
        </p>
        <div className="toolbar">
          <button onClick={() => void runAction(input.onRun)}>更新</button>
          <button onClick={() => void runAction(input.onSkip)}>skip</button>
        </div>
      </div>
      {actionError ? (
        <p className="status status--error" role="alert">
          {actionError}
        </p>
      ) : null}
      <BookPanel book={input.current.primary} featured kicker="今週の一冊" slip={recommendationSlip} />
      <h2 className="section-label">次の候補</h2>
      <div className="grid">
        {input.current.secondaries.map((book) => (
          <BookPanel
            key={book.bookmeterUrl}
            book={book}
            kicker="候補"
            actionLabel="今週はこれを読む"
            onAction={() => void runAction(() => input.onPromote(book.bookmeterUrl))}
          />
        ))}
      </div>
      <h2 className="section-label">近い内容の本</h2>
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
              <span className="related-row__score">{book.score.toFixed(3)}</span>
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
  readonly onSave: (settings: Partial<AppSettings>) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<Partial<AppSettings>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const settings = input.settings;

  async function save(): Promise<void> {
    setSaveError(null);
    try {
      await input.onSave(draft);
    } catch {
      setSaveError("設定の保存に失敗しました。");
    }
  }

  if (!settings) {
    return (
      <section className="view compact" aria-busy="true">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-field" />
        <div className="skeleton-field" />
        <div className="skeleton-field" />
      </section>
    );
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
      <button onClick={() => void save()}>保存</button>
      {saveError ? (
        <p className="status status--error" role="alert">
          {saveError}
        </p>
      ) : null}
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
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextCurrent, nextSettings, nextDiagnostics] = await Promise.all([
        fetchCurrentRecommendation(),
        fetchSettings(),
        fetchDiagnostics()
      ]);
      setCurrent(nextCurrent);
      setSettings(nextSettings);
      setDiagnostics(nextDiagnostics);
    } catch {
      setLoadError("データの読み込みに失敗しました。再読み込みしてください。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <main className="app-shell">
      <header className="app-masthead">
        <h1 className="app-masthead__title">読書目録</h1>
        <span className="app-masthead__kicker">READING CATALOGUE</span>
      </header>
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
      {loadError ? (
        <p className="status status--error" role="alert">
          {loadError}
        </p>
      ) : null}
      <Routes>
        <Route
          path="/"
          element={
            <CurrentView
              current={current}
              settings={settings}
              loading={loading}
              onRun={() => runRecommendation().then(setCurrent)}
              onSkip={() => skipRecommendation().then(setCurrent)}
              onPromote={(bookmeterUrl) => promoteRecommendation(bookmeterUrl).then(setCurrent)}
            />
          }
        />
        <Route path="/search" element={<SearchPage />} />
        <Route
          path="/settings"
          element={
            <SettingsView
              settings={settings}
              onSave={(nextSettings) => updateSettings(nextSettings).then(setSettings)}
            />
          }
        />
        <Route path="/diagnostics" element={<DiagnosticsView diagnostics={diagnostics} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}
