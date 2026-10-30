import { IngestionDock } from "@/components/ingestion/ingestion-dock";
import { ApiKeyDialog } from "@/components/ingestion/api-key-dialog";
import { useEffect } from "react";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { appDataOptions, systemTheme } from "@/lib/queries";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="page-enter mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Let’s get you back.</h1>
      <p className="mt-3 text-muted-foreground">This page doesn’t exist.</p>
      <Link to="/" className="mt-6 inline-block text-sm font-medium text-primary underline underline-offset-4">Back to welcome</Link>
    </div>
  ),
});

function RootLayout() {
  const { data } = useQuery(appDataOptions);
  const theme = data?.theme ?? systemTheme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return <><Outlet /><IngestionDock /><ApiKeyDialog /></>;
}
