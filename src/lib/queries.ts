import { QueryClient, queryOptions } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppData, Theme } from "@/lib/workspaces";

// Tauri commands reject with strings as well as JavaScript errors.
declare module "@tanstack/react-query" {
  interface Register {
    defaultError: unknown;
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    // Tauri IPC and local SQLite remain available when the browser reports offline.
    queries: { staleTime: 30_000, retry: false, networkMode: "always" },
    mutations: { retry: false, gcTime: 0, networkMode: "always" },
  },
});

export const systemTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export const appDataOptions = queryOptions({
  queryKey: ["app-data"],
  queryFn: async (): Promise<AppData> => isTauri()
    ? invoke<AppData>("get_app_data")
    : { workspaces: [], theme: queryClient.getQueryData<AppData>(["app-data"])?.theme ?? systemTheme },
});

export function errorMessage(error: unknown, fallback: string) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : fallback;
}
