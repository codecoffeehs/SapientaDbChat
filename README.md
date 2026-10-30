# Sapienta

A local workspace for your databases, built with Tauri 2, React, TanStack Router, TanStack Query, Zustand, shadcn, and Hugeicons.

## Run

```sh
bun install
bun run tauri dev
```

Requires Rust 1.88 or newer and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Cargo downloads the database drivers and bundled SQLite on the next desktop run. `bun run dev` serves the frontend only; testing connections and saving workspaces require the desktop app.

## Current flow

1. Choose PostgreSQL, SQL Server, or MongoDB.
2. Give your workspace a name and enter its connection string.
3. **Test connection** runs a fixed read-only check in Rust. Success appears as a toast; queries and result data are not exposed in the UI.
4. **Save database** writes the verified connection to local SQLite and opens your workspace collection.
5. Add your AI API key when prompted on first startup. It is saved in the OS credential store and reused on future starts.
6. Open a saved workspace and choose **Prepare my database**. Follow four steps: scan, review only empty items, choose a local folder or S3 destination, then review and start.
7. Start ingestion, keep the app running, and watch the floating progress panel or the native Windows tray/macOS menu-bar status. Chat opens only when every selected item is processed and the catalog is saved successfully.

The welcome screen has an interactive database/workspace preview. Workspaces support search, grid/list views, a collapsible desktop sidebar, and a mobile navigation drawer. Light/dark appearance is available throughout the app and saved in SQLite.

The chat interface is deliberately UI-only. Suggestions fill the composer, the draft can be edited or cleared, and the details drawer shows real saved workspace metadata. Sending is disabled. Opening a workspace reads its saved ingestion status. Schema inspection and model calls happen only when you explicitly start scanning and ingestion. No chat model calls, generated answers, or persisted chats are implemented. Drafts are not saved and reset when you leave a workspace.

## Local storage

Rust creates `sapienta.sqlite3` inside Tauri's application data directory for `com.sapienta.dbchat`.

On macOS, this is normally:

```text
~/Library/Application Support/com.sapienta.dbchat/sapienta.sqlite3
```

- `workspaces`: ID, name, database provider, full connection string, database name, creation time, and last successful verification time.
- `settings`: appearance preference (`light` or `dark`).
- `ingestion_destinations`: reusable local folders or S3 configurations (including S3 credentials).
- `ingestion_runs`: structural metadata, inferred semantic descriptions, progress, and selected destination. Successful items are checkpointed for retry.

Sidebar **Settings** replaces the single app-wide API key after native confirmation; the previous stored key is overwritten, with no per-database keys. The AI service URL is not displayed in the app.

The AI API key is stored separately in macOS Keychain, Windows Credential Manager, or Linux Secret Service. It is never returned to React, saved in SQLite, or included in catalog exports. Linux needs an unlocked Secret Service and the system D-Bus development libraries when building. Secure-storage failure is surfaced rather than falling back to plaintext.

See [ingestion setup and API contract](docs/ingestion.md) for endpoint configuration and catalog behavior.

Connection strings, including credentials, are stored as plaintext in this local SQLite file as requested for this stage. On Unix, the app directory and database file are restricted to the current OS user. Connection strings are not included in workspace-list responses, browser storage, URLs, or logs. There is no automatic cloud sync; an explicit ingestion can upload schema catalogs to your chosen S3 bucket.

Saving is gated in Rust as well as the UI: a successful check creates a short-lived token bound to the exact tested connection. Save consumes the token; expired checks require testing again. Editing a connection string clears verification in the form. Connection checks have a 20-second overall timeout and close their connections after completing.

## Connection formats

| Database | Example |
| --- | --- |
| PostgreSQL | `postgresql://user:password@localhost:5432/my_database?sslmode=prefer` |
| SQL Server | `Server=tcp:localhost,1433;Database=my_database;User Id=sa;Password=your_password;Encrypt=true;TrustServerCertificate=false;` |
| MongoDB | `mongodb://user:password@localhost:27017/my_database?authSource=admin` |

MongoDB Atlas `mongodb+srv://` URIs are supported; include a database name. MongoDB's ping verifies server connectivity, not the existence of the selected database or collection permissions. SQL Server uses SQL authentication with an explicit host and port; integrated authentication and named-instance discovery are not configured.

MongoDB uses system DNS first. For Atlas SRV hosts ending in `.mongodb.net`, if the DNS driver fails to parse a system nameserver address, discovery retries with Cloudflare DNS within the same 10-second discovery deadline. The resolver is retained for SRV polling; credentials still go only to MongoDB. Other DNS failures and non-Atlas hosts do not trigger this fallback, and no operating-system DNS settings are changed.

PostgreSQL and SQL Server use the system trust store for TLS. A local SQL Server with a self-signed certificate can be explicitly configured with `TrustServerCertificate=true`. MongoDB honors the TLS options in its URI. Certificate verification is not bypassed automatically.

## Project layout

- `src/router.tsx`: TanStack Router using the generated route tree and desktop hash history.
- `src/routes/`: file-based routes, including the root, onboarding layout, nested workspace layout, and screens.
- `src/routeTree.gen.ts`: generated by the Router plugin during development, or `bun run routes:generate`. Do not edit manually.
- `src/lib/queries.ts`: Query client and shared SQLite-backed app-data query. Routes and components call `useQuery` directly and destructure its state; writes use inline `useMutation` with cache updates and invalidation.
- `src/stores/`: Zustand stores for sidebar/display state and temporary connection/chat drafts. Persisted workspace data and request status stay in TanStack Query. Drafts are never persisted.
- `src/components/layout/`: shared branding, theme switch, onboarding shell, and workspace sidebar.
- `src/components/database/`: test-and-save connection form.
- `src/components/workspace/`: chat interface and database details drawer.
- `src/lib/`: database configuration and shared frontend types.
- `src/components/ingestion/`: scan review, progress, destination picker, and startup API-key prompt.
- `src-tauri/src/credentials.rs`: OS credential storage for the AI API key.
- `src-tauri/src/ingestion/`: schema scanning, AI catalog creation, checkpointing, and local/S3 export.
- `src-tauri/src/database/`: read-only database verification and drivers.
- `src-tauri/src/storage.rs`: SQLite initialization, saving/listing workspaces, verification tokens, and settings commands.

No tests, builds, or live connection checks were run for this implementation, as requested.
