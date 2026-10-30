import { create } from "zustand";

interface ConnectionDraft {
  name: string;
  connectionString: string;
  showConnectionString: boolean;
}

const initialDraft: ConnectionDraft = { name: "", connectionString: "", showConnectionString: false };

// Credentials live only in memory and are cleared when the form unmounts.
export const useConnectionDraft = create<ConnectionDraft & {
  setDraft: (draft: Partial<ConnectionDraft>) => void;
  resetDraft: () => void;
}>((set) => ({
  ...initialDraft,
  setDraft: (draft) => set(draft),
  resetDraft: () => set(initialDraft),
}));
