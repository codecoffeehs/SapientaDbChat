import { create } from "zustand";
import type { S3Draft } from "@/lib/ingestion";

const emptyDraft: S3Draft = { name: "", endpoint: "", accessKeyId: "", secretAccessKey: "", bucket: "db.schemas", publicBaseUrl: "", region: "" };

interface IngestionUi {
  clock: number;
  setClock: (clock: number) => void;
  steps: Record<string, number>;
  setStep: (runId: string, step: number) => void;
  elapsedSeconds: number;
  setElapsedSeconds: (seconds: number) => void;
  destinations: Record<string, string>;
  s3Open: boolean;
  s3Draft: S3Draft;
  selectDestination: (workspaceId: string, destinationId: string) => void;
  setS3Open: (open: boolean) => void;
  setS3Draft: (draft: Partial<S3Draft>) => void;
}

export const useIngestionUi = create<IngestionUi>((set) => ({
  clock: Date.now(),
  setClock: (clock) => set({ clock }),
  steps: {},
  setStep: (runId, step) => set(({ steps }) => ({ steps: { ...steps, [runId]: step } })),
  elapsedSeconds: 0,
  setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),
  destinations: {},
  s3Open: false,
  s3Draft: emptyDraft,
  selectDestination: (workspaceId, destinationId) => set(({ destinations }) => ({ destinations: { ...destinations, [workspaceId]: destinationId } })),
  setS3Open: (open) => set({ s3Open: open, ...(!open ? { s3Draft: emptyDraft } : {}) }),
  setS3Draft: (draft) => set(({ s3Draft }) => ({ s3Draft: { ...s3Draft, ...draft } })),
}));
