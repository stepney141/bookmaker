import { NavLink } from "react-router";

import type { JSX, ReactNode } from "react";

export function MainLayout(input: { readonly children: ReactNode }): JSX.Element {
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
        <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/learning-path">
          学習ルート
        </NavLink>
        <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/settings">
          設定
        </NavLink>
        <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/diagnostics">
          診断
        </NavLink>
      </nav>
      {input.children}
    </main>
  );
}
