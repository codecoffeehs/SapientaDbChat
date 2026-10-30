import { create } from "zustand";

interface ChatDraft {
  draft: string;
  detailsOpen: boolean;
}

export const useChatDraft = create<ChatDraft & {
  setChat: (state: Partial<ChatDraft>) => void;
  resetChat: () => void;
}>((set) => ({
  draft: "",
  detailsOpen: false,
  setChat: (state) => set(state),
  resetChat: () => set({ draft: "", detailsOpen: false }),
}));
