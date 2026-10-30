import dagre from "@dagrejs/dagre";

export interface SemanticField { name: string; description: string; role?: string; confidence?: string; aliases?: string[]; cautions?: string[] }
export interface TableMapping {
  summary: string; grain: string; confidence?: string; aliases?: string[]; fields: SemanticField[];
  uncertainties?: string[]; questionIdeas?: string[];
  businessConcepts?: { name: string; description: string; fields: string[] }[];
  relationships?: { id: string; description: string; cardinality: string; cautions: string[] }[];
}
export interface MapTable {
  external?: boolean;
  schema: string; name: string;
  fields: { name: string; dataType: string; nullable: boolean | null; primaryKey: boolean }[];
  relationships: { columns: string[]; targetSchema: string; targetTable: string; targetColumns: string[] }[];
  analysis: { userEdited?: boolean; savedMapLinks?: MapLink[]; mapping?: TableMapping; parts?: TableMapping[]; declaredRelationships?: { id: string; direction: string; source: { schema: string; table: string; columns: string[] }; target: { schema: string; table: string; columns: string[] } }[] } | null;
}
export interface DatabaseMap { runId: string; database: string; provider: string; entities: MapTable[] }
export interface MapLink { id: string; source: string; target: string; sourceColumns: string[]; targetColumns: string[]; description: string; cardinality: string; cautions: string[]; manual?: boolean }
export const tableId = (table: { schema: string; name: string }) => encodeURIComponent(JSON.stringify([table.schema, table.name]));
export const tableName = (table: { schema: string; name: string }) => table.schema ? `${table.schema}.${table.name}` : table.name;
export function mappingFor(table: MapTable): TableMapping {
  return table.analysis?.mapping ?? { summary: table.analysis?.parts?.[0]?.summary ?? "No description was provided.", grain: table.analysis?.parts?.[0]?.grain ?? "Unknown", fields: table.analysis?.parts?.flatMap((part) => part.fields) ?? [] };
}
export function mapLinks(tables: MapTable[]): MapLink[] {
  return tables.flatMap((table) => table.analysis?.savedMapLinks ?? table.relationships.flatMap((relation, index) => {
    const source = tableId(table), target = tableId({ schema: relation.targetSchema, name: relation.targetTable });
    const declaration = table.analysis?.declaredRelationships?.find((entry) => entry.direction === "outgoing" && entry.target.schema === relation.targetSchema && entry.target.table === relation.targetTable && JSON.stringify(entry.source.columns) === JSON.stringify(relation.columns) && JSON.stringify(entry.target.columns) === JSON.stringify(relation.targetColumns));
    const meaning = table.analysis?.mapping?.relationships?.find((entry) => entry.id === declaration?.id);
    return [{ id: `${source}:${index}`, source, target, sourceColumns: relation.columns, targetColumns: relation.targetColumns,
      description: meaning?.description ?? "A relationship declared in your database.", cardinality: meaning?.cardinality ?? "unknown", cautions: meaning?.cautions ?? [] }];
  }));
}
export function layoutTables(tables: MapTable[], links: MapLink[]) {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: "LR", nodesep: 55, ranksep: 130, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  tables.forEach((table) => graph.setNode(tableId(table), { width: 280, height: 230 }));
  links.filter((link) => graph.hasNode(link.source) && graph.hasNode(link.target)).forEach((link) => graph.setEdge(link.source, link.target, {}, link.id));
  dagre.layout(graph);
  return Object.fromEntries(tables.map((table) => { const { x, y } = graph.node(tableId(table)); return [tableId(table), { x: x - 140, y: y - 115 }]; }));
}
