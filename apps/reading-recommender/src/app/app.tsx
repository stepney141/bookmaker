import { AppDataProvider } from "./provider";
import { AppRouter } from "./router";

import type { JSX } from "react";

export function App(): JSX.Element {
  return (
    <AppDataProvider>
      <AppRouter />
    </AppDataProvider>
  );
}
