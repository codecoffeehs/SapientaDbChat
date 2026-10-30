import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Database02Icon } from "@hugeicons/core-free-icons";
export type TableNodeData = { external: boolean; name: string; schema: string; description: string; fieldCount: number; manual: boolean; confidence: string };
export function TableNode({ data, selected }: NodeProps<Node<TableNodeData>>) {
  return <div className={`h-[230px] w-[280px] overflow-hidden rounded-2xl border bg-card shadow-[0_8px_30px_-16px_var(--ring)] transition-[box-shadow,border-color] ${selected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40"}`}>
    <Handle type="target" position={Position.Left} className="!size-2.5 !border-background !bg-primary" />
    <div className={`h-1 ${data.manual ? "bg-amber-500/70" : "bg-primary/60"}`} />
    <div className="p-5"><div className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground"><HugeiconsIcon icon={Database02Icon} size={15} /><span className="flex-1 truncate">{data.schema || "Collection"}</span><span>{data.external ? "Not analyzed" : data.manual ? "Your description" : "AI description"}</span></div><h2 className="truncate text-sm font-semibold" title={data.name}>{data.name}</h2><p className="mt-3 line-clamp-4 text-xs leading-5 text-muted-foreground">{data.description}</p></div>
    <div className="absolute right-5 bottom-4 left-5 flex justify-between border-t pt-3 text-[10px] text-muted-foreground"><span>{data.fieldCount} {data.external ? "known key fields" : "fields"}</span><span>{data.manual ? "Manual override" : `Confidence: ${data.confidence}`}</span></div>
    <Handle type="source" position={Position.Right} className="!size-2.5 !border-background !bg-primary" />
  </div>;
}
