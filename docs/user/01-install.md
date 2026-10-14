# Install Kwantflow

Kwantflow is free, open source estimating software for macOS and Windows. This page covers downloading, installing, and replacing the app with a newer version.

## Download and install

Kwantflow is free, open source software. Download installers from the Releases page of the project's GitHub repository, or build from source.

### Choose your download

Download the macOS `.dmg` or Windows x64 `-setup.exe` installer from the GitHub Releases page of the project repository. Each release lists SHA-256 checksums. Downloads require no account or registration. The source archive is for developers; it is not the installer.

Kwantflow runs on macOS 12 or later (Apple Silicon and Intel) and Windows 10 or 11 x64. 8 GB of memory is the minimum; 16 GB is recommended if you plan to use Local AI.

The packaged app includes its required native libraries. You do not need developer tools, containers, or a database server. Local AI is a separate optional download of approximately 3.7 GB.

### Install on macOS

1. Download the universal `.dmg` for Apple Silicon and Intel Macs.
2. Open the DMG.
3. Drag **Kwantflow** into **Applications**.
4. Open Kwantflow from Applications.

Community builds may be unsigned or ad hoc signed, so macOS may ask you to confirm opening the app from System Settings > Privacy & Security. If macOS reports a damaged application, an invalid signature, or a security block, stop and use [the installation troubleshooting guide](11-troubleshooting.md#install-and-update-issues).

### Install on Windows

1. Download the Windows x64 `-setup.exe` installer.
2. Run the installer and follow its prompts.
3. Open Kwantflow from the Start menu or installed shortcut.

The Windows installer is unsigned. SmartScreen, Smart App Control, S mode, or your organisation's policy may warn or block it. A checksum establishes the downloaded file's identity; it does not create trusted-publisher status. Do not disable security protections to bypass a block.

The installer includes the offline WebView2 prerequisite and required native libraries. If an absent Microsoft system prerequisite requires administrator approval or a restart, the installer explains that step. Local AI setup requires internet separately.

### First launch

Create a local workspace and enter your business details. Setup import and AI installation can be skipped.

[First-time setup](02-quickstart.md#first-time-setup) explains the required local fields and optional setup steps.

## Install another version

Kwantflow does not check for updates automatically. Download newer versions from the project's GitHub Releases page when you choose to update.

### Before replacing the app

1. Save your work.
2. [Export a backup](10-backup-and-privacy.md#back-up-and-restore-workspaces) and keep it outside the installation's drive.
3. Check the new release's source, licence, supported systems, upgrade notes, and maintainer identity.
4. Quit every Kwantflow instance and background process before running the installer. For the first upgrade from 0.12.x, confirm that no legacy Kwantflow process is still running before opening the new version.

Install the replacement application without deleting workspace data. The first upgrade from 0.12.2 moves the supported databases from v1 to v2, removes commercial records, and preserves local business data. An old process must not reopen a database after it has been upgraded.

### After installation

Check each workspace's RFQs, attachments, estimates, quote revisions, setup records, and business details. Reconnect email using your own provider registration when prompted.

Do not open an upgraded database with an older app version. If you need to return to an older version, use a compatible backup and its matching app version deliberately; replacing only the binary is not a data rollback.

Kwantflow is community maintained, so compatibility with future operating-system and email-provider changes is not guaranteed. [Install and update issues](11-troubleshooting.md#install-and-update-issues) covers download, launch, and upgrade failures.

## Related guides

- [Quickstart](02-quickstart.md#quickstart-in-six-steps)
- [Back up and restore workspaces](10-backup-and-privacy.md#back-up-and-restore-workspaces)
- [Install and update issues](11-troubleshooting.md#install-and-update-issues)
