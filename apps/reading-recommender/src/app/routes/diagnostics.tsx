import { DiagnosticsView } from "@/features/diagnostics/components/diagnostics-view";

import { useAppData } from "../provider";

import type { JSX } from "react";

export function DiagnosticsRoute(): JSX.Element {
  const { diagnostics } = useAppData();
  return <DiagnosticsView diagnostics={diagnostics} />;
}
