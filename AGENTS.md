# Kwantflow: guidance for coding assistants

Kwantflow is a local-first Svelte 5 + Tauri 2 desktop app (macOS, Windows) for RFQs, file review,
estimating and quotes, with optional on-device AI. It is GPL-3.0-only open source.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before making changes and [CONTRIBUTING.md](CONTRIBUTING.md)
for the workflow.

## Commands

- Run: `pnpm tauri dev`
- Verify everything: `pnpm verify` (check, lint, unit tests, migration lock, cargo check, Rust tests)
- Focused: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm tauri:check`, `pnpm tauri:test`
- Migrations: add a new forward-only change, then run `pnpm migrations:lock`
- Native AI/PDF libraries: `pnpm native:prepare`. Installer: `pnpm distribution:build`
- Licence compliance: `pnpm third-party:sources:prepare && pnpm third-party:verify`

## Rules

- Layering: UI → `$lib/state` → `$lib/services` → Tauri commands. Components never import DB
  services directly. Rust owns SQLite connections, migrations and transactions.
- Local-first: everything works offline. No accounts, telemetry, hosted services or auto-update.
  Network use is optional, user-initiated and fails clearly.
- AI is assistive only. It never bypasses validation, user approval or deterministic quote maths.
- Never log prompts, model output, customer documents or OAuth tokens.
- Svelte 5 runes only. Never mutate state in `$derived`, `{@const}` or templates. Key every `{#each}`.
- Guard Tauri-only APIs with `isTauri()`. Parse SQL reads through `src/lib/schemas/index.ts`.
- Path-accepting Tauri commands must enforce approved roots and reject traversal and symlinks.
- Reuse components from `src/lib/components/ui/`. Use semantic classes, not arbitrary Tailwind
  values. UI copy uses Australian English.
- Do not hand-edit `src-tauri/icons`. Regenerate with `pnpm branding:regen` from `assets/brand/`.
- Use `pnpm`. Update `docs/user/` when user-facing behaviour changes.
- Runtime or visual changes need checking in the running app, not only static checks.
