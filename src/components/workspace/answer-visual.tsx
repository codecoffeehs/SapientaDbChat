import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface ResultColumn { key: string; label: string; identifier?: boolean }
export function showValue(value: unknown): string {
  if (value == null) return "Not available";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
const labelFor = (label: string) => label.replace(/_/g, " ");

export function AnswerVisual({ rows, columns, lookup, onChoose }: {
  rows: Record<string, unknown>[]; columns: ResultColumn[]; lookup: boolean; onChoose: (text: string) => void;
}) {
  const [visible, setVisible] = useState(12);
  if (!rows.length) return null;
  const displayColumns = columns.filter((column) => !column.identifier);
  if (!lookup && displayColumns.length) columns = displayColumns;
  const measure = columns.find((column) => !/\b(id|identifier|code)\b/i.test(labelFor(column.label)) && rows.every((row) => typeof row[column.key] === "number" && Number.isFinite(row[column.key])));
  const category = columns.find((column) => column !== measure && rows.every((row) => typeof row[column.key] === "string"));
  if (!lookup && rows.length === 1) return <dl className="mt-5 grid gap-3 sm:grid-cols-2">{columns.map((column) => <div key={column.key} className="rounded-xl bg-muted/40 p-5"><dt className="text-xs capitalize text-muted-foreground">{labelFor(column.label)}</dt><dd className="mt-2 break-words text-2xl font-medium tabular-nums">{showValue(rows[0][column.key])}</dd></div>)}</dl>;
  if (!lookup && columns.length === 2 && measure && category) {
    const shown = rows.slice(0, visible);
    const largest = Math.max(...rows.map((row) => Math.abs(row[measure.key] as number)), 1);
    const hasNegative = rows.some((row) => (row[measure.key] as number) < 0);
    return <figure className="mt-5 rounded-xl border p-5"><figcaption className="mb-5 text-sm font-medium capitalize">{labelFor(measure.label)} by {labelFor(category.label)}</figcaption><div className="space-y-4">{shown.map((row, index) => { const value = row[measure.key] as number; const width = Math.abs(value) / largest * 100; return <div key={index}><div className="mb-1.5 flex justify-between gap-4 text-xs"><span className="break-words">{showValue(row[category.key])}</span><span className="shrink-0 font-medium tabular-nums">{showValue(value)}</span></div>{hasNegative ? <div aria-hidden="true" className="flex h-2"><div className="flex w-1/2 justify-end border-r border-foreground/30"><div className="h-2 rounded-l bg-amber-600" style={{ width: value < 0 ? `${width}%` : 0 }} /></div><div className="w-1/2"><div className="h-2 rounded-r bg-primary" style={{ width: value >= 0 ? `${width}%` : 0 }} /></div></div> : <div aria-hidden="true" className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${width}%` }} /></div>}</div>; })}</div>{rows.length > visible && <Button variant="ghost" size="sm" className="mt-4" onClick={() => setVisible(visible + 20)}>Show more results</Button>}<details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer">All returned values</summary><ResultCards rows={shown} columns={columns} /></details></figure>;
  }
  return <div className="mt-5"><ResultCards rows={rows.slice(0, visible)} columns={columns} onChoose={lookup ? onChoose : undefined} />{rows.length > visible && <Button variant="ghost" className="mt-3" onClick={() => setVisible(visible + 20)}>Show more results</Button>}</div>;
}
function ResultCards({ rows, columns, onChoose }: { rows: Record<string, unknown>[]; columns: ResultColumn[]; onChoose?: (text: string) => void }) {
  return <div className="mt-3 space-y-3">{rows.map((row, index) => <div key={index} className="rounded-xl bg-muted/30 p-4"><dl className="grid gap-3 sm:grid-cols-2">{columns.map((column) => <div key={column.key}><dt className="text-xs capitalize text-muted-foreground">{labelFor(column.label)}</dt><dd className="mt-1 break-words text-sm font-medium">{showValue(row[column.key])}</dd></div>)}</dl>{onChoose && <Button variant="outline" size="sm" className="mt-3" onClick={() => onChoose(`Use this record: ${columns.map((column) => `${column.label}: ${showValue(row[column.key])}`).join(", ")}. Continue with my previous question.`)}>Use this record</Button>}</div>)}</div>;
}
