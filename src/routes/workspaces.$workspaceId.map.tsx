import { useMemo, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { ReactFlow, Background, Controls, MiniMap, MarkerType, type Node, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, buttonVariants } from "@/components/ui/button";
import { TableNode, type TableNodeData } from "@/components/database-map/table-node";
import { MapInspector } from "@/components/database-map/map-inspector";
import { appDataOptions, errorMessage, systemTheme } from "@/lib/queries";
import { layoutTables, mapLinks, mappingFor, tableId, tableName, type DatabaseMap, type MapTable } from "@/lib/database-map";
import { useDatabaseMap, defaultMapSession } from "@/stores/database-map";

export const Route = createFileRoute("/workspaces/$workspaceId/map")({ component: DatabaseMapPage });
const nodeTypes = { table: TableNode };

function DatabaseMapPage() {
  const { workspaceId } = Route.useParams();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["database-map", workspaceId], queryFn: () => invoke<DatabaseMap>("get_database_map", { workspaceId }), staleTime: 0,
  });
  if (isPending) return <p role="status" className="m-auto p-8 text-sm text-muted-foreground">Opening your database map…</p>;
  if (error || !data) return <div className="m-auto max-w-md p-8 text-center"><h1 className="text-xl font-medium">Your map isn’t ready yet.</h1><p role="alert" className="mt-3 text-sm leading-6 text-muted-foreground">{errorMessage(error, "Finish ingestion to explore your database map.")}</p><div className="mt-5 flex justify-center gap-3"><Button variant="outline" onClick={() => void refetch()}>Try again</Button><Link to="/workspaces/$workspaceId/ingestion" params={{ workspaceId }} className={buttonVariants()}>View ingestion</Link></div></div>;
  return <MapCanvas key={data.runId} catalog={data} workspaceId={workspaceId} />;
}

function MapCanvas({ catalog, workspaceId }: { catalog: DatabaseMap; workspaceId: string }) {
  const { data: appData } = useQuery(appDataOptions);
  const session = useDatabaseMap((state) => state.sessions[catalog.runId] ?? defaultMapSession);
  const update = useDatabaseMap((state) => state.update);
  const flow = useRef<ReactFlowInstance<Node<TableNodeData>> | null>(null);
  const originalLinks = useMemo(() => mapLinks(catalog.entities), [catalog]);
  const links = session.links ?? originalLinks;
  const tables = useMemo(() => {
    const all = new Map(catalog.entities.map((table) => [tableId(table), table]));
    catalog.entities.forEach((table) => table.relationships.forEach((relation) => {
      const reference = { schema: relation.targetSchema, name: relation.targetTable };
      if (!all.has(tableId(reference))) all.set(tableId(reference), { ...reference, external: true, fields: [], relationships: [], analysis: null });
      const target = all.get(tableId(reference))!;
      if (target.external) relation.targetColumns.forEach((name) => { if (!target.fields.some((field) => field.name === name)) target.fields.push({ name, dataType: "Not inspected", nullable: null, primaryKey: false }); });
    }));
    return [...all.values()];
  }, [catalog]);
  const positions = useMemo(() => layoutTables(tables, links), [tables, links]);
  const nodes: Node<TableNodeData>[] = tables.map((table) => ({
    id: tableId(table), type: "table", position: session.positions[tableId(table)] ?? positions[tableId(table)],
    selected: session.selected?.kind === "table" && session.selected.id === tableId(table),
    data: { external: !!table.external, name: table.name, schema: table.external ? "Referenced · not ingested" : table.schema, description: session.descriptions[tableId(table)] ?? (table.external ? "This table is referenced by your database but wasn’t included in ingestion. Its meaning has not been analyzed." : mappingFor(table).summary), fieldCount: table.fields.length, manual: !!table.analysis?.userEdited || session.descriptions[tableId(table)] !== undefined, confidence: table.external ? "not analyzed" : mappingFor(table).confidence ?? "unknown" },
  }));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const edges = links.map((link) => ({
    id: link.id, source: link.source, target: link.target, type: "smoothstep",
    selected: session.selected?.kind === "link" && session.selected.id === link.id,
    animated: !reducedMotion && session.selected?.id === link.id,
    label: link.manual ? "Your connection" : link.cardinality === "unknown" ? "Related" : link.cardinality.split("_").join(" "),
    markerEnd: { type: MarkerType.ArrowClosed, color: link.manual ? "#d97706" : "var(--primary)" },
    style: { stroke: link.manual ? "#d97706" : "var(--primary)", strokeWidth: 1.5, strokeDasharray: link.manual ? "5 4" : undefined },
    labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 }, labelBgStyle: { fill: "var(--background)" },
  }));
  function selectTable(table: MapTable) {
    update(catalog.runId, { selected: { kind: "table", id: tableId(table) }, draft: session.descriptions[tableId(table)] ?? mappingFor(table).summary, linkDraft: null });
  }
  function addConnection(source = tableId(tables[0]), target = tableId(tables[1] ?? tables[0])) {
    const id = crypto.randomUUID();
    update(catalog.runId, { selected: { kind: "link", id }, linkDraft: { id, source, target, sourceColumns: [], targetColumns: [], description: "", cardinality: "unknown", cautions: [], manual: true } });
  }
  return <div className="page-enter flex min-h-[660px] flex-1 flex-col">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5"><div><Link to="/workspaces/$workspaceId" params={{ workspaceId }} className="text-[11px] text-muted-foreground">← Back to workspace</Link><h1 className="mt-1 text-xl font-medium tracking-tight">Your database, connected.</h1><p className="mt-1 text-xs text-muted-foreground">{catalog.database} · {catalog.entities.length} tables · {links.length} connections</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { update(catalog.runId, { positions: {} }); requestAnimationFrame(() => void flow.current?.fitView({ duration: reducedMotion ? 0 : 450, padding: 0.2 })); }}>Arrange map</Button><Button size="sm" disabled={!tables.length} onClick={() => addConnection()}>Add connection</Button></div></header>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-6 py-3 text-[11px] text-muted-foreground"><span>Click a table to explore. Drag boxes to arrange. Click a line to edit its meaning.</span><span className={(session.edited || catalog.entities.some((table) => table.analysis?.userEdited)) ? "text-amber-600 dark:text-amber-400" : ""}>{(session.edited || catalog.entities.some((table) => table.analysis?.userEdited)) ? "User edited · saved for retrieval · rescan to rebuild" : "AI meanings are suggestions · database links are declared facts"}</span></div>
    <div className="relative min-h-[480px] flex-1">
      <ReactFlow<Node<TableNodeData>> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={(instance) => { flow.current = instance; }}
        onNodesChange={(changes) => { const moved = changes.filter((change) => change.type === "position" && change.position); if (moved.length) update(catalog.runId, { positions: { ...session.positions, ...Object.fromEntries(moved.flatMap((change) => change.type === "position" && change.position ? [[change.id, change.position]] : [])) } }); }}
        onNodeClick={(_, node) => { const table = tables.find((table) => tableId(table) === node.id); if (table) selectTable(table); }}
        onEdgeClick={(_, edge) => { const link = links.find((link) => link.id === edge.id); if (link) update(catalog.runId, { selected: { kind: "link", id: link.id }, linkDraft: { ...link } }); }}
        onConnect={(connection) => addConnection(connection.source, connection.target)}
        fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.12} maxZoom={1.6} deleteKeyCode={null} onlyRenderVisibleElements
        colorMode={(appData?.theme ?? systemTheme) === "dark" ? "dark" : "light"} className="database-map-canvas" aria-label="Interactive database relationship map">
        <Background gap={24} size={1} color="var(--border)" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor="var(--primary)" maskColor="var(--muted)" className="!rounded-xl !border !bg-background" position="bottom-left" />
      </ReactFlow>
      <div className="absolute top-3 left-3 z-10 max-w-[60%] rounded-xl border bg-background/90 p-2 shadow-sm backdrop-blur"><label htmlFor="map-table" className="sr-only">Find a table</label><select id="map-table" value={session.selected?.kind === "table" ? session.selected.id : ""} onChange={(event) => { const table = tables.find((table) => tableId(table) === event.target.value); if (table) { selectTable(table); void flow.current?.fitView({ nodes: [{ id: tableId(table) }], duration: reducedMotion ? 0 : 500, maxZoom: 1 }); } }} className="max-w-full bg-transparent px-2 py-1 text-xs"><option value="">Find a table…</option>{tables.map((table) => <option key={tableId(table)} value={tableId(table)}>{tableName(table)}</option>)}</select></div>
      <MapInspector runId={catalog.runId} tables={tables} links={links} />
      {!links.length && !session.selected && <p className="absolute right-4 bottom-4 max-w-xs rounded-xl border bg-background/90 p-4 text-xs leading-6 text-muted-foreground">No declared relationships were found. Explore each table or add a connection based on your knowledge.</p>}
    </div>
  </div>;
}
