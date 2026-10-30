import { VirtualList } from "./virtual-list";
import type { IngestionRun } from "@/lib/ingestion";
import { Button } from "@/components/ui/button";

export function TableSelection({ items, disabled, onChange }: {
  items: IngestionRun["items"];
  disabled: boolean;
  onChange: (indices: number[]) => void;
}) {
  const readable = items.flatMap((item, index) => item.status === "data" || item.status === "empty" ? [{ ...item, index }] : []);
  const selected = readable.filter((item) => !item.excluded && (item.status === "data" || item.includeEmpty)).map((item) => item.index);
  const selectedSet = new Set(selected);
  const update = (indices: number[], include: boolean) => {
    const changed = new Set(indices);
    onChange(include ? [...new Set([...selected, ...indices])] : selected.filter((index) => !changed.has(index)));
  };
  return <div className="mt-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p aria-live="polite" className="text-sm font-medium">{selected.length} of {readable.length} selected</p><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={disabled || selected.length === readable.length} onClick={() => onChange(readable.map((item) => item.index))}>Select all</Button><Button variant="ghost" size="sm" disabled={disabled || !selected.length} onClick={() => onChange([])}>Clear all</Button></div></div>
    <div className="grid gap-4 md:grid-cols-2">{[{ status: "data", title: "With data", description: "Included by default. Uncheck any you don’t need." }, { status: "empty", title: "Empty", description: "Optional. Include these to describe their structure." }].map((group) => {
      const entries = readable.filter((item) => item.status === group.status);
      const indices = entries.map((item) => item.index);
      const count = indices.filter((index) => selectedSet.has(index)).length;
      return <section key={group.status} className="min-w-0 overflow-hidden rounded-xl border">
        <div className="border-b bg-muted/30 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">{group.title} <span className="ml-1 text-muted-foreground">{entries.length}</span></h3><Button variant="ghost" size="sm" disabled={disabled || !entries.length} onClick={() => update(indices, count !== entries.length)}>{count === entries.length && entries.length ? "Clear all" : "Select all"}</Button></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{group.description}</p></div>
        <div>{entries.length > 0 && <VirtualList items={entries} label={group.title} renderItem={(item) => <label key={item.index} className="flex h-full cursor-pointer items-start gap-3 border-b px-4 py-3 hover:bg-muted/30"><input type="checkbox" checked={selectedSet.has(item.index)} disabled={disabled} onChange={(event) => update([item.index], event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" /><span className="min-w-0"><span title={item.name} className="block truncate text-sm">{item.name}</span><span title={item.schema} className="mt-1 block truncate text-xs text-muted-foreground">{item.schema ? `${item.schema} · ` : ""}{item.fieldCount} fields</span></span></label>} />}{!entries.length && <p className="p-5 text-sm text-muted-foreground">{group.status === "data" ? "No tables with data found." : "No empty tables found."}</p>}</div>
      </section>;
    })}</div>
    {!selected.length && readable.length > 0 && <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">Select at least one table or collection to continue. Nothing will be changed in your database.</p>}
  </div>;
}
