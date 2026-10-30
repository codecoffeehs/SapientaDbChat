import { IngestionResults } from "@/components/ingestion/ingestion-results";
import { VirtualList } from "@/components/ingestion/virtual-list";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { Database02Icon, ArrowLeft01Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { IngestionProgress } from "@/components/ingestion/ingestion-progress";
import { TableSelection } from "@/components/ingestion/table-selection";
import { StoragePicker } from "@/components/ingestion/storage-picker";
import { appDataOptions, errorMessage } from "@/lib/queries";
import { activeIngestionStatuses, countIngestionItems, ingestionStep, type IngestionRun, type IngestionDestination } from "@/lib/ingestion";
import { useIngestionUi } from "@/stores/ingestion-ui";

export const Route = createFileRoute("/workspaces/$workspaceId/ingestion")({ component: IngestionPage });
const steps = ["Scan", "Scan results", "Save location", "Start"];

function IngestionPage() {
  const { workspaceId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: appData } = useQuery(appDataOptions);
  const workspace = appData?.workspaces.find((item) => item.id === workspaceId);
  const { data: run, isPending, error, refetch } = useQuery({
    queryKey: ["ingestion", workspaceId],
    queryFn: () => invoke<IngestionRun | null>("get_ingestion", { workspaceId }),
    staleTime: 0,
    refetchInterval: ({ state: { data } }) => data && activeIngestionStatuses.includes(data.status) ? 800 : false,
    refetchIntervalInBackground: true,
  });
  const savedStep = useIngestionUi((state) => run ? state.steps[run.id] : undefined);
  const setStep = useIngestionUi((state) => state.setStep);
  const destinationId = useIngestionUi((state) => state.destinations[workspaceId]) ?? run?.destinationId ?? "";
  const { data: destinations = [], isPending: loadingDestinations, error: destinationError, refetch: reloadDestinations } = useQuery({
    queryKey: ["ingestion-destinations"], queryFn: () => invoke<IngestionDestination[]>("list_ingestion_destinations"),
  });
  const destination = destinations.find((item) => item.id === destinationId);
  const { mutate: scan, isPending: startingScan, error: scanError } = useMutation({
    mutationFn: () => invoke<IngestionRun>("scan_workspace", { workspaceId }),
    onSuccess: (next) => { queryClient.setQueryData(["ingestion", workspaceId], next); },
  });
  const { mutate: start, isPending: starting, error: startError } = useMutation({
    mutationFn: () => invoke<IngestionRun | null>("start_ingestion", { runId: run!.id, destinationId }),
    onSuccess: (next) => { if (next) queryClient.setQueryData(["ingestion", workspaceId], next); },
  });
  const { mutate: selectItems, isPending: selecting, error: selectionError } = useMutation({
    mutationFn: (indices: number[]) => invoke<IngestionRun>("select_ingestion_items", { runId: run!.id, indices }),
    onSuccess: (next) => queryClient.setQueryData(["ingestion", workspaceId], next),
  });
  const active = !!run && activeIngestionStatuses.includes(run.status);
  const busy = active || starting || startingScan || selecting;
  const step = ingestionStep(run, savedStep);
  const emptyItems = run?.items.flatMap((item, index) => item.status === "empty" ? [{ ...item, index }] : []) ?? [];
  const operationError = scanError ?? selectionError ?? startError;
  const completed = run?.status === "completed";
  const includedCount = countIngestionItems(run?.items ?? []);
  const noTables = !!run && !active && run.items.length === 0 && (run.scanComplete || !!run.error?.startsWith("No tables or collections were found"));
  const scanBlockedReason = includedCount > 0 || run?.items.some((item) => item.status === "data") ? null : emptyItems.length > 0
    ? "None of the tables or collections we could read contain data. To continue, select an empty table or collection below to create a guide from its structure, or add data to your database and scan again."
    : "We couldn’t read any of your tables or collections. You can’t continue yet. Open the details below, fix the reported problems, then scan again.";
  const canStart = !!run?.scanComplete && includedCount > 0 && !!destination && !destinationError && !busy;
  const blockedReason = busy ? "Please wait for the current step to finish."
    : !run?.scanComplete ? "Complete the database scan before starting."
    : run.items.length === 0 ? "The scan found no tables or collections in this database. Check that your connection points to the database containing your data, then scan again. SQL views and system tables are not included."
    : includedCount === 0 ? (emptyItems.length > 0
      ? "Only empty or unreadable items were found. Go back to include an empty item, or scan again after adding data."
      : "No readable tables or collections were found. Check the scan errors and database permissions, then scan again.")
    : loadingDestinations ? "Loading your save locations…"
    : destinationError ? "We couldn’t load your save locations. Try again below."
    : !destination ? "Choose a save location before starting." : null;

  return <div className="page-enter mx-auto w-full max-w-5xl px-5 pt-8 pb-40 sm:px-10 sm:pt-12">
    <Link to="/workspaces/$workspaceId" params={{ workspaceId }} className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><HugeiconsIcon icon={ArrowLeft01Icon} size={14} />{workspace?.name ?? "Workspace"}</Link>
    <div className="mb-8 flex items-center gap-4"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border bg-primary/5 text-primary"><HugeiconsIcon icon={Database02Icon} size={24} strokeWidth={1.5} /></span><div><p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">Database setup</p><h1 className="mt-1 text-2xl font-medium tracking-tight">Set up your database</h1></div></div>
    <ol aria-label="Setup steps" className="mb-8 flex items-start">{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className="relative flex-1 text-center">
      {index < steps.length - 1 && <span aria-hidden="true" className={`absolute top-4 left-1/2 h-px w-full ${index < step ? "bg-primary/60" : "bg-border"}`} />}
      <span className={`relative mx-auto flex size-8 items-center justify-center rounded-full text-xs font-medium ring-4 ring-background transition-colors ${index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index < step || completed ? "✓" : index + 1}</span><span className={`mt-2.5 block text-[11px] ${index === step ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
    </li>)}</ol>
    {isPending ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Opening setup…</p> : error ? <div role="alert" className="rounded-2xl border p-6"><p className="text-sm">{errorMessage(error, "Could not load setup.")}</p><Button className="mt-4" onClick={() => void refetch()}>Try again</Button></div> : <section className="overflow-hidden rounded-3xl border bg-card shadow-[0_12px_48px_-32px_var(--ring)]">
      <div className="p-6 sm:p-8">
        {step === 0 && <>
          <p className="text-xs text-muted-foreground">Step 1 of 4</p><h2 className="mt-2 text-2xl font-medium tracking-tight">{noTables ? "No tables found" : run?.error ? "We couldn’t finish the scan" : "Let’s see what’s in your database."}</h2><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{noTables ? "There’s nothing to prepare in this database, so you can’t continue yet. Check that you connected to the database containing your tables. If you haven’t added any tables yet, add them and scan again." : "We’ll check which tables or collections contain data and which are empty. Nothing in your database will be changed."}</p>
          {active ? <div className="mt-6"><IngestionProgress run={run!} /></div> : !run?.error && !noTables && <div className="mt-7 rounded-2xl bg-muted/40 p-5 text-xs leading-6 text-muted-foreground">After the scan, we’ll show what we found and whether you can continue.</div>}
          {!active && !noTables && run?.error && <p role="alert" className="mt-4 text-xs text-destructive">{run.error}</p>}
        </>}
        {step === 1 && run && <>
          <p className="text-xs text-muted-foreground">Step 2 of 4 · Scan complete</p><h2 className="mt-2 text-2xl font-medium tracking-tight">{run.items.some((item) => item.status === "data" || item.status === "empty") ? "Choose what to include" : "We couldn’t read your tables"}</h2>
          {scanBlockedReason && <p role="status" className="mt-4 rounded-xl bg-muted p-4 text-sm leading-6">{scanBlockedReason}</p>}
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Choose the tables or collections you want in your database guide. You can select them individually or use Select all and Clear all.</p>
          <TableSelection items={run.items} disabled={busy} onChange={selectItems} />
          {run.failed > 0 && <div role="alert" className="mt-4 rounded-xl bg-destructive/5 p-4 text-xs leading-6 text-destructive">We couldn’t read {run.failed} tables or collections. They will be left out of the guide. <details className="mt-1"><summary className="cursor-pointer">See what needs attention</summary><VirtualList items={run.items.filter((item) => item.status === "error")} label="Scan errors" rowHeight={96} renderItem={(item) => <p key={`${item.schema}.${item.name}`} className="h-full overflow-y-auto py-2">{item.name}: {item.error}</p>} /></details></div>}
        </>}
        {step === 2 && run && <>
          <p className="text-xs text-muted-foreground">Step 3 of 4</p>{!run.items.some((item) => item.isEmpty) && includedCount > 0 && <p className="mt-3 rounded-xl bg-primary/5 px-4 py-3 text-xs text-primary">{includedCount} tables or collections selected for your guide.</p>}<h2 className="mt-2 text-2xl font-medium tracking-tight">Where should we save the guide?</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Choose a folder on this device or your cloud storage. Your selection appears below.</p>
          <div className="mt-6"><StoragePicker workspaceId={workspaceId} selectedId={destinationId} disabled={busy} /></div>
          {!destination && <p className="mt-4 text-xs text-muted-foreground">Choose a folder or add cloud storage to continue.</p>}
        </>}
        {step === 3 && run && <>
          <p className="text-xs text-muted-foreground">Step 4 of 4</p><h2 className="mt-2 text-2xl font-medium tracking-tight">{completed ? "Your database is ready." : active ? "We’re preparing your database." : run.status === "ready" ? "Ready when you are." : "Your ingestion results"}</h2>
          {run.status === "ready" ? <><p className="mt-3 text-sm leading-6 text-muted-foreground">We’ll send each selected table’s headers and relationships to AI, one table at a time. All descriptions will be saved together in one database guide. Row values and passwords are not sent.</p><dl className="mt-6 divide-y rounded-2xl border px-5 text-xs"><div className="flex justify-between py-4"><dt className="text-muted-foreground">Items to prepare</dt><dd className="font-medium">{includedCount}</dd></div><div className="flex justify-between py-4"><dt className="text-muted-foreground">Tables left out</dt><dd>{run.skipped}</dd></div><div className="py-4"><dt className="text-muted-foreground">Save to</dt><dd className="mt-2 break-all font-medium">{destination?.description ?? "No location selected"}</dd></div></dl></> : active ? <div className="mt-6"><IngestionProgress run={run} /></div> : <IngestionResults run={run} onRetry={() => start()} onScan={() => scan()} canRetry={canStart} busy={busy} />}
          {active && <p className="mt-5 text-xs leading-6 text-muted-foreground">Keep Sapienta running until saving finishes. You can minimize it and check progress from the {navigator.platform.includes("Mac") ? "menu bar" : "system tray"}.</p>}
          {!active && !completed && blockedReason && <p role="status" className="mt-4 rounded-xl bg-muted p-3 text-xs leading-5">{blockedReason}</p>}
          {!active && !completed && run.items.some((item) => item.status === "error") && <details className="mt-4 rounded-xl border p-4 text-xs leading-6"><summary className="cursor-pointer font-medium">See scan errors</summary><VirtualList items={run.items.filter((item) => item.status === "error")} label="Scan errors" rowHeight={96} renderItem={(item) => <p key={`${item.schema}.${item.name}`} className="h-full overflow-y-auto py-2 text-destructive">{item.schema ? `${item.schema}.` : ""}{item.name}: {item.error}</p>} /></details>}
          {!active && !completed && run.status !== "ready" && <Button variant="outline" className="mt-3" onClick={() => setStep(run.id, 2)}>Change save location</Button>}
          {destinationError != null && <Button className="mt-3" variant="outline" onClick={() => void reloadDestinations()}>Reload save locations</Button>}
          {run.status === "partial" && <p className="mt-3 text-xs leading-6 text-muted-foreground">Some items need attention. Retry to finish AI work, or scan again to fix items that couldn’t be checked.</p>}
        </>}
        {operationError != null && <p role="alert" className="mt-5 rounded-xl bg-destructive/5 p-4 text-xs leading-6 text-destructive">{errorMessage(operationError, "Something went wrong. Please try again.")}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-6 py-5 sm:px-8">
        <div>{step > 0 && run?.status === "ready" && <Button variant="ghost" disabled={busy} onClick={() => step === 1 ? scan() : setStep(run!.id, step - 1)}>{step === 1 ? "Scan again" : "Back"}</Button>}{step === 3 && !active && run?.status !== "ready" && <Button variant="ghost" onClick={() => scan()}>Scan again</Button>}</div>
        {step === 0 && <Button disabled={busy} onClick={() => scan()} className="gap-2 px-6">{busy ? "Scanning…" : run ? "Scan again" : "Scan database"}<HugeiconsIcon icon={ArrowRight02Icon} size={16} /></Button>}
        {step === 1 && <Button disabled={busy || includedCount === 0} onClick={() => setStep(run!.id, 2)} className="gap-2 px-6">Choose save location<HugeiconsIcon icon={ArrowRight02Icon} size={16} /></Button>}
        {step === 2 && <Button disabled={busy || includedCount === 0 || !destination || !!destinationError} onClick={() => setStep(run!.id, 3)} className="gap-2 px-6">Review and continue<HugeiconsIcon icon={ArrowRight02Icon} size={16} /></Button>}
        {step === 3 && (active || run?.status === "ready") && <Button disabled={!canStart} onClick={() => start()} className="px-6">{starting ? "Confirm in the dialog…" : active ? "Ingestion in progress…" : run?.status === "ready" ? "Start ingestion" : "Retry ingestion"}</Button>}
      </div>
    </section>}
  </div>;
}
