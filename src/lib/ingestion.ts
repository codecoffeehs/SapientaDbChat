export interface IngestionRun {
  detail: string | null;
  startedAt: number;
  id: string;
  workspaceId: string;
  status: "scanning" | "ready" | "ingesting" | "saving" | "completed" | "partial" | "failed" | "interrupted" | "cancelled";
  scanComplete: boolean;
  current: string | null;
  error: string | null;
  destinationId: string | null;
  location: string | null;
  total: number;
  checked: number;
  eligible: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  percent: number;
  items: {
    schema: string;
    name: string;
    status: "pending" | "data" | "empty" | "error" | "processing" | "done" | "failed";
    isEmpty: boolean;
    includeEmpty: boolean;
    excluded?: boolean;
    fieldCount: number;
    error: string | null;
    summary?: string | null;
    confidence?: string | null;
    uncertainties?: string[] | null;
    notes?: string[];
  }[];
}

export interface IngestionDestination {
  id: string;
  name: string;
  kind: "local" | "s3";
  description: string;
  region?: string;
}

export interface S3Draft {
  name: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  region: string;
}

export const activeIngestionStatuses = ["scanning", "ingesting", "saving"];

export function isSelectedForIngestion(item: IngestionRun["items"][number]): boolean {
  return !item.excluded && (["data", "processing", "done", "failed"].includes(item.status) ||
    (item.status === "empty" && item.includeEmpty));
}

export function countIngestionItems(items: IngestionRun["items"]): number {
  return items.filter(isSelectedForIngestion).length;
}

export function ingestionStep(run: IngestionRun | null | undefined, savedStep?: number): number {
  if (!run?.scanComplete) return 0;
  if (activeIngestionStatuses.includes(run.status) || run.status === "completed") return 3;
  if (run.items.length === 0) return 0;
  // Recheck saved navigation so an old step cannot bypass the scan results.
  if (countIngestionItems(run.items) === 0) return 1;
  return savedStep ?? (run.status === "ready" ? 1 : 3);
}

export function canChatWithRun(run: IngestionRun | null | undefined): boolean {
  return !!run && !activeIngestionStatuses.includes(run.status) && run.items.some((item) => item.status === "done" && !item.excluded);
}

export function ingestionCounts(items: IngestionRun["items"]) {
  const total = countIngestionItems(items);
  const ready = items.filter((item) => !item.excluded && item.status === "done").length;
  const failed = items.filter((item) => !item.excluded && item.status === "failed").length;
  return { total, ready, remaining: Math.max(0, total - ready), failed };
}
