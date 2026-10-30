import { StopIngestionButton } from "@/components/ingestion/stop-ingestion-button";
import { useEffect } from "react";
import { useIngestionUi } from "@/stores/ingestion-ui";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, Loading03Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import { activeIngestionStatuses, ingestionCounts, type IngestionRun } from "@/lib/ingestion";

export function IngestionProgress({ run }: { run: IngestionRun }) {
  const { status, percent, total, checked, current, error, location, detail, startedAt } = run;
  const active = activeIngestionStatuses.includes(status);
  const counts = ingestionCounts(run.items);
  const elapsed = useIngestionUi((state) => state.elapsedSeconds);
  const setElapsed = useIngestionUi((state) => state.setElapsedSeconds);
  useEffect(() => {
    if (!active || !startedAt) return;
    const tick = () => setElapsed(Math.max(0, Math.floor(Date.now() / 1000 - startedAt)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt, setElapsed]);
  const complete = status === "completed";
  const title = status === "scanning" ? "Checking your database"
    : status === "ready" ? "Check complete — choose where to save next"
    : status === "saving" ? "Saving your database guide"
    : status === "ingesting" ? "Preparing your database for chat"
    : complete ? "Your database is ready"
    : status === "partial" ? "Saved, with a few items to revisit"
    : status === "cancelled" ? "Stopped — your completed work is kept"
    : status === "interrupted" ? "You can continue where you left off" : "Something needs your attention";

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-7">
      <div className="flex flex-wrap items-center gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><HugeiconsIcon icon={active ? Loading03Icon : complete ? CheckmarkCircle02Icon : status === "ready" ? CheckmarkCircle02Icon : AlertCircleIcon}
            size={17} className={active ? "animate-spin text-primary" : "text-primary"} aria-hidden="true" /><h2 role="status" className="text-base font-medium tracking-tight">{title}</h2></div>
          <p className="mt-2 text-sm text-muted-foreground">{status === "scanning" ? `${checked} of ${total} items checked` : `${counts.ready} of ${counts.total} selected tables ready`}</p>
          {current && <p className="mt-2 truncate font-mono text-xs text-muted-foreground" title={current}>{current}</p>}
          {active && detail && <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>}
          {active && <p className="mt-3 text-xs font-medium">Keep Sapienta open. Closing or quitting interrupts ingestion.</p>}
        </div>
      </div>
      {(active || complete || status === "partial") && <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted-foreground">{status === "scanning" ? "Database check" : "Selected tables ready"}</span><span className="font-medium tabular-nums">{percent}%</span></div>
        <div role="progressbar" aria-label={status === "scanning" ? "Database check" : "Selected tables ready"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} /></div>
      </div>}
      {status !== "scanning" && <dl className="mt-5 grid grid-cols-3 gap-4">
        {[{ label: "Total selected", value: counts.total }, { label: "Ready", value: counts.ready }, { label: "Remaining", value: counts.remaining }].map(({ label, value }) => <div key={label}><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-medium tabular-nums">{value}</dd></div>)}
      </dl>}
      {active && <div className="mt-5 rounded-xl border border-primary/15 bg-primary/5 p-4 text-xs leading-6"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{status === "saving" ? "Last step · saving your guide" : status === "scanning" ? "Checking which items contain data" : "Writing your database guide"}</span><span className="font-mono text-[11px] tabular-nums">{Math.floor(elapsed / 60)}m {elapsed % 60}s elapsed</span></div><p className="mt-1 text-muted-foreground">Your progress is saved on this device. You can navigate within Sapienta and return here. Please keep the app running until saving finishes.</p></div>}
      {active && <div className="mt-4 flex items-center justify-end gap-3"><StopIngestionButton workspaceId={run.workspaceId} saving={status === "saving"} /></div>}
      {status !== "scanning" && counts.failed > 0 && <p className="mt-5 text-xs text-muted-foreground">{counts.failed} of the remaining tables need a retry. Open the ingestion results to see each error.</p>}
      {error && <p role="alert" className="mt-5 rounded-xl bg-destructive/5 p-3 text-xs leading-5 text-destructive">{error}</p>}
      {location && <div className="mt-5 border-t pt-4"><p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Saved database guide</p><p className="mt-2 break-all font-mono text-xs select-text">{location}</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">AI descriptions can be wrong. Review your database guide before relying on it.</p></div>}
    </div>
  );
}
