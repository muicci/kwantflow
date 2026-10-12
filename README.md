# Kwantflow

[![CI](https://github.com/muicci/kwantflow/actions/workflows/ci.yml/badge.svg)](https://github.com/muicci/kwantflow/actions/workflows/ci.yml)
[![Licence: GPL-3.0-only](https://img.shields.io/badge/licence-GPL--3.0--only-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/muicci/kwantflow?include_prereleases)](https://github.com/muicci/kwantflow/releases)

**Free, local, open-source estimating software for fabricators, machine shops and contractors.**

Kwantflow turns RFQs (requests for quote) into organised estimates and professional quotes. It runs entirely on your computer. There is no account, no subscription, no cloud and no telemetry. An optional AI assistant runs **on your own machine**, so your drawings, prices and customer data never leave it.

- **RFQ management:** capture RFQs manually, from imported `.eml`/`.msg` files, or from your own Gmail or Outlook mailbox, then track them on a dashboard.
- **Drawing and file review:** view DWG, DXF, STEP, PDF, images (including HEIC) and Office files side by side with the RFQ.
- **Estimating:** build takeoffs from your own materials, labour, equipment and subcontract rates, cost presets and estimate templates.
- **Quotes:** produce branded PDF quotes with options, revisions and deterministic totals, plus quote emails.
- **Local AI (optional):** draft estimates, ask questions about your workspace, search records and get calculations from a private on-device model.
- **Your data stays yours:** everything lives in local SQLite databases and a files folder, with built-in backup and restore.

Kwantflow runs on **macOS** (Apple Silicon and Intel) and **Windows x64**.

## Download and install

Download the latest installer from this repository's [**Releases**](../../releases) page.

**macOS**

1. Open the `.dmg` and drag **Kwantflow** into **Applications**.
2. Community builds are not notarised by Apple. The first time you open the app, macOS may block it. Open **System Settings > Privacy & Security** and choose **Open Anyway**.

**Windows**

1. Run the `x64-setup.exe` installer. It installs for the current user and includes the WebView2 and Visual C++ prerequisites.
2. The installer is unsigned, so Windows SmartScreen may warn you. Choose **More info > Run anyway**. Managed or S-mode PCs may block unsigned software.

Each release lists SHA-256 checksums so you can verify your download.

## Getting started

1. **Create a workspace.** Enter your business name, country and contact details. These are used on your quotes and stay on your computer.
2. **Set up Local AI, or skip it.** Choose **Download** to install the AI model (about 3.7 GB, one time), or **Skip** to estimate manually. You can install it later from **Settings > Agent**.
3. **Add your setup data.** Add materials, labour and equipment rates, or bulk-import them from a spreadsheet with **Setup import**.
4. **Create your first RFQ,** attach drawings and files, build an estimate and prepare a quote.

The full user manual is built into the app (**Help**) and is also available here: [docs/user/README.md](docs/user/README.md).

## How the Local AI works

Kwantflow AI is a language model running **inside the app on your computer**. There is no server, account, API key or usage cost.

|              |                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Model**    | Google [Gemma 4 E4B](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm) (instruction-tuned, Apache 2.0), about 3.7 GB     |
| **Runtime**  | Google [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM), embedded in the app                                                     |
| **Hardware** | Uses the GPU when available and falls back to the CPU automatically. 8 GB RAM works with a shorter context; 16 GB or more is recommended |
| **Download** | One time, from Hugging Face. The file is checked against a pinned SHA-256 fingerprint before use                                         |
| **Privacy**  | Prompts, files and answers never leave your computer. After the download it works fully offline                                          |

The assistant (**Ask Kwantflow AI**) uses built-in tools instead of guessing:

- it searches records in the active workspace;
- it does exact decimal calculations;
- it reads the current screen and any attached files or images;
- it follows the playbook and knowledge files you add in **Settings > Knowledge**.

It can **propose** new or updated records, but **nothing is written until you approve** the proposal. It never deletes records, never changes quote maths (totals always come from Kwantflow's deterministic quote engine) and never accesses the internet.

AI output is a starting point. Always review quantities, rates, scope and customer-facing wording before quoting.

## Optional email integration

Kwantflow can watch a Gmail or Microsoft 365 / Outlook mailbox for RFQs. To keep things independent and private, you register **your own** OAuth app with Google or Microsoft (free) and paste its client ID into **Settings > Connections**. Kwantflow then talks directly to your provider, with no Kwantflow server in between. Tokens are stored in the macOS Keychain or Windows DPAPI and are never included in backups.

For step-by-step instructions, see [docs/user/EMAIL_SETUP.md](docs/user/EMAIL_SETUP.md). If you'd rather not connect a mailbox, import `.eml` or `.msg` files instead.

## Privacy

- No account, sign-in, licence key or subscription.
- No telemetry, analytics or crash reporting.
- No automatic updates or background network calls.
- The only network access happens when **you** start it: downloading the AI model, or syncing a mailbox you connected yourself.

## Updating

Kwantflow does not update itself. To upgrade, back up your workspace (**Settings > Backups**), then install the newer release over the old one. Your data is migrated automatically.

## Build from source

Prerequisites:

- Node `24.18.0` (see `.node-version`).
- pnpm `11.9.0`.
- Rust `1.94.0` (installed automatically via `rust-toolchain.toml`).
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.
- **macOS:** full Xcode, plus `rustup target add aarch64-apple-darwin x86_64-apple-darwin` for universal builds.
- **Windows:** Visual Studio 2022 C++ Build Tools with the Windows SDK, PowerShell 7, Python 3.13, Java 21 and Git. The Local AI runtime is compiled from source with Bazel.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev               # run the app in development mode
```

The development build works without the native AI runtime: AI features report that the engine is unavailable. To get the real Local AI runtime and PDFium, download the hash-pinned native inputs first:

```sh
pnpm native:prepare          # LiteRT-LM + PDFium (Windows builds LiteRT-LM from source)
pnpm distribution:build      # ad-hoc signed macOS DMG or unsigned Windows installer
pnpm distribution:verify dist/distribution/<version>/<platform>
```

Release builds always need `pnpm native:prepare` first. Maintainers can sign macOS builds with their own Apple Developer ID using `pnpm distribution:build -- --sign` (see [.env.example](.env.example)).

### Checks

```sh
pnpm verify    # type-check, lint, unit tests, migration lock, cargo check and Rust tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [ARCHITECTURE.md](ARCHITECTURE.md) for how the app is put together.

## Licence

Kwantflow is free software: you can use, study, modify and redistribute it under the terms of the [GNU General Public License v3.0 only](LICENSE).

Copyright (C) 2026 Mikhail Eremeev and Kwantflow contributors.

Third-party components keep their own licences. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [third-party/](third-party/). The complete corresponding source for a release is the matching tag of this repository together with the hash-pinned upstream archives that `pnpm third-party:sources:prepare` downloads. The AI model weights are not part of this repository; they are downloaded separately under Google's Apache 2.0 licence.

The Kwantflow name and logo are covered by [TRADEMARKS.md](TRADEMARKS.md).

## Project status

Kwantflow was built as a commercial product and released as open source in 2026. It is **community-maintained**: there is no company behind it and no guaranteed support. Bug reports and pull requests are welcome. Forks are encouraged.
