import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { DiagnosticsRoute } from "./routes/diagnostics";
import { LearningPathRoute } from "./routes/learning-path";
import { RecommendationsRoute } from "./routes/recommendations";
import { RootRoute } from "./routes/root";
import { SearchRoute } from "./routes/search";
import { SettingsRoute } from "./routes/settings";

import type { JSX } from "react";

export function AppRouter(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RootRoute />}>
          <Route path="/" element={<RecommendationsRoute />} />
          <Route path="/search" element={<SearchRoute />} />
          <Route path="/learning-path" element={<LearningPathRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="/diagnostics" element={<DiagnosticsRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
