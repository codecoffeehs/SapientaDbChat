import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/queries";
import { mappingFor, tableId, tableName, type MapTable, type MapLink } from "@/lib/database-map";
import { useDatabaseMap, defaultMapSession } from "@/stores/database-map";

type Override = { kind: "table"; id: string; description: string } | { kind: "link"; link: MapLink } | { kind: "remove"; id: string };
export function MapInspector({ runId, tables, links }: { runId: string; tables: MapTable[]; links: MapLink[] }) {
  const queryClient = useQueryClient();
  const session = useDatabaseMap((state) => state.sessions[runId] ?? defaultMapSession);
  const update = useDatabaseMap((state) => state.update);
  const { selected, draft, linkDraft } = session;
  const table = selected?.kind === "table" ? tables.find((table) => tableId(table) === selected.id) : undefined;
  const mapping = table ? mappingFor(table) : undefined;
  const existing = selected?.kind === "link" ? links.find((link) => link.id === selected.id) : undefined;
  const { mutate: override, isPending, error } = useMutation({
    mutationFn: async (action: Override) => {
      const nextLinks = action.kind === "link" ? [...links.filter((link) => link.id !== action.link.id), { ...action.link, manual: true }] : action.kind === "remove" ? links.filter((link) => link.id !== action.id) : [];
      const previous = action.kind === "table" ? undefined : links.find((link) => link.id === (action.kind === "link" ? action.link.id : action.id));
      const affected = [...(previous ? [previous.source, previous.target] : []), ...(action.kind === "link" ? [action.link.source, action.link.target] : [])];
      const edit = action.kind === "table" ? { table: JSON.parse(decodeURIComponent(action.id)), description: action.description } : { affectedTables: affected.map((id) => JSON.parse(decodeURIComponent(id))), links: nextLinks.map((link) => ({ ...link, sourceTable: JSON.parse(decodeURIComponent(link.source)), targetTable: JSON.parse(decodeURIComponent(link.target)) })) };
      return await invoke<boolean>("save_map_edit", { runId, edit }) ? action : null;
    },
    onSuccess: (action) => {
      if (!action) return;
      void queryClient.invalidateQueries({ queryKey: ["database-map"] });
      void queryClient.invalidateQueries({ queryKey: ["database-chat"] });
      const current = useDatabaseMap.getState().sessions[runId] ?? defaultMapSession;
      if (action.kind === "table") update(runId, { descriptions: { ...current.descriptions, [action.id]: action.description }, edited: true });
      else if (action.kind === "link") {
        const next = { ...action.link, manual: true };
        update(runId, { links: [...(current.links ?? links).filter((link) => link.id !== next.id), next], linkDraft: next, edited: true });
      } else update(runId, { links: (current.links ?? links).filter((link) => link.id !== action.id), selected: null, linkDraft: null, edited: true });
    },
  });
  if (!selected) return null;
  const source = tables.find((table) => tableId(table) === linkDraft?.source);
  const target = tables.find((table) => tableId(table) === linkDraft?.target);
  const validLink = !!linkDraft && !!source && !!target && linkDraft.description.trim().length > 0
    && linkDraft.sourceColumns.length > 0 && linkDraft.sourceColumns.length === linkDraft.targetColumns.length
    && linkDraft.sourceColumns.every((name) => source.fields.some((field) => field.name === name))
    && linkDraft.targetColumns.every((name) => target.fields.some((field) => field.name === name));
  const changed = table ? draft.trim() !== (session.descriptions[tableId(table)] ?? mapping?.summary) : JSON.stringify(linkDraft) !== JSON.stringify(existing);
  return <aside className="absolute top-3 right-3 bottom-3 z-10 flex w-88 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border bg-background/95 shadow-xl backdrop-blur-xl" aria-label="Map details">
    <div className="flex items-start justify-between gap-3 border-b p-5"><div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{table ? "Table details" : existing?.manual ? "Your connection" : existing ? "Database connection" : "New connection"}</p><h2 className="mt-1 truncate text-sm font-semibold" title={table ? tableName(table) : "Connection"}>{table?.name ?? "How these tables connect"}</h2></div><Button size="xs" variant="ghost" disabled={isPending} onClick={() => update(runId, { selected: null, linkDraft: null })}>Close</Button></div>
    <fieldset disabled={isPending} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      {table && mapping && <>
        <div><Label htmlFor="table-meaning">What this table means</Label><textarea id="table-meaning" disabled={table.external} value={draft} maxLength={6000} onChange={(event) => update(runId, { draft: event.target.value })} className="mt-2 min-h-32 w-full resize-y rounded-xl border bg-muted/20 p-3 text-xs leading-6 outline-none focus:ring-2 focus:ring-ring" /></div>
        <p className="text-[11px] leading-5 text-muted-foreground">{table.external ? "This referenced table was not included in ingestion. Its description is unavailable." : (table.analysis?.userEdited || session.descriptions[tableId(table)] !== undefined) ? "User edited · saved to the semantic catalog. This label remains until a new scan and ingestion." : `AI confidence: ${mapping.confidence ?? "unknown"}. Treat this meaning as a suggestion.`}</p>
        <div><h3 className="text-xs font-medium">One row represents</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">{mapping.grain}</p></div>
        {!!mapping.aliases?.length && <div className="flex flex-wrap gap-1.5">{mapping.aliases.map((alias, i) => <span key={i} className="rounded-full bg-muted px-2 py-1 text-[10px]">{alias}</span>)}</div>}
        <details open><summary className="cursor-pointer text-xs font-medium">Fields · {table.fields.length}</summary><div className="mt-3 space-y-3">{table.fields.map((field) => { const meaning = mapping.fields.find((item) => item.name === field.name); return <div key={field.name} className="rounded-xl border p-3"><p className="break-all text-xs font-medium">{field.name}{field.primaryKey && <span className="ml-2 text-[9px] text-primary">Key</span>}</p><p className="mt-1 text-[10px] text-muted-foreground">{field.dataType} · {field.nullable === null ? "Not checked" : field.nullable ? "May be empty" : "Required"}</p><p className="mt-2 text-xs leading-5">{meaning?.description ?? "No meaning was provided."}</p>{meaning?.cautions?.map((caution, i) => <p key={i} className="mt-2 text-[11px] leading-5 text-muted-foreground">{caution}</p>)}</div>; })}</div></details>
        {!!mapping.businessConcepts?.length && <details><summary className="cursor-pointer text-xs font-medium">Business concepts</summary>{mapping.businessConcepts.map((concept, i) => <div key={i} className="mt-3 text-xs leading-6"><p className="font-medium">{concept.name}</p><p className="text-muted-foreground">{concept.description}</p><p className="text-[10px]">{concept.fields.join(", ")}</p></div>)}</details>}
        {!!mapping.questionIdeas?.length && <details><summary className="cursor-pointer text-xs font-medium">Questions to explore</summary>{mapping.questionIdeas.map((question, i) => <p key={i} className="mt-3 text-xs leading-6 text-muted-foreground">{question}</p>)}</details>}
        {!!mapping.uncertainties?.length && <div className="rounded-xl bg-muted/50 p-3"><h3 className="text-xs font-medium">Needs your knowledge</h3>{mapping.uncertainties.map((uncertainty, i) => <p key={i} className="mt-2 text-xs leading-6 text-muted-foreground">{uncertainty}</p>)}</div>}
      </>}
      {linkDraft && <>
        {(["source", "target"] as const).map((side) => { const item = side === "source" ? source : target; const columns = side === "source" ? "sourceColumns" : "targetColumns"; return <div key={side}><Label htmlFor={`link-${side}`}>{side === "source" ? "From table" : "To table"}</Label><select id={`link-${side}`} value={linkDraft[side]} onChange={(event) => update(runId, { linkDraft: { ...linkDraft, [side]: event.target.value, [columns]: [] } })} className="mt-2 h-10 w-full rounded-lg border bg-background px-2 text-xs">{tables.map((table) => <option key={tableId(table)} value={tableId(table)}>{tableName(table)}</option>)}</select><Label htmlFor={`columns-${side}`} className="mt-3">Matching fields</Label><select id={`columns-${side}`} multiple value={linkDraft[columns]} onChange={(event) => update(runId, { linkDraft: { ...linkDraft, [columns]: Array.from(event.target.selectedOptions, (option) => option.value) } })} className="mt-2 min-h-20 w-full rounded-lg border bg-background p-2 text-xs">{item?.fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select></div>; })}
        <p className="text-[11px] leading-5 text-muted-foreground">Choose the same number of fields on each side. Field pairs follow the order shown. Use Ctrl or Command to select multiple fields.</p>
        {linkDraft.sourceColumns.map((field, index) => <p key={field} className="break-all rounded-lg bg-muted p-2 font-mono text-[10px]">{field} → {linkDraft.targetColumns[index] ?? "Choose a matching field"}</p>)}
        <div><Label htmlFor="link-description">What this connection means</Label><textarea id="link-description" maxLength={6000} value={linkDraft.description} onChange={(event) => update(runId, { linkDraft: { ...linkDraft, description: event.target.value } })} className="mt-2 min-h-28 w-full rounded-xl border bg-muted/20 p-3 text-xs leading-6" /></div>
        <div><Label htmlFor="link-cardinality">How records match</Label><select id="link-cardinality" value={linkDraft.cardinality} onChange={(event) => update(runId, { linkDraft: { ...linkDraft, cardinality: event.target.value } })} className="mt-2 h-10 w-full rounded-lg border bg-background px-2 text-xs"><option value="unknown">Not known</option><option value="one_to_one">One to one</option><option value="many_to_one">Many to one</option><option value="one_to_many">One to many</option><option value="many_to_many">Many to many</option></select></div>
        {linkDraft.cautions.map((caution, i) => <p key={i} className="text-xs leading-6 text-muted-foreground">{caution}</p>)}
        {existing && <Button variant="outline" size="sm" onClick={() => override({ kind: "remove", id: existing.id })}>Remove from this map</Button>}
      </>}
    </fieldset>
    <div className="space-y-3 border-t bg-muted/20 p-4"><p className="text-[10px] leading-5 text-muted-foreground">Edits are saved to SQLite and used for future questions. The User edited label remains until a new scan and ingestion. Existing exports stay unchanged.</p>{error != null && <p role="alert" className="text-xs text-destructive">{errorMessage(error, "Could not confirm the override.")}</p>}{changed && <Button className="w-full" disabled={isPending || (table ? !draft.trim() || !!table.external : !validLink)} onClick={() => table ? override({ kind: "table", id: tableId(table), description: draft.trim() }) : linkDraft && override({ kind: "link", link: linkDraft })}>{isPending ? "Confirm in the dialog…" : "Override with my changes"}</Button>}</div>
  </aside>;
}
