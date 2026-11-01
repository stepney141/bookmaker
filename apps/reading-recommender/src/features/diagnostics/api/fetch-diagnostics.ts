import { requestJson } from "@/lib/api-client";

import type { RowOrderDiagnostics } from "@/types/api";

export function fetchDiagnostics(): Promise<readonly RowOrderDiagnostics[]> {
  return requestJson<readonly RowOrderDiagnostics[]>("/api/books/diagnostics/row-order");
}
