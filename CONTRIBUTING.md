# Contributing to Kwantflow

Thanks for helping improve Kwantflow! Bug reports, documentation fixes and pull requests are all
welcome.

## Getting set up

1. Install Node `24.18.0`, pnpm `11.9.0`, Rust (the version in `rust-toolchain.toml` installs
   automatically) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for
   your OS.
2. Install dependencies and start the app:

   ```sh
   pnpm install --frozen-lockfile
   pnpm tauri dev
   ```

   Development runs use a separate app identity (`com.kwantflow.desktop.dev`), so they never
   touch data from an installed Kwantflow. `pnpm dev:reset:fresh-run` wipes the development data
   so you can test first-run setup again.

3. Optional: `pnpm native:prepare` downloads the pinned LiteRT-LM and PDFium native libraries
   so Local AI works in development. Without it, AI features report that the engine is
   unavailable, and everything else works.

## Everyday commands

| Command                                | What it does                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm tauri dev`                       | Run the desktop app with hot reload                                                    |
| `pnpm dev`                             | Run only the web UI in a browser (Tauri APIs are mocked or unavailable)                |
| `pnpm check`                           | Svelte and TypeScript type-check, plus a generated DB types check                      |
| `pnpm lint` / `pnpm format`            | Prettier and ESLint (a few legacy files are excluded in `eslint.config.js`)            |
| `pnpm test`                            | Vitest unit tests                                                                      |
| `pnpm tauri:check` / `pnpm tauri:test` | `cargo check` / Rust unit tests                                                        |
| `pnpm migrations:verify`               | Make sure shipped SQL migrations were not edited                                       |
| `pnpm verify`                          | Everything above. Run it before opening a PR                                           |
| `pnpm storybook`                       | Component explorer (`pnpm storybook:test` needs `pnpm exec playwright install webkit`) |
| `pnpm distribution:build`              | Build a local installer (needs `pnpm native:prepare`)                                  |
| `pnpm third-party:verify`              | Licence and notice checks (needs `pnpm third-party:sources:prepare`, about 1 GB)       |

## How the code is organised

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. The short version:

- `src/` is the Svelte 5 UI. Layers: components → `$lib/state` → `$lib/services` → Tauri commands.
- `src-tauri/` is Rust. It owns SQLite, migrations, file access, email integrations and the
  Local AI runtime.
- `docs/user/` is the user manual bundled into the app (one Markdown page per topic, listed in
  `docs/user/manifest.json`). Update it when you change user-facing behaviour.

## Ground rules

- **Local-first:** every feature must work offline. Network access must be optional,
  user-initiated and fail clearly. Do not add telemetry, accounts or hosted services.
- **AI is assistive:** AI output never bypasses validation, user approval or the deterministic
  quote maths.
- **Database changes** are forward-only. Add a new migration file, never edit a shipped one,
  then run `pnpm migrations:lock`.
- **Privacy in logs:** never log prompts, model output, customer documents or tokens.
- **Svelte 5 runes only.** Don't mutate state inside `$derived` or templates, and key every
  `{#each}` block.
- Use `pnpm`, not npm or yarn.

## Pull requests

1. Fork the repository and create a branch.
2. Keep changes focused, and add or update tests.
3. Run `pnpm verify`. If you changed UI or behaviour, also try it in `pnpm tauri dev`.
4. Describe what changed and why in the PR.

By contributing, you agree that your contributions are licensed under the project's
[GPL-3.0-only](LICENSE) licence.

## Reporting bugs

Open an issue with your Kwantflow version, operating system, steps to reproduce and what you
expected. **Settings > General > Export diagnostic logs** saves a local zip you can inspect and
attach. Nothing is uploaded automatically. For security issues, see [SECURITY.md](SECURITY.md).
