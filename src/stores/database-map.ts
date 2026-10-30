import { create } from "zustand";
import type { MapLink } from "@/lib/database-map";

export interface MapSession {
  descriptions: Record<string, string>; links: MapLink[] | null; positions: Record<string, { x: number; y: number }>;
  selected: { kind: "table" | "link"; id: string } | null;
  draft: string; linkDraft: MapLink | null; edited: boolean;
}
const emptySession: MapSession = { descriptions: {}, links: null, positions: {}, selected: null, draft: "", linkDraft: null, edited: false };
export const useDatabaseMap = create<{
  sessions: Record<string, MapSession>;
  update: (id: string, patch: Partial<MapSession>) => void;
}>((set) => ({
  sessions: {},
  update: (id, patch) => set(({ sessions }) => ({ sessions: { ...sessions, [id]: { ...emptySession, ...sessions[id], ...patch } } })),
}));
export const defaultMapSession = emptySession;
