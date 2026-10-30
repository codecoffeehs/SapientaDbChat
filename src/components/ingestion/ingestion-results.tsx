import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isSelectedForIngestion, type IngestionRun } from "@/lib/ingestion";

function outcome(item: IngestionRun["items"][number]) {
  if (item.status === "done") return { label: "Succeeded", help: "Its structure and AI description are saved and searchable on this device." };
  if (item.status === "error") return { label: "Scan failed", help: "We could not read this table. Fix the problem below, then scan again." };
  if (item.status === "failed") return { label: "Failed", help: "Its structure was read, but its description could not be completed. Retry ingestion to try this table again." };
  return { label: "Not finished", help: "This table has no completed description yet. Retry ingestion to continue." };
}

export function IngestionResults({ run, onRetry, onScan, canRetry, busy }: { run: IngestionRun; onRetry: () => void; onScan: () => void; canRetry: boolean; busy: boolean }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All selected tables");
  const [page, setPage] = useState(0);
  const selected = run.items.filter(isSelectedForIngestion);
  const ready = selected.filter((item) => item.status === "done").length;
  const failed = selected.filter((item) => item.status === "failed").length;
  const unfinished = run.items.some((item) => !item.excluded && (["data", "failed", "processing"].includes(item.status) || (item.status === "empty" && item.includeEmpty)));
  const needsExport = ready > 0 && !run.location;
  const matching = selected.filter((item) => (filter === "All selected tables" || outcome(item).label === filter) && `${item.schema}.${item.name}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(matching.length / 25));
  const currentPage = Math.min(page, pages - 1);
  return <section className="mt-6 space-y-5" aria-label="Ingestion results">
    <div className="rounded-xl border bg-muted/20 p-5">
      <h3 className="text-lg font-medium">{ready ? `${ready} ${ready === 1 ? "table is" : "tables are"} ready for chat` : "No tables are ready for chat yet"}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{ready ? "You can start chatting with the ready tables now. Only successfully ingested tables will be used. AI descriptions are interpretations; their review notes do not block chat." : "Review the results below to see what stopped ingestion and how to fix it."}</p>
      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">{[["Selected", selected.length], ["Succeeded", ready], ["Failed", failed], ...(selected.length > ready + failed ? [["Not finished", selected.length - ready - failed]] : [])].map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-medium">{count}</dd></div>)}</dl>
      {run.error && <div role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6"><p className="font-medium">What stopped this run</p><p className="mt-1 whitespace-pre-wrap">{run.error}</p></div>}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{run.location ? `Guide exported to: ${run.location}` : ready ? "The ready tables are saved locally. The guide has not been exported to your chosen location. Retry ingestion to finish saving it." : "No completed guide has been saved."}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {ready > 0 && <Link to="/workspaces/$workspaceId" params={{ workspaceId: run.workspaceId }} className={buttonVariants()}>Start chatting</Link>}
        {run.status !== "completed" && (unfinished || needsExport) && <Button variant="outline" disabled={!canRetry || busy} onClick={onRetry}>{unfinished ? "Retry unfinished tables" : "Retry saving the guide"}</Button>}
        <Button variant="outline" disabled={busy} onClick={onScan}>Scan and ingest again</Button>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Retry keeps completed descriptions. Scan again to fix scan errors, change the selected tables or rebuild their descriptions.</p>
    </div>
    <div className="flex flex-wrap gap-3"><Input aria-label="Find a table" placeholder="Find a table…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="max-w-sm" /><select aria-label="Filter table results" className="rounded-lg border bg-background px-3 text-sm" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}>{["All selected tables", "Succeeded", "Failed", "Not finished"].map((label) => <option key={label}>{label}</option>)}</select></div>
    <div className="divide-y rounded-xl border">{matching.slice(currentPage * 25, currentPage * 25 + 25).map((item) => { const state = outcome(item); return <details key={`${item.schema}.${item.name}`} className="p-4" open={item.status === "failed"}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-sm"><span className="break-all font-medium">{item.schema ? `${item.schema}.` : ""}{item.name}</span><span className={`rounded-full px-2.5 py-1 text-xs ${item.status === "done" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : item.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{state.label}</span></summary>
      <div className="mt-3 space-y-3 text-sm leading-6"><p>{state.help}</p><p className="text-xs text-muted-foreground">{item.fieldCount} fields · {item.isEmpty ? "Empty when scanned" : item.status === "error" || item.status === "pending" ? "Presence could not be confirmed" : "Contained data when scanned"}</p>{item.error && <div role="note" className="rounded-lg bg-destructive/5 p-3 text-destructive"><p className="font-medium">Why this table failed</p><p className="mt-1 whitespace-pre-wrap">{item.error}</p></div>}{item.summary && <p>{item.summary}</p>}{item.confidence && <p className="text-xs text-muted-foreground">AI confidence: {item.confidence}. This is an estimate, not a verified business definition.</p>}{!!item.uncertainties?.length && <div><p className="font-medium">Meaning to confirm</p><ul className="mt-1 list-disc pl-5">{item.uncertainties.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}{!!item.notes?.length && <details><summary className="cursor-pointer text-xs text-muted-foreground">How this table was scanned</summary>{item.notes.map((note, index) => <p className="mt-2 text-xs" key={index}>{note}</p>)}</details>}</div>
    </details>; })}{!matching.length && <p className="p-5 text-sm text-muted-foreground">No tables match this filter.</p>}</div>
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{matching.length} tables · Page {currentPage + 1} of {pages}</span><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="ghost" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div>
  </section>;
}
