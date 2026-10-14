# Backup and privacy

How backups work, what they contain, and what Kwantflow does and does not do with your data.

## Back up and restore workspaces

A backup covers the installation's registered workspaces together. Restoring replaces the installation's local data; it does not merge one workspace into another.

### Local restore points

Settings > Backups lists local restore points and their dates, reasons, and app versions. Use **Back Up Now** before a large import, cleanup, or other change you may need to undo. Automatic weekly backups run while the app is open and suitable for a snapshot.

A backup on the same drive cannot protect against drive failure. Use a portable archive for a separate copy.

### Export a portable backup

1. Open Settings > Backups.
2. Choose **Export backup**.
3. Save the ZIP archive to another drive or copy it to another computer.
4. Keep the archive private: it contains your business records and customer documents.

The archive includes registered workspaces, local settings, databases, managed attachments, avatars, and workspace AI reference material. It excludes mailbox credentials and the separately installed large AI model and model caches. A backup is not an installer.

### Import and restore

1. Install a compatible Kwantflow version on the destination computer.
2. Open Settings > Backups and choose **Import backup**.
3. Select the archive and let the app validate it.
4. Review the restore point and workspace count.
5. Confirm only when you intend to replace **all workspaces on this installation**.
6. Allow the app to restart and inspect your restored work.

The importer checks the archive before replacement and prepares older supported databases separately. Validation or preparation failure leaves your current installation intact. Unsupported database versions stop with a repair message rather than resetting your data.

The app keeps recovery data while completing the replacement and checking the restored installation. An interrupted unfinished restore is recovered before workspaces reopen. Do not delete recovery files or force-close an active restore.

If damaged current data cannot be read into a validated safety backup, recovery preserves the original databases and their SQLite sidecar files in quarantine. Keep these raw originals and the recovery record; they may be needed to recover work.

After moving computers, reconnect Gmail or Outlook and download AI separately if needed. Cross-platform transfer between macOS and Windows is not yet fully tested; keep the original backup until the restored workspace is checked.

### Before restoring a local point

Check its date and all-workspace scope. Later changes will be replaced. Export the current installation first if you may need those changes again.

[Workspace and backup issues](11-troubleshooting.md#workspace-and-backup-issues) covers missing points, invalid archives, and interrupted recovery.

## Data and privacy

Kwantflow stores estimating work on your computer. There is no Kwantflow account, sign-in, licence key, subscription, trial, device limit, or workspace and RFQ quota, and the app sends no usage, incident, or subscription reports. Optional Gmail and Outlook access uses your own provider registration and is separate from Kwantflow.

### Local workspace data

Each workspace contains its RFQs, customer records, materials and rates, files, assets, takeoffs, estimates, quote revisions, reusable setup data, business settings, AI reference material, and remembered email RFQ detection results.

Switching workspaces changes the active business environment without merging its records into another. Check the workspace name before importing data or creating records.

### When internet is used

- Downloading the installer and optional AI model.
- Connecting, refreshing, receiving, or sending through optional Gmail and Outlook integrations.
- Opening an external link.

Core estimating, local file review, quote export, backups, and downloaded local AI do not require a company service. Provider or hosting outages can affect the optional internet actions.

### Connected email

[Email connections](09-email.md#connect-email) are workspace-specific. Provider registration settings belong to the local installation. Only connect a mailbox when you want the selected workspace to use it.

The initial RFQ detection decision uses message information and body text. Attachments are handled separately for RFQ intake. Review recipients, attachments, totals, and generated wording before sending.

Remote email images are blocked because loading them can reveal that a message was opened. Embedded raster images can still appear locally. Expand **Links in this email** beneath the message to review the actual destination before opening an external link.

Mailbox credentials use macOS Keychain or current-user Windows DPAPI. They are not included in portable backups. A local disconnect removes the stored connection; revoke the provider grant separately if you want to withdraw provider consent.

### What runs where

| Component | Where it runs or who controls it |
| --- | --- |
| Workspaces, estimating, quote totals, attachments, and backups | Your computer |
| Optional model and inference runtime | Your computer after model download |
| Optional Gmail or Outlook registration and consent | Your provider project or organisation |
| Mailbox service, internet access, policies, and any mailbox subscription | Google, Microsoft, and your organisation |

No self-hosted Kwantflow backend is required. Business rules and deterministic quote calculations run in the installed application. The provider settings configure Gmail and Outlook; they do not add arbitrary provider APIs, IMAP/SMTP servers, or an ERP connector.

### Local AI

After the model download, AI inference runs on your computer. The model uses active-workspace context for the task you request. AI output remains subject to review, deterministic calculations, and explicit approval for record proposals.

### Backups and diagnostics

[Portable archives](10-backup-and-privacy.md#back-up-and-restore-workspaces) contain business data across all registered workspaces, including customer files. Store them securely. Credentials and the downloaded AI model are excluded.

**Export diagnostic logs** saves a local redacted ZIP when you request it. It does not submit a report. Inspect any archive before sharing it yourself.

Follow your organisation's policies for confidential and personal information.

### Licence and maintenance

The desktop application is GPL-3.0-only. You may use it commercially, modify it, and distribute it under its licence. Distributed covered modifications must include corresponding source. Your customer files, RFQs, and quote documents do not become GPL-licensed because you use Kwantflow.

Dependencies retain their own licences. macOS and Windows system runtimes have separate vendor terms. The complete source for each release is the matching release tag of the GitHub repository, together with its build instructions, notices, and the hash-pinned third-party source inputs it references. Never redistribute credentials or signing keys.

Kwantflow is community maintained. Anyone can fork, improve, and redistribute it under the GPL-3.0 licence. Support is not guaranteed, and compatibility with future operating systems or email-provider policies is not guaranteed.

Each release bundles this manual, licence texts, and third-party notices.

## Related guides

- [Install another version](01-install.md#install-another-version)
- [Connect email](09-email.md#connect-email)
- [Workspace and backup issues](11-troubleshooting.md#workspace-and-backup-issues)
