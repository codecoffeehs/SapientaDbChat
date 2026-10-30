import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  mobileOpen: boolean;
  sidebarSearch: string;
  workspaceSearch: string;
  workspaceView: "grid" | "list";
  previewDatabase: number;
  previewQuestion: number;
}

export const useUiStore = create<UiState & { setUi: (state: Partial<UiState>) => void }>((set) => ({
  sidebarOpen: true,
  mobileOpen: false,
  sidebarSearch: "",
  workspaceSearch: "",
  workspaceView: "grid",
  previewDatabase: 0,
  previewQuestion: 0,
  setUi: (state) => set(state),
}));
