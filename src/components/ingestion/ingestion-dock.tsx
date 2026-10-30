import { StopIngestionButton } from "@/components/ingestion/stop-ingestion-button";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { ingestionCounts, type IngestionRun } from "@/lib/ingestion";
import { useIngestionUi } from "@/stores/ingestion-ui";

export function IngestionDock() {
  const { data: runs = [], error } = useQuery({
    queryKey: ["active-ingestions"], queryFn: () => invoke<IngestionRun[]>("active_ingestions"),
    enabled: isTauri(), refetchInterval: 1500, refetchIntervalInBackground: true,
  });
  const clock = useIngestionUi((state) => state.clock);
  const setClock = useIngestionUi((state) => state.setClock);
  useEffect(() => {
    if (!runs.length) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runs.length, setClock]);
  if (!runs.length) return null;
  return <aside aria-label="Background progress" className="fixed right-4 bottom-4 z-30 max-h-60 w-80 max-w-[calc(100vw-2rem)] space-y-2 overflow-y-auto rounded-2xl border bg-background/95 p-3 shadow-xl backdrop-blur-xl">
    {runs.map((run) => {
      const counts = ingestionCounts(run.items);
      const elapsed = run.startedAt ? Math.max(0, Math.floor(clock / 1000 - run.startedAt)) : 0;
      return <div key={run.id}><Link to="/workspaces/$workspaceId/ingestion" params={{ workspaceId: run.workspaceId }} className="block rounded-xl p-2 hover:bg-muted/50">
        <div className="flex items-center gap-2"><HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin text-primary" /><span className="flex-1 text-xs font-medium">{run.status === "scanning" ? "Checking database" : run.status === "saving" ? "Saving your guide" : "Preparing your database"}</span><span className="text-xs tabular-nums">{run.percent}%</span></div>
        <p className="mt-2 truncate text-[11px] text-muted-foreground">{run.current ?? "Getting things ready…"}</p>
        {run.status !== "scanning" && <p className="mt-2 text-[11px] text-muted-foreground">{counts.total} selected · {counts.ready} ready · {counts.remaining} remaining</p>}
        <progress value={run.percent} max={100} aria-label="Current progress" className="mt-3 block h-1 w-full accent-primary" />
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>{Math.floor(elapsed / 60)}m {elapsed % 60}s · Keep app running</span><span className="flex items-center gap-1">View<HugeiconsIcon icon={ArrowRight02Icon} size={12} /></span></div>
      </Link><div className="px-2 pb-2"><StopIngestionButton workspaceId={run.workspaceId} saving={run.status === "saving"} /></div></div>;
    })}
    {error != null && <p role="status" className="px-2 text-[10px] text-destructive">Progress may be out of date. Open setup to retry.</p>}
  </aside>;
}
