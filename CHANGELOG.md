# Changelog

## 0.13.0: open-source release (2026-10-15)

Kwantflow is now free, open-source software under the GNU GPL v3.0 only.

### Changed

- No account, sign-in, licence key, trial, subscription or device limit. Every feature is
  available to everyone.
- Gmail and Outlook connections use your own OAuth app registration (client ID entered in
  **Settings > Connections**) and connect directly to the provider.
- Existing 0.12.x workspaces are upgraded automatically. Commercial account data is removed, and
  all business records and files are kept. A recovery copy is made before the upgrade.
- The Windows build no longer ships the DirectX Shader Compiler helpers. Local AI uses the GPU
  through the system shader compiler when available, or the CPU otherwise.
- Automatic RFQ detection no longer marks mailbox messages as read, and runs only when the
  Local AI model is installed.
- The app windows use narrowly scoped file-system permissions instead of whole-directory access.
- Diagnostic logs no longer include assistant prompts, mailbox addresses or imported file names.
- The bundled manual is split into pages and shown with a page list in **Help**.
- Proprietary CAD fonts were replaced with open-licensed Liberation Sans, Noto Sans CJK and the
  derived "Kwantflow Open CAD" and "Open GDT" fonts.

### Removed

- Hosted accounts, billing, entitlements and the hosted sign-in hand-off.
- Crash reporting, telemetry and the hosted support-report upload. **Export diagnostic logs**
  now saves a local zip only.
- The automatic updater. Download new versions from GitHub Releases.
- The Kwantflow website link in generated quote PDFs.
