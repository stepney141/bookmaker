import type { RowOrderDiagnostics } from "@/types/api";
import type { JSX } from "react";

export function DiagnosticsView(input: { readonly diagnostics: readonly RowOrderDiagnostics[] }): JSX.Element {
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
