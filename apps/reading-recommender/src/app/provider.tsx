import { createContext, useContext, useEffect, useState } from "react";

import { fetchDiagnostics } from "@/features/diagnostics/api/fetch-diagnostics";
import { fetchCurrentRecommendation } from "@/features/recommendations/api/fetch-current-recommendation";
import { fetchSettings } from "@/features/settings/api/fetch-settings";

import type { AppSettings, CurrentRecommendation, RowOrderDiagnostics } from "@/types/api";
import type { Dispatch, JSX, ReactNode, SetStateAction } from "react";

type AppDataContextValue = {
  readonly current: CurrentRecommendation | null;
  readonly settings: AppSettings | null;
  readonly diagnostics: readonly RowOrderDiagnostics[];
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly setCurrent: Dispatch<SetStateAction<CurrentRecommendation | null>>;
  readonly setSettings: Dispatch<SetStateAction<AppSettings | null>>;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider(input: { readonly children: ReactNode }): JSX.Element {
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
    <AppDataContext.Provider value={{ current, settings, diagnostics, loading, loadError, setCurrent, setSettings }}>
      {input.children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (context === null) {
    throw new Error("useAppData must be used within AppDataProvider");
  }
  return context;
}
