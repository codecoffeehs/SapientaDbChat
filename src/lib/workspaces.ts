import type { Database } from "@/lib/databases";

export type Theme = "light" | "dark";

export interface Workspace {
  id: string;
  name: string;
  provider: Database["id"];
  databaseName: string;
  createdAt: number;
  lastTestedAt: number;
}

export interface AppData {
  workspaces: Workspace[];
  theme: Theme | null;
}

export interface ConnectionTest {
  testId: string;
  databaseName: string;
  elapsedMs: number;
}
