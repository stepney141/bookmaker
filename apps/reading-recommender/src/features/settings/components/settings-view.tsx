import { useState } from "react";

import type { AppSettings } from "@/types/api";
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

export function SettingsView(input: {
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
