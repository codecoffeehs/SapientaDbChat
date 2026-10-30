# Catalog-backed chat

The desktop app now supports a bounded first version of database chat. It does not execute SQL text supplied by the model.

## Storage and retrieval

Each successful table description is checkpointed into the ingestion JSON and indexed in `catalog_entries` in the same SQLite transaction. `catalog_search` is an FTS5 index maintained by triggers. Entries are isolated by ingestion run and contain only completed, selected tables. Old runs are indexed once when opening chat. Subsequent questions load the small run header and only matching table records, not the full ingestion JSON. Search text contains meaningful values rather than JSON property names. Workspace deletion cascades to catalog entries and chat history.

The first AI completion expands the question into search terms. SQLite ranks matching descriptions, identifiers and aliases using FTS5/BM25. Two rounds of declared foreign-key traversal add connecting tables, capped at 16 candidates. A bounded shortlist of complete table schemas is sent to the planner; descriptions may be abbreviated, but fields are not partially cut from an included table. The planner is told to clarify missing context. This is lexical retrieval with AI term expansion, not vector search; no embeddings are generated and no embedding endpoint is assumed. There is no background schema-drift detection.

## Query flow

1. Read conversation context from SQLite, scoped to the latest ingestion run. Only bounded prior question/reply text is sent to the provider, never prior result rows during retrieval.
2. Expand search terms, retrieve catalog entries, then load exact metadata and declared relationships.
3. Ask the AI for a structured answer, clarification, identity lookup or query plan.
4. Validate every referenced table, column, relationship, calculation, filter, ordering and result limit in Rust.
5. Construct a read-only SELECT for PostgreSQL or SQL Server, or a restricted MongoDB aggregation pipeline. Never execute model-authored SQL or expressions.
6. Display actual result rows, the query and the source tables. Save the question and answer, including up to 1 MiB of results, locally in `chat_turns`.

The UI tells users that results are saved locally. AI credentials and database connection strings are never placed in prompts. After a successful query, up to 20 result rows within an 8 KB sample go to the AI for a 1–3 sentence explanation. The UI discloses this. A failed explanation does not discard the query result. Values and charts are rendered directly from the returned data; answers use metric cards, bar charts or record cards rather than raw tables.

Ambiguous terms such as “top” and unverified business definitions should produce clarification. Named entities should first produce a limited identity lookup; users choose the record before the analytical query. Those behaviors are prompt-directed and not a guarantee of correct interpretation.

## Supported operations and limits

SQL plans support a single base table, a connected tree of up to eight declared inner joins, up to 20 selected fields, scalar comparisons, null tests, grouping, sum/average/min/max/count/distinct-count, ordering and 1–200 rows. Identifiers are catalog-validated and quoted. Literal values are type-restricted and escaped. Aggregating joins must preserve the base row count using primary-key evidence; sums, averages and non-distinct counts must belong to the base table. Potentially multiplying joins are rejected rather than silently returning inflated totals.

MongoDB supports one collection, scalar comparisons, null tests, grouping, sum/average/min/max/count, ordering and limits. Collection joins, distinct-count, arbitrary expressions, date bucketing, OR filters, outer joins, SQL subqueries and custom formulas are not implemented. Unsupported plans produce a visible error or clarification, never a guessed substitute. Use a database account with read-only permissions as defense in depth. PostgreSQL connections additionally enforce read-only transactions and server-side timeouts; MongoDB applies a 15-second maximum and the overall database operation has a 30-second bound.

## Ingestion results and recovery

The results view includes every table, with search, status filters, pagination and expandable details: ready for chat, left out, scan failed, AI request failed or not finished. Details include the error, scan notes, AI description, confidence and uncertainties. Ready tables can be used even when other tables fail or the export fails. Retry preserves completed descriptions; scan again refreshes schema and selections. Scan failures require a new scan. Manual map edits remain session-only and are not yet used by retrieval.

The AI client calls `/v1/chat/completions` directly. `/models` discovery is removed. A model is omitted unless `SAPIENTA_AI_MODEL` is explicitly configured. A provider that requires a model must configure a server default or use that optional override. HTTP failures include status, bounded provider JSON error details and recovery advice; token values are redacted. Truncated or invalid answers fail visibly.

## Verification

Rust tests exercise SQLite catalog isolation and index cleanup, selection preservation, generated ranking queries against a disposable in-memory relational fixture, query rejection and literal escaping. Local HTTP fixtures exercise the actual reqwest completion client for direct requests without model discovery, missing answers, truncated output, provider rejection and rate limits. These fixtures are test assumptions, not a verified contract for the live AI provider. Frontend logic tests cover partial-run chat availability. No app development server, live AI requests or user-database queries were used. The compact-catalog and answer-presentation update was compilation-checked only; no tests were run for that update, as requested. Actual PostgreSQL, SQL Server and MongoDB execution and visual behavior still require integration verification.
