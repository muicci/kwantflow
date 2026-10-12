# Security policy

Kwantflow is a local desktop application. It has no servers or accounts. The main security
concerns are therefore:

- handling of untrusted files (DWG, DXF, STEP, PDF, images, email files);
- the Tauri command boundary and file-system path checks;
- storage of optional mailbox OAuth tokens (macOS Keychain / Windows DPAPI);
- the integrity of the downloaded AI model (SHA-256 pinned).

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use GitHub's
**private vulnerability reporting** (the **Security** tab, then **Report a vulnerability**) on this
repository. Include the affected version, your operating system, steps to reproduce and, if
possible, a sample file.

Kwantflow is community-maintained, so there is no guaranteed response time, but reports are
taken seriously and fixes are released as new versions.

## Supported versions

Only the latest release receives fixes.
