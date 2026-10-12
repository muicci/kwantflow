# Kwantflow Architecture

This document is for contributors. It explains how the desktop app is put together, the rules
the code relies on, and how to make common kinds of change safely. When this document and the
code disagree, the code wins. Please fix the document in the same change.

User-facing instructions (setup, backup and restore, model download, email setup) live in
[`docs/user/`](docs/user/README.md). Build prerequisites are in [`README.md`](README.md).

## 1. Overview and principles

Kwantflow is a local-first desktop app for fabrication and machine shops. It handles RFQ intake,
file and drawing review, estimating and quote preparation on macOS and Windows. It is built
with Svelte 5 (SvelteKit with the static adapter) on Tauri 2, with Rust and SQLite underneath.
It is not a web app and is never deployed to a server.

### The local-first contract

- Everything works offline: workspaces, RFQs, files, viewers, manual estimating, quote maths,
  quote PDF/XLSX export, backups and Local AI once its model is installed.
- Only two network paths are optional:
  1. **Email intake.** Gmail or Microsoft Graph, using an OAuth client ID that the user
     registers with their own Google or Microsoft account. Kwantflow ships no client ID and no
     client secret.
  2. **The one-time Local AI model download** from Hugging Face. It is pinned to an exact
     revision and SHA-256.
- There are no accounts, billing, telemetry, crash reporting service, automatic updater, hosted
  database or cloud relay. Do not add any.
- Network actions must stay optional. They must fail clearly through the error hub and must
  never block local work.
- Quote totals, markup and commercial maths come from the deterministic local quote engine
  (`src/lib/state/quote.svelte.ts`). AI output never replaces it.
- Local AI only assists. It never bypasses validation, explicit user approval, or the quote
  engine.

## 2. Repository layout

| Path                                                     | Contents                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`                                            | SvelteKit routes: RFQ list, `project/[id]`, catalogue pages, detached `preview/` windows                                   |
| `src/lib/components/`                                    | Feature components. `ui/` holds the owned Bits UI-based kit; `primitives/` holds layout and text primitives                |
| `src/lib/state/`                                         | Svelte 5 rune state hubs (`*.svelte.ts`), the only layer the UI talks to                                                   |
| `src/lib/services/`                                      | Persistence, IPC, file processing, AI and export services                                                                  |
| `src/lib/schemas/`                                       | Zod schemas for row parsing, forms and AI contracts                                                                        |
| `src/lib/types/`                                         | `db.ts` (generated from migrations) and domain types in `index.ts`                                                         |
| `src/lib/constants/`                                     | Single-source contracts: file support, workspace features, setup import registry, Local AI manifest loader                 |
| `src/lib/workers/`                                       | Web workers: OCCT (STEP/IGES), office/DWG parsing, industrial preprocessing                                                |
| `src/lib/design/`, `tokens/`                             | Design tokens and generated CSS (`pnpm design:build` / `design:verify`)                                                    |
| `src-tauri/src/`                                         | Rust backend: `lib.rs` (commands, protocols, paths), `db/`, `local_ai.rs`, `backup.rs`, `integrations/`, `secure_store.rs` |
| `src-tauri/native/`                                      | C ABI adapter for LiteRT-LM (`litert_lm_bridge_litert.cc`) and the fail-closed development stub                            |
| `src-tauri/migrations-control/`, `migrations-workspace/` | SQLite baselines and upgrades, locked by `*.lock.json`                                                                     |
| `src-tauri/migration-manifest.json`                      | Registry of every migration file, its layer and its status                                                                 |
| `src-tauri/local-ai-runtime-manifest.json`               | Pinned LiteRT-LM runtime version, model repository, revision, size and SHA-256                                             |
| `src-tauri/capabilities/`, `permissions/`                | Tauri capability files per window and the allow-list of app commands                                                       |
| `content/local-assistant/`                               | Markdown help corpus that the Local Assistant answers from                                                                 |
| `tests/fixtures/`                                        | Synthetic fixtures: CAD, email, intake, setup import spreadsheets, sample documents, database upgrades                     |
| `scripts/`                                               | Build, verification, native input, distribution and licensing scripts (run with `node --import tsx`)                       |
| `packages/libheif-js/`                                   | Vendored libheif WASM package for HEIC decoding                                                                            |
| `third-party/`                                           | License manifest, dependency inventory, notices, native source recipes and pinned upstream sources                         |
| `native-inputs.json`                                     | SHA-256-pinned native binary inputs (LiteRT-LM, PDFium)                                                                    |
| `assets/brand/`                                          | Master app icon sources. `src-tauri/icons` is generated by `pnpm branding:regen`; never edit it by hand                    |
| `docs/user/`                                             | Bundled end-user documentation                                                                                             |

## 3. Layering

```text
Svelte components / routes
        |
$lib/state  (rune state hubs: app, workspace, projects, quote, contacts, materials, ai, assistant, ...)
        |
$lib/services  (db.ts, control-db.ts, store.ts, assets.ts, local-ai.ts, email.ts, ...)
        |
Tauri IPC  ->  Rust commands  ->  SQLite (SQLx pools), file system, native LiteRT-LM, OS keychain
```

Rules:

- **Components and routes never import `$lib/services/db` or `$lib/services/store`.** They go
  through a state hub. Route loaders should use state-owned loading helpers.
- **State hubs own reconciliation.** After a narrow write, fetch the changed record with a
  narrow getter (for example `getFooById()`), patch local state, and keep the hub's ordering:
  manual order, alphabetical, or tree `sort_order`. Use `refresh()` only as a fallback. Avoid
  `invalidateAll()` for single-record changes. In tree data (cost codes, WBS), local deletes
  must also remove the descendants that SQLite cascades.
- `projectsState` owns the shared workspace snapshot for the `/project/[id]` route family.
  Narrow project actions refresh that snapshot. A project route whose project is not in the
  active workspace recovers to the RFQ list.
- **Guard Tauri APIs with `isTauri()`** (`src/lib/utils/env.ts`). Outside Tauri (Vitest,
  Storybook, plain `vite dev`) services run in mock mode and log a warning instead of crashing.
- **Never import Node built-ins** (`fs`, `path`, ...) in frontend code. Use
  `@tauri-apps/api` or Tauri plugins.
- **Parse SQL reads with Zod** schemas from `src/lib/schemas/index.ts`. Use `z.preprocess()`
  for SQLite values such as integer booleans, numeric aggregates and JSON text columns.
- **Route user-facing errors through `errorState`** (`src/lib/state/errors.svelte.ts`). Never
  use `alert()` and never swallow errors silently. Keep the first native or transactional error;
  cleanup errors are secondary.
- **Tauri Store is for UI preferences only** (sidebar state, table preferences, dismissed
  rows). Business data lives in SQLite.

### Logging

- Frontend code logs only through `createLogger(scope)` from `src/lib/services/logger.ts`. It
  redacts token-, secret-, password- and session-like keys and bearer strings. Raw `console.*`
  belongs only in tests, scripts and the logger itself.
- Rust code uses the `log` facade. `tauri-plugin-log` has exactly two targets: the Webview and
  one bounded, best-effort file dispatch (`kwantflow.log` in the app log directory, capped at
  about 2 MB). Do not add the plugin's stdout, stderr, LogDir or Folder targets. Their I/O
  failures can abort the process. Do not create per-subsystem log files.
- The panic hook writes `kwantflow-crash-*.txt` straight to the OS temp directory. It must not
  go through logging.
- The support diagnostics bundle is opt-in and built from the bounded log directory.
- **Never log** prompts, model reasoning, customer documents, extracted evidence, email bodies,
  catalogue contents, base64 payloads, OAuth tokens, credentials or generated proposal
  payloads. Log identifiers, counts, stages, durations and failure categories instead.

## 4. Data and databases

### Two SQLite authorities

| Database                      | Location                                                     | Contents                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control                       | `<app config dir>/kwantflow-control.db`                      | Five tables: `profile_identity`, `control_contract_state`, `control_customer_identity`, `workspace_registry`, `onboarding_state`                                                                                                                                             |
| Workspace (one per workspace) | `<app local data dir>/workspaces/{workspaceId}/workspace.db` | All business data for that workspace: profile, members, settings, contacts/companies, catalogues and rates, RFQs/projects, files, assets, WBS, estimates, quotes and revisions, email integrations, AI run audit, evidence cache, assistant action audit, setup import audit |

- Rust owns every connection. `DatabaseRuntime` (`src-tauri/src/db/runtime.rs`) opens the SQLx
  pools, sets PRAGMAs (`foreign_keys = ON`, WAL, `synchronous = NORMAL`, 10 s busy timeout),
  applies baselines, runs integrity checks and switches the active workspace. There is no
  frontend SQL plugin.
- The frontend keeps Kysely as a query builder. Each query is sent over request-scoped IPC
  (`query_*_database` / `execute_*_database`, see `src/lib/services/native-database.ts` and
  `src-tauri/src/db/ipc.rs`). Only the `main` window may run mutations. Detached preview windows
  are read-only.
- **Generic IPC runs one statement only. Frontend transactions are not supported.** Any
  multi-step write that would leave data inconsistent if interrupted must be a typed Rust
  command that uses one SQLx transaction (see `src-tauri/src/db/commands.rs`, `workspace.rs`,
  `assistant_proposals.rs`). The frontend `withWriteLock` only serialises writes; it does not
  make them atomic.
- Workspace commands fail when no workspace is active; nothing falls back to the control
  database. Create, activate and delete take workspace IDs, never file paths. Activation runs
  `PRAGMA quick_check` and `foreign_key_check` first, and switching waits for in-flight
  operations before the pool is replaced.
- Profile and vault lock files stop two app instances from opening the same profile.
- OAuth tokens never go into SQLite or backups (see section 7).

### Files and the vault

Each workspace has an isolated vault:
`~/Documents/Kwantflow/workspaces/{workspaceId}/vault/`. Development and test identities use
`<app local data dir>/qa-documents/` so they never touch a real user's documents.

- `ingest_file` copies a source file to
  `workspaces/{workspaceId}/vault/workspace/{projectId}/{uuid}.{ext}` and returns that path
  relative to the `Kwantflow` root. SQLite stores only this relative path; the original
  filename is separate metadata. Never store binaries or absolute paths in SQLite.
- Same-named imports never overwrite each other. A failed copy removes only its own partial
  file. RFQ intake fails hard if ingestion fails.
- The `kwant-asset://` protocol serves images from the workspace vault only. Do not widen it.

### Migrations

`src-tauri/migration-manifest.json` lists every migration with its layer and status. Today each
layer has two files:

| File                                    | Status         | Purpose                                                        |
| --------------------------------------- | -------------- | -------------------------------------------------------------- |
| `001_control.sql` / `001_workspace.sql` | `active`       | Fresh schema v2 baseline for new databases                     |
| `002_local_open_source.sql`             | `upgrade-only` | Converts an existing schema v1 database (desktop 0.12.x) to v2 |

How it works:

- A new, empty database gets the `001` baseline in one transaction. The baseline writes
  `schema_version = 2` into `control_contract_state` or `runtime_contract_state`. Startup
  refuses any version other than `CONTROL_SCHEMA_VERSION` or `WORKSPACE_SCHEMA_VERSION`.
- Migrations are **forward-only and immutable once shipped.** `pnpm migrations:verify` checks
  every SQL file against `migrations-control.lock.json` and `migrations-workspace.lock.json`
  and fails if a shipped file has changed. `pnpm migrations:lock` rewrites the locks; use it
  only for new files.
- `pnpm db:generate-types` rebuilds `src/lib/types/db.ts` by applying the manifest's `active`
  migrations to in-memory SQLite. `pnpm check` fails if the generated file is stale.
- `scripts/migration-manifest.test.ts` (part of `pnpm test`) checks that the manifest and the
  files on disk agree.

**Upgrading from v1 (0.12.x).** Before any normal query, `migrate_and_validate_local_databases`
does the following on dedicated connections:

1. Takes a `.schema-upgrade.lock` and rejects symlinked roots.
2. Reads every registered workspace and checks that its path is exactly
   `workspaces/{id}/workspace.db`.
3. Checks each database's integrity and compares its schema **exactly** against either the v1
   fixture (`tests/fixtures/db-upgrades/v1/*.sql`) or the v2 baseline. An unknown, damaged or
   missing database stops startup with a recovery message. Nothing is reset.
4. Writes a complete recovery set (control database plus every workspace database, with a
   `complete.json` receipt) to `<app local data dir>/schema-recovery/v1-to-v2-<uuid>/`.
5. Upgrades each workspace, then the control database last so a crash can resume. Each upgrade
   is one `IMMEDIATE` transaction with foreign keys disabled. Before commit it checks that the
   version advanced, preserved business row counts are unchanged, the result matches the v2
   baseline, and integrity checks pass.

If the control database is missing but managed profile data exists, startup demands recovery
instead of creating an empty install. `tests/fixtures/db-upgrades/manifest.json` pins the v1
fixture hashes. The Rust tests in `runtime.rs` cover resumption, damaged inputs and
non-destructive failure.

**Adding a schema change.** The runtime currently implements exactly one upgrade step (v1 to
v2), so the first forward migration has to extend it:

1. Do not edit `001` or `002`. Add `src-tauri/migrations-<layer>/003_<description>.sql`. It
   must bump `schema_version` in that layer's contract table.
2. Register the file in `migration-manifest.json`.
3. Extend `DatabaseRuntime`:
   - bump the schema version constant;
   - apply `003` after the baseline for new databases, and as an upgrade step for v2
     databases (with a recovery snapshot first);
   - compare startup schemas against baseline plus forward migrations;
   - check the schema versions that `backup.rs` accepts.
4. Run `pnpm migrations:lock` and `pnpm db:generate-types`.
5. Update `src/lib/types/index.ts`, the Zod schemas, the owning service (`db.ts` or
   `control-db.ts`), state hubs and UI.
6. For first-class workspace tables, update `src/lib/constants/workspace-feature-contract.ts`
   and `workspace-records.ts`. Every column must be covered by a form schema or explicitly
   excluded. If the table can be imported, also update `setup-import-registry.ts`. Shared enum
   branches (`CostComponentCategory`, `CostComponentSourceType`, rate-card units) must change
   in SQL constraints, TypeScript unions, Zod schemas and every consumer at once.
7. Add a synthetic fixture for the previous schema under `tests/fixtures/db-upgrades/` (with
   its hash in `manifest.json`) and Rust tests for upgrade, rollback and preserved data.

Never delete or reset user data automatically. Removing installed columns or tables needs a
recovery snapshot, a transactional conversion and checks that business data was preserved.

### Workspace records and setup import

- `src/lib/constants/workspace-feature-contract.ts` classifies every database table. Each one is
  a first-class feature, project-operational, foundation, internal, quote snapshot or AI audit
  table. `workspace-records.ts` declares the user-facing record pages. A new table must be
  declared in both files.
- The CRM table is `contacts`, but the product calls it Companies (`/companies`). People are
  child rows linked to a company. Companies link to materials and to labour, equipment and
  subcontract rates through four junction tables (`company_*_links`), never through hidden
  supplier columns. Relationship writes go through typed Rust replacement commands.
- Setup import (`src/lib/state/setup-import.svelte.ts`, `src/lib/services/setup-import.ts`,
  `src/lib/constants/setup-import-registry.ts`) seeds reusable records from CSV or XLSX. It
  imports companies, catalogues, rates, presets, templates, project structure templates,
  classification systems and cost codes. It does not import RFQs, estimates or files.
- Sheet and field matching is local and deterministic. Ambiguous matches stay in review.
- **Update matched** changes only the fields the user mapped.
- Company links in an import are given as semicolon-separated names. A missing or ambiguous
  match blocks the preflight check.
- The final apply runs one Rust transaction (`apply_setup_import_session_command`). That
  transaction also writes a compact `setup_import_audit` row: file name and hash, counts and
  outcomes, but never cell values.
- Synthetic sample spreadsheets live in `tests/fixtures/setup-import/`.

### Backups and restore

`src-tauri/backup.rs` (manifest version 4; it also reads version 3) does the following:

- **Snapshots** go to `<app local data dir>/backup-store/`. They include the vault workspaces,
  the workspace databases, the control database, `store.json` and the email provider settings.
  Provider settings hold only public client IDs.
- **Portable archives** can be exported and imported as `.zip` files.
- **Restore** is staged to `backup-store/pending/` and applied at the next startup, before the
  databases open. A restore journal moves files with stage and rollback copies.
- **Credentials and the Local AI model are never included.**

File-mutating commands share a backup mutation guard so a snapshot never captures a
half-written vault.

## 5. Files, CAD and PDF viewers

`src/lib/constants/file-support.ts` is the single source of truth for which extensions can be
uploaded, attached, previewed and thumbnailed, and how each is prepared for AI. Add formats
there, not in individual viewers. `single-file-viewer.svelte` routes each file type to its
viewer.

| Format                        | Implementation                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PDF (view)                    | `pdfjs-dist` in `pdf-viewer.svelte`                                                                                                       |
| PDF (text, raster)            | PDFium in Rust (`extract_pdf_text`, `extract_pdf_pages_text`, `rasterize_pdf_pages`, `crop_pdf_subquadrant`)                              |
| DWG                           | LibreDWG WASM (`@mlightcad/libredwg-web`) in a web worker (`dwg-converter.ts`), converted to DXF/SVG plus entity metadata                 |
| DXF / 2D CAD view             | `@mlightcad/cad-simple-viewer` (`cad-2d-viewer.svelte`, `cad-viewer-service.ts`)                                                          |
| STEP / IGES                   | `occt-import-js` in `src/lib/workers/occt-worker.ts`                                                                                      |
| STL / OBJ / 3MF               | Three.js loaders (`cad-loader.ts`, pinned to Three.js 0.172.x for the MlightCAD stack)                                                    |
| HEIC                          | Vendored `libheif-js` WASM, converted to JPEG locally (`intake-preprocessing.ts`)                                                         |
| CAD text fonts                | Open-licensed SHX/TTF/OTF fonts in `static/cad-data/fonts/`; regenerate the derived "Kwantflow Open CAD" font with `pnpm fonts:build:cad` |
| TIFF, XLSX/CSV, DOCX, EML/MSG | `tiff`, `xlsx`/`papaparse`, `mammoth`, `eml-parse-js`/`@kenjiuno/msgreader`                                                               |

Viewers share one pan and zoom model. Button zoom snaps in 5% steps (25% to 400%). Wheel zoom
centres on the cursor. The canvas transform is
`translate(calc(-50% + panX), calc(-50% + panY)) scale(cssZoom)` with
`cssZoom = displayScale / renderedScale`. Quote preview and download come from the same
generated PDF bytes. Pass fresh `Uint8Array` copies across preview, cache and save boundaries,
because Tauri detaches buffers it consumes.

### Path safety for Tauri commands

Any command or protocol that accepts a path must enforce safety in Rust (helpers in
`src-tauri/src/lib.rs`):

- Relative vault paths go through `normalize_safe_relative_path`, which rejects `..`, absolute
  paths, drive prefixes and empty paths. IDs used as path segments go through
  `resolve_safe_path_segment`.
- Existing paths are canonicalised and must stay under an approved root
  (`resolve_existing_path_within_root`, `resolve_file_within_roots`).
- Symlinks are rejected for files and directories that are imported, written or deleted.
- External files (drag-drop, setup import spreadsheets) must be authorised through
  `allow_external_file_read`. It accepts files only under the home directory, the temp
  directory, `/Volumes` on macOS, or secondary drive letters on Windows. Never grant blanket
  file system scopes.
- Do not expose generic "open any path" commands. Use intent-specific commands for approved
  roots.
- The `opener:allow-open-url` scope in `src-tauri/capabilities/*.json` allows any `http`, `https`,
  `mailto` and `tel` URL, because the email viewer and quote email dialog open user-chosen links in
  the system browser or mail client. Keep `opener:allow-open-path` and `reveal-item-in-dir` denied.

**Adding a Tauri command:**

1. Implement it and register it in `generate_handler!` in `lib.rs`.
2. Add its name to `APP_COMMANDS` in `src-tauri/build.rs`.
3. Add its `allow-<command>` permission to `src-tauri/permissions/default.toml`, and to a
   window's capability file only if that window needs it.

## 6. Local AI and the Local Assistant

### Runtime

- There is one native runtime path: Rust (`src-tauri/src/local_ai.rs`) calls a narrow C ABI
  (`src-tauri/native/litert_lm_bridge.h`), which wraps **LiteRT-LM v0.16.0** running
  `litert-community/gemma-4-E4B-it-litert-lm`. There is no sidecar, localhost server, Ollama,
  Docker or second runtime.
- Release builds require the real native library (`KWANTFLOW_REQUIRE_LITERT_LM_NATIVE`; release
  builds cannot disable it). Debug builds without native inputs use a fail-closed stub.
- Chat and tool turns use the LiteRT-LM `Conversation` API. Each turn runs on a clone of the
  committed conversation. Cancelling discards the clone; completing commits it. The upstream
  v0.16 API must not be reused after cancellation, so do not replace this with raw `Session`
  calls. Multimodal turns use a full-prefill completion path. The context allocation is capped
  at 32,003 tokens.
- The engine loads lazily on the first user-started AI operation and stays resident. Starting
  the app, opening the sidebar and finishing onboarding never load the model. Do not add warm-up
  prompts or idle unload timers. Streams are request-scoped, and a finished or cancelled request
  must leave no active streams.
- Reasoning output is kept on a separate channel. It is never logged, persisted or replayed as
  conversation history.

### Model manifest, download and verification

`src-tauri/local-ai-runtime-manifest.json` pins the runtime version, model repository, **exact
revision**, file name, expected size (3,659,530,240 bytes) and **SHA-256**. Rust and TypeScript
(`src/lib/constants/local-ai-runtime-manifest.ts`, validated with Zod) both read it. At startup,
`validate_manifest_consistency` checks its shape.

- The download URL is
  `https://huggingface.co/{repo}/resolve/{revision}/{file}`. Downloads go to a `.partial` file
  with an identity sidecar so they can resume. A partial file that belongs to a different model
  identity is truncated.
- The full file is SHA-256 verified before install and again by `verify_local_ai_install`. A
  mismatch never loads.
- `archivedMirror` is `null`. A mirror may only be configured with verified part URLs, sizes and
  hashes.
- The model and LiteRT caches are device-wide, under `<parent of app local data>/Kwantflow/local-ai`,
  outside workspace storage and backups. Users see the model size before downloading.

To change the model, update the manifest (revision, size, SHA-256) and check the capability
flags. Never load an unpinned file.

### Environment overrides (all optional; see `.env.example`)

| Variable                                 | Effect                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `KWANTFLOW_FORCE_CPU`                    | Skip the GPU backend. Without it, GPU is tried first and CPU is the automatic fallback |
| `KWANTFLOW_DISABLE_SPECULATIVE_DECODING` | Turn off LiteRT-LM speculative decoding                                                |
| `KWANTFLOW_LOCAL_AI_DIR`                 | Use a different directory for the model and caches                                     |
| `KWANTFLOW_LITERT_LM_RUNTIME_DIR`        | Load a prebuilt LiteRT-LM library from this directory                                  |

`pnpm local-ai:hardware` samples CPU and GPU activity during a run.

### AI features and trust boundaries

Local AI powers Draft with AI (estimate drafting), RFQ and email intake detection, quote email
drafting, and Ask Kwantflow (the Local Assistant). All of them use the shared Local AI service
(`src/lib/services/local-ai.ts`) and the versioned prompts in `src/lib/contracts/ai-prompts.ts`.
Do not add feature-specific native calls.

- Structured output: Zod 4 schemas generate the JSON Schema for the model. Every decoded
  response is validated with Zod before it is cached or applied, and validation fails closed.
- Draft with AI works through these steps:
  1. Preprocess supported files locally into bounded evidence units (PDF pages, text chunks,
     images, CAD renders and metadata).
  2. Extract structured evidence.
  3. Compose the draft and resolve every catalogue, cost code and WBS reference locally.
     Unresolved items stay visible as issues; nothing is invented.
  4. Run the deterministic quote engine.
  5. Prefill the **unsaved** estimate editor for the user to review and save. Reverting
     restores the baseline.
- AI runs are audited separately from live estimates (`ai_runs`, `ai_run_inputs`,
  `ai_run_outputs`, `ai_evidence_refs`, review and override events). Reusable evidence lives in
  `ai_evidence_cache`, which is owned by the file and cascades when the file is deleted.

### Ask Kwantflow (Local Assistant)

Files: `src/lib/state/assistant.svelte.ts`, `src/lib/services/local-assistant.ts`,
`src/lib/services/assistant-actions/registry.ts`, `src/lib/services/assistant-tools/`.

- **Gemma handles meaning, the app handles execution.** Gemma interprets the request, picks
  tools and decides their order. The app owns which tools exist, validates every call,
  executes deterministically, handles cancellation and cleans up. There is no keyword intent
  router or secondary planner.
- **The loop:** user prompt, then Gemma, then optional tool calls, then tool results back to
  Gemma, repeated until Gemma gives a final answer. The loop stops at 24 turns
  (see `local-assistant.ts`).
- **Unknown tools and invalid arguments** go back to Gemma as structured errors. The app never
  rebuilds arguments after a parse failure.
- **Read-only tools:**
  - `calculator_evaluate_decimal`, `formula_validate_quantity` and `units_convert`. Gemma must
    use these for every calculation and unit conversion.
  - `records_describe`, `records_search` and `records_get`, for business records.
  - `inspect_current_screen`, which captures a screenshot only when asked.
- **Record access is allowlisted in Rust.** `SEARCH_SCOPES` and `record_scope_contract` in
  `src-tauri/src/db/commands.rs` define it, using FTS5 or bounded `LIKE` queries. The
  assistant never receives raw SQL or internal tables.
- **Proposal tools** stage changes but never write: `contact_change`, `material_change`,
  `labour_rate_change`, `equipment_rate_change`, `subcontract_rate_change`, `wbs_item_change`,
  `quote_option_change` and `asset_change`.
  - Each validated call stages one record from the user's own numbered mutation clauses.
  - One user turn produces one grouped card with **Approve all** and **Discard all**.
  - Approval runs `execute_approved_record_proposal_set_command`, one SQLite transaction. Rust
    supplies the workspace and timestamp, then validates, checks ownership, reads back and
    audits each item (`assistant_action_audit`). If any item fails, the whole set rolls back.
  - RFQs, estimates, templates and presets stay read-only.
- **Help answers** come from `content/local-assistant/**/*.md`, which is loaded at build time
  with `import.meta.glob`. Keep this corpus user-safe: no internals, prompts or operational
  procedures. Record coverage in `coverage-manifest.json`.

**Adding a record type to the assistant's read tools:**

1. Add one static scope to `SEARCH_SCOPES` and a `RecordScopeContract` in `commands.rs`. It
   defines the searchable fields, detail fields, filters, base table, joins and the
   workspace/project ownership columns.
2. Use FTS5 for indexed text, or a bounded `LIKE` query for small tables.
3. Leave the three generic TypeScript tool declarations unchanged.
4. Add Rust ownership tests (no cross-workspace or cross-project leakage) and focused record
   tool tests.

Read access does not make a record writable. Add a proposal scope only when one typed approval
adapter can validate fields, ownership, relationships, duplicate creates, audit and readback
for that domain. Never add per-field tools, nested batch schemas or keyword routing.

## 7. Email intake integrations

Files: `src-tauri/src/integrations/mod.rs`, `src/lib/services/email*.ts`,
`src/lib/state/integrations.svelte.ts`.

- The user pastes their own **Google Desktop OAuth client ID** (it must end in
  `.apps.googleusercontent.com`) or **Microsoft application client ID** (a UUID) and tenant
  (`common`, `organizations`, `consumers` or a tenant UUID). These are saved per installation
  in `<app local data dir>/email-provider-settings.json`. See
  [`docs/user/EMAIL_SETUP.md`](docs/user/EMAIL_SETUP.md).
- Authorisation uses the system browser, PKCE (S256) and a temporary loopback listener with a
  session timeout and cancellation. **No client secret is required, embedded or logged.**
  Granted scopes are checked: `gmail.modify` and `userinfo.email` for Gmail; Graph `Mail.ReadWrite`,
  `Mail.Send`, `User.Read` and `offline_access` for Microsoft.
- **Tokens** are stored in the macOS Keychain (service `com.kwantflow.desktop.email`), or with
  current-user Windows DPAPI encryption, keyed by integration ID. Other platforms fail closed.
  Tokens never go into SQLite, logs or backups. They are deleted when an integration is revoked
  or its workspace is deleted.
- Mailbox connections belong to a workspace (`workspace_integrations`). Native mail commands
  only use a token whose integration ID exists in the active workspace. Switching workspaces
  clears in-memory mail state. Projects created from email are identified by
  `source_email_integration_id` plus `source_email_message_id`. AI mail verdicts go to
  `email_rfq_classifications`.
- Without a provider, users can import `.eml` and `.msg` files and send quotes from their own
  mail app.

## 8. UI conventions

- **Svelte 5 runes only:** `$state`, `$derived`, `$effect`, `$props`. Never change state inside
  `$derived`, `{@const}` or template expressions.
- Every `{#each}` block has a key.
- Use the owned components in `src/lib/components/ui/` and `primitives/` (`Stack`, `Surface`,
  `Text`, `Meta`, `Panel`, field primitives) before writing new markup. Bits UI provides
  behaviour and accessibility. shadcn-svelte is only a starting reference.
- **Bits UI triggers** wrap the owned `Button` with a child snippet:
  `{#snippet child({ props })}<Button {...props}>…</Button>{/snippet}`.
- Use semantic Tailwind classes and design-system helpers (`ui-*`, `surface-*`, `status-*`,
  `ui-radius-*`, `.caption`, `.small`). Avoid arbitrary Tailwind values and inline styles.
  Tokens live in `tokens/*.json`; regenerate with `pnpm design:build` and never hand-edit
  `src/lib/design/generated/`.
- Put dialog components directly in the template that uses them.
- **macOS titlebar dragging:** outer titlebar and toolbar wrappers stay draggable. Interactive
  children are excluded automatically by `NON_DRAG_TARGET_SELECTOR` in
  `src/lib/utils/window-drag.ts` (buttons, links, inputs, tabs, menu items). Do not put
  `data-no-window-drag` on outer wrappers.
- In vibrant windows (`.vibrant-window`), sidebar and toolbar surfaces use translucent
  `color-mix` variables so macOS vibrancy and Windows Mica show through.
- Shell chrome (tabs, rail buttons, toggles) stays flat, with no hover shadows. Search lives in
  sidebar panels, not page headers.
- **UI copy uses Australian English** ("labour", "catalogue", "colour").
  `src/lib/ui-copy-australian-english.test.ts` enforces this on key surfaces. Do not change
  existing labels or remove elements unless that is the purpose of the change.
- Do not ship placeholder navigation, dead actions, `href="#"` links, or external image URLs for
  local business data.

## 9. Testing and verification

| Command                   | What it runs                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm test`               | Vitest unit project (jsdom), covering `src/**` and `scripts/**` tests                            |
| `pnpm check`              | `svelte-check` plus a check that `src/lib/types/db.ts` matches the migrations                    |
| `pnpm lint`               | Prettier check plus ESLint                                                                       |
| `pnpm migrations:verify`  | Migration checksum locks                                                                         |
| `pnpm tauri:check`        | `cargo check` with the pinned toolchain (`rust-toolchain.toml`)                                  |
| `pnpm tauri:test`         | `cargo test --lib`: database runtime, upgrades, backup, path safety, Local AI and proposal tests |
| `pnpm third-party:verify` | License manifest, inventory and notice checks                                                    |
| `pnpm storybook:test`     | Storybook stories in headless WebKit. Run `pnpm exec playwright install webkit` once first       |
| `pnpm verify`             | `check`, `lint`, `test`, `migrations:verify`, `tauri:check`, `tauri:test`                        |

Run `pnpm verify` before opening a pull request. Many architecture rules are enforced by
static tests next to the code (`*.static.test.ts`). For example, they check the Australian
English UI copy and that no hosted AI provider SDK appears on desktop surfaces.

Static checks do not prove runtime behaviour. For UI, state, file or AI changes, run the app
with `pnpm tauri dev` and check the visible workflow. Development runs use the separate
`com.kwantflow.desktop.dev` identity and an app-local documents vault. Use synthetic data only.
A debug run does not prove an installed release build or another platform.

## 10. Native inputs, packaging and licensing

- **`pnpm native:prepare`** downloads and verifies the SHA-256-pinned native inputs listed in
  `native-inputs.json`: LiteRT-LM v0.16.0 and PDFium `chromium/7920`.
  - On macOS it uses the official universal binaries and checks both Mach-O slices, the 12.0
    deployment target and the dependency closure.
  - On Windows x64 it builds the same pinned LiteRT-LM C ABI from source with Bazel
    (`scripts/native-windows.ps1`, checked-in patches) and checks the staged DLL closure.
  - `--offline` reuses already verified caches.
- **`pnpm distribution:build`** builds installers. By default macOS output is **ad hoc signed**
  and Windows output is **unsigned**; no credentials are needed.
  - `--sign` (macOS only) uses the maintainer's own `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY`,
    `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH` from the environment. It notarises and staples
    the app and the final DMG.
  - A build manifest records the commit, source cleanliness, signing state and installer hash.
  - `pnpm distribution:verify <dir>` checks the output.
- **Corresponding source.** The GPL corresponding source for a release is the matching release
  tag of the public Git repository plus the hash-pinned upstream archives that
  `pnpm third-party:sources:prepare` acquires. `pnpm distribution:source` is an optional
  maintainer tool that exports all of that as one self-contained archive.
  - `--check` checks whether the tree is eligible.
  - `--candidate` makes an unpublished local snapshot.
  - The final export requires a clean Git tree and the `distributionReview` records in
    `third-party/*.json` marked ready. Those records are honest notes about what has not yet
    been rebuilt byte-exactly; they are not a gate for publishing a release.
  - Prepare the inputs first with `pnpm third-party:sources:prepare`, `pnpm sources:prepare`
    and `pnpm sources:verify`.
- **`third-party/`** contains:
  - the license manifest (`manifest.json`) and dependency inventory;
  - the native source manifest and recipes (LiteRT native, libheif, OCCT import, email parsers);
  - pinned upstream sources and collected license texts.

    The LibreDWG WASM bytes are deliberately present three times (`static/wasm/`, `static/workers/`
    and base64 inside `static/workers/libredwg-parser-worker.js`); the bundle, the worker loader and
    the licence check each pin the same hash.

  `THIRD_PARTY_NOTICES.md` is the user-facing notice file. When you add or upgrade a
  dependency, update the inventory and notices so that `pnpm third-party:verify` passes.

- Kwantflow is **GPL-3.0-only**. The pinned Gemma model weights are Apache-2.0 and keep their
  own attribution and license. The app's license does not relicense them.
- Do not remove or bypass the CAD packages, the vendored `packages/libheif-js`, or the
  `@mlightcad` dependencies. Keep the MlightCAD 1.5.11 stack on Three.js 0.172.x with the
  security-patched `lodash-es` 4.18.1 override.
