# Schema ingestion

The desktop app prompts for an AI API key if none is saved. Use **Settings** in the sidebar to replace the one app-wide key. Native confirmation precedes replacement; secure storage overwrites the existing entry. No per-workspace keys or key history are retained. Replacement is blocked while database operations run. Saving stores the key securely but does not validate it with the service. Rust reads it from the OS credential store and sends `Authorization: Bearer <key>` on completion requests. Redirects are disabled so the token cannot follow a redirect to another host. Missing or inaccessible secure storage blocks ingestion.

## AI contract

Endpoint: `https://jett-lateenrigged-jessie.ngrok-free.dev/v1/chat/completions`.

Set `SAPIENTA_AI_MODEL` in the desktop process environment if the service needs an explicit model. Otherwise, the model field is omitted and the endpoint must choose its default model. There is no model-discovery request. The service must support the OpenAI-compatible messages format, `response_format: {"type":"json_object"}`, and JSON text in `choices[0].message.content`. The request includes `stream: false`, `temperature: 0.1`, and `max_tokens: 8192`. Requests time out after 300 seconds, and response bodies are limited to 1 MiB. The ngrok skip-browser-warning header is included.

Each selected table or collection gets one sequential completion request containing its complete headers, types, nullability, primary-key flags, comments, and declared incoming/outgoing foreign keys. Related key metadata provides join context; no database row values are supplied. After scanning, all readable tables appear in two groups: with data and empty. Populated tables are selected by default; empty tables are optional. Users can select or clear individual tables, either group, or the entire list. At least one table must be selected before choosing storage.

The prompt asks for table purpose, row grain, multilingual aliases, per-field meanings/roles/cautions, declared relationship meanings and join risks, business concepts tied to exact local fields, question ideas, and unresolved definitions. Confidence is explicit and all semantic descriptions require review. Response validation checks typed fields and enums, every supplied field and relationship exactly once, concept references, and a completed response. Unknown relationships are not invented. Declared relationships remain separate from AI interpretations in the artifact.

The configured context is 32K. The full system prompt plus metadata is capped at 20,000 UTF-8 bytes as a conservative input guard, with 8,192 output tokens reserved and additional framing margin. This is not an exact model tokenizer count. Tables exceeding that guard fail explicitly rather than silently dropping headers or splitting a table into multiple calls. Truncated or malformed output fails that item. Service context configuration and completion compatibility remain unverified.

Only schema names, field names/types, nullability, primary-key markers, bounded column comments, and declared foreign keys enter AI requests. Credentials and automatically fetched row/document values never enter AI payloads. Chat questions may themselves include values supplied by the user. Schema comments can themselves contain sensitive information; the native start confirmation discloses that metadata is sent. Descriptions are hypotheses with `requiresReview: true`, not guaranteed business definitions. There is no inferred relationship discovery. Live chat uses the local catalog, AI-expanded keyword retrieval and a constrained query plan; see `docs/chat.md`.

## Scan and review

- PostgreSQL: ordinary tables and partition roots, column metadata/comments, composite primary/foreign keys. `EXISTS ... LIMIT 1` checks presence.
- SQL Server: user tables and catalog metadata, declared foreign keys. `EXISTS` checks presence.
- MongoDB: collection presence, then up to 32 locally sampled documents and 16 elements per array for field paths/types. Values are discarded. Rare fields and relationships cannot be guaranteed by sampling.
- Empty items skip AI processing by default. Review checkboxes control both populated and empty tables before ingestion; the selection is saved in SQLite. Deselected populated tables are excluded from AI processing and the exported entities. Empty SQL tables retain column and foreign-key metadata. Empty MongoDB collections without sampled fields are analyzed with their name only and explicit unknown schema/grain. Permission errors/timeouts are separate from empty states. A scan with no selected items does not unlock chat. Database changes after scanning are not continuously monitored.
- A single operation per workspace is allowed. Closing/quitting is blocked during operations. Crashes and forced termination can still interrupt runs; the next startup marks them interrupted.

## Storage and recovery

Native dialogs handle folder selection, key replacement confirmation, and ingestion start confirmation. Multi-field S3 and API-key forms use the app’s accessible dialog components because Tauri's dialog plugin has no native multi-field/password form.

Local export uses a temporary file followed by rename. S3 uses signed uploads with explicit credentials, a private-by-default bucket policy, and a 90-second timeout. Uploading does not modify ACLs. One combined file is saved per database workspace: local `sapienta-<workspace-id>.json` or S3 `sapienta/<workspace-id>/catalog.json`. A subsequent run updates that file in the chosen location. The file contains all processed entities and mappings, declared links, completeness status, and a skipped-item manifest. Older files from previous naming schemes are not deleted.

Required S3 fields: endpoint, access key ID, secret access key, bucket, public base URL, and a display name. OVH signing regions are inferred from `s3.<region>...cloud.ovh.net` / `.cloud.ovh.us`; other providers require a region. The public base URL is retained for future links and is not an access grant. Profiles can be reused or separately added per workspace. S3 credentials are stored in local SQLite as requested and are not included in destination list responses.

Every run is checkpointed in local SQLite even with S3 selected. Successful AI results are reused when retrying AI failures or a failed export; successful items are not re-requested. Scan errors require a new scan. Partial results may be exported. Chat and the database map are available once the latest run has at least one completed selected table and the background task has stopped. Export failures and semantic review notes do not block locally saved tables. Deleting a workspace removes its SQLite runs, not previously exported local files or S3 objects.

No tests, builds, or live ingestion/completion requests were run for this change. Model/token handling is implemented; service acceptance is still unverified.

The progress screen shows scanning/review/analysis/saving stages, current table and field count, remaining/success/skipped/error counts, and elapsed active time. A sidebar card tracks active jobs across navigation. Elapsed time is per active attempt; retries preserve completed items and reset the attempt timer. Force-quit, crashes, power loss, and OS termination cannot be prevented by normal close/quit guards.

## Guided setup and background status

Setup shows one step at a time: scan, review and select tables, choose a save location, then review and start. Populated items are selected by default and can be cleared. Native folder selection adds a reusable local path; the selected path is visible before starting. Missing or unavailable storage settings keep Start disabled with a reason. The guide can be saved locally or to S3.

A floating panel follows active tasks across app navigation. The Windows system-tray icon and macOS menu-bar icon expose native progress menus with the current task, percentage, remaining item count, and elapsed time. macOS also shows the percentage beside the icon. The native updater runs in Rust once per second, independently of React. If multiple tasks run, the menu shows one task and the total task count; the floating panel lists each task. Open Sapienta restores and focuses the main window. Minimize the window to work elsewhere; closing/quitting is still blocked during active operations. Native tray behavior has not been run or verified on either OS for this change.

## Interactive database map

After ingestion, **Start chatting** opens the chat workspace, which links to the database map. The chat workspace also has a **Database map** button. It reads completed selected tables from the latest run in local SQLite; it never fetches rows or resends schemas to AI. Each ingested table is a draggable card. Declared foreign keys become directed lines, with AI relationship descriptions and cautions available on click. Referenced tables excluded from ingestion appear as labeled placeholders, not invented AI analyses. An automatic graph layout, zoom controls, minimap, table picker, and reduced-motion support aid navigation.

Table details show the original field metadata and AI meanings, row grain, business concepts, example questions, aliases, and uncertainties. Users can edit table descriptions, add/edit/remove connections (including matching fields and cardinality), then explicitly apply **Override with my changes** through a native warning confirmation. Changes are marked as manual and remain only in a Zustand session keyed by ingestion run. Layout positions are also session-only. No database constraints, SQLite catalog, exported guide, or S3 object is changed. A new ingestion starts a fresh map; application restart discards overrides. Persistent map editing/export is deferred.

The graph has not been run or tested in this change, respecting the no-tests instruction.

The macOS menu bar uses a monochrome template database icon that follows the system appearance. Progress stays inside its native menu rather than adding percentage text beside the icon. When background work stops, the menu returns to idle; completed guides and items needing attention remain available in the app.

## Batched scanning and stopping

PostgreSQL and SQL Server read columns and foreign keys with two database-wide catalog queries, then check up to 128 tables per SQL round trip using a generated UNION ALL of exact EXISTS checks. A successful scan uses 3 + ceil(table count / 128) queries, including discovery, excluding connection setup. Identifiers are quoted for the driver. Catalog/statistics row counts are not used to classify emptiness because they can be approximate or stale. Failed batches are split to isolate inaccessible tables; connections are reopened after failures or timeouts. Errors are never classified as empty. Empty tables appear in the Empty section and are skipped by default, with their structure already available if selected. No per-table metadata queries or 5,000-object cutoff remain. With data, Empty, and error lists use fixed-height virtualization with overscan; selection membership uses sets. MongoDB checks and samples up to four collections concurrently with bounded task lifetimes. Checks reflect rows visible to the configured database user, at the time each batch runs.

Stop task is available on the progress screen and floating panel, with native confirmation. Cancelling a scan drops the scan work and requires a fresh scan; cancelling ingestion drops the local AI request, preserves completed tables, and permits a retry. Cancellation does not guarantee the remote AI server stops its computation. The final file/S3 write is deliberately allowed to finish to avoid an incomplete guide. Normal close/quit guards remain active until the worker has released its operation. Stopped runs are persisted as cancelled.

A zero-object scan is now reported as a discovery failure, including for saved ready-state runs from older builds, instead of misleadingly saying nothing was selected. The connected database and permissions must expose actual user tables to ingest; the gate is not bypassed to create an empty guide.

Bulk scan verification: `bun test tests/virtual-list.test.tsx` checks bounded rendering for 10,000 items. The ignored Rust test `bulk_scan_preserves_metadata_and_exact_presence` uses `SAPIENTA_TEST_POSTGRES_URI` against a disposable PostgreSQL database, creates 1,004 tables inside a rolled-back transaction, and verifies empty/populated classification, quoted names, partitions and composite keys. Run it with `cargo test --manifest-path src-tauri/Cargo.toml --lib bulk_scan_preserves -- --ignored`. SQL Server live integration remains to be verified.

Compact semantic format: AI returns only summary, row grain, overall confidence, optional synonyms, short field meanings, declared relationship meanings/risks, and query-critical uncertainties. Empty optional lists are omitted. The scan supplies exact schema facts; the AI does not repeat them. Existing semanticVersion 2 maps remain readable. New calls use compact field tuples and an output budget proportional to field/relationship count. Completed descriptions are preserved on retry; scan and ingest again to regenerate them in the compact format.
