import { Outlet } from "react-router";

import { MainLayout } from "@/components/layouts/main-layout";

import { useAppData } from "../provider";

import type { JSX } from "react";

export function RootRoute(): JSX.Element {
  const { loadError } = useAppData();
  return (
    <MainLayout>
      {loadError ? (
        <p className="status status--error" role="alert">
          {loadError}
        </p>
      ) : null}
      <Outlet />
    </MainLayout>
  );
}
