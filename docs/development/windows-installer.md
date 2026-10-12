# Windows installer and offline prerequisites

Kwantflow ships a per-user NSIS installer. Its PREINSTALL hook embeds
Microsoft's full Evergreen WebView2 standalone x64 setup, checks the runtime
registration, installs it offline when absent or incompatible, and checks the
registration again before copying the new application. A setup exit of zero
alone does not satisfy that check.

`tauri.windows.conf.json` deliberately sets Tauri's WebView install mode to
`skip`. This disables Tauri's built-in prerequisite section. It does not omit
WebView2: `windows-installer-hooks.nsh` embeds the pinned offline setup and owns
both fresh and upgrade handling. Do not set `minimumWebview2Version` in either
Tauri configuration; that would activate an earlier upstream online update path.

## Compatibility floor

The Windows runtime floor is **125.0.0.0**. The app uses matched PDF.js legacy main
and worker builds. Mozilla lists Chrome 125 as the legacy floor; this is stricter
than Tailwind 4's Chrome 111 and Vite 8's default Chrome/Edge 111 targets.
The floor is a compatibility threshold, not an instruction to freeze Microsoft
security updates. References: [PDF.js support](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions),
[Tailwind compatibility](https://tailwindcss.com/docs/compatibility),
[Vite build targets](https://vite.dev/guide/build).

These Windows requirements say nothing about macOS; the macOS deployment target
(12.0) is set separately in `tauri.conf.json`.

The hook accepts only canonical four-part decimal versions with components
bounded by 65535. Empty, malformed, leading-zero and `0.0.0.0` values do not pass.
It reads the Microsoft Clients GUID in HKLM's 32-bit view and HKCU. A valid but
stale machine registration must be repaired; a newer user registration cannot
bypass it. The Edge browser itself does not satisfy this prerequisite.

## Pinned inputs and template binding

`.github/windows-native-runtime-contract.json` records the exact Microsoft setup
URL, length and SHA-256, plus the reviewed Tauri CLI version and upstream template
commit/hash. The pinned setup is 214090448 bytes, SHA-256
`2a6add76c37bfa872eb8c2b22d45b3216b8e2a1f193e0774006340ff62ac5fa0`.
Its **Edge Update Setup FileVersion** is `1.3.275.13`. That is the installer's
version, not the deployed WebView2 runtime version.

The reviewed Tauri CLI is 2.11.4, source commit
`8909f221d1515955fc843808032bdc5d62209c96`, NSIS template SHA-256
`20f4ecc730defb71f1342eaeaec4021df13be3d843abba0effe88ea5835fa079`.
The template runs its WebView2 section before PREINSTALL and can use EdgeUpdate
online for a stale runtime. Its owned hook must run before application copying.
[Exact reviewed template](https://github.com/tauri-apps/tauri/blob/8909f221d1515955fc843808032bdc5d62209c96/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi).

`pnpm native:prepare` and the pre-bundle verification stage fail if the installed
CLI version changes, the reviewed template hash/order differs, the hook selection
changes, or the pinned prerequisite bytes fail verification. The template is
cached under `.cache/native-inputs` and the setup under the staged runtime's
`prerequisites` directory. Offline preparation requires those verified inputs
already present. Fresh source builders acquire them from their pinned public
URLs; no maintainer credential is needed.

Native Windows verification additionally requires the setup's exact FileVersion
and a valid Microsoft Authenticode signature. It records the signer identity,
certificate thumbprint, timestamp signer, setup digest and required runtime floor
in `windows-runtime-receipt.json`. The distribution manifest binds that receipt
by SHA-256. `pnpm distribution:verify <output-directory>` verifies installer and
receipt bytes. These checks verify the installer bytes, not the behaviour of an installed app.

## Scope, failure and restart

The app remains per-user. Microsoft documents that the runtime's installation
scope depends on elevation and an existing per-machine Edge Updater. A shared
runtime update can require administrator or organization approval. The installer
reports failures and stops; it does not download a bootstrapper, offer Ignore,
or report setup completion after a failed runtime postcheck.

WebView2 exit 3010 or 1641 stops before the new app is copied and asks for a Windows
restart followed by a fresh installer run. A required VC redistributable restart
also stops before setup completion and automatic launch, although app files may
already have been copied by that later hook. The installer does not force a reboot.
The upstream reinstall page can uninstall the previous application before either
hook runs in uninstall-first upgrade or MSI migration paths. This is not a
transactional rollback guarantee. Preserve a workspace backup before upgrading.
Uninstallation never removes Microsoft's shared runtimes.
[Microsoft deployment and elevation rules](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).

## Verification

Focused checks:

```sh
pnpm exec vitest run scripts/distribution.test.ts
pwsh -NoProfile -File scripts/verify-windows-runtime.test.ps1
```

PowerShell fixtures verify recursive imports, both staged DLL locations, pinned
hash rejection, read-only verification, invalid browser floors and CLI drift.
The hooks compile with NSIS 3.13, which proves hook syntax only.

Before publishing a Windows installer, test it on a clean Windows x64 machine
with the network disabled:

- WebView2 absent, older than 125, exactly 125 and current/newer; setup must succeed
  only with a compatible actual selected runtime and visible app startup.
- HKLM old plus HKCU new, HKLM new plus HKCU old, missing keys, malformed versions,
  `0.0.0.0`, and a registered runtime whose files are missing.
- App fresh install and upgrade, including uninstall-first and update paths.
- Runtime launch/extraction failures, denied elevation, organization policy,
  nonzero setup result and exit zero without a compatible postcheck.
- WebView2 and required VC reboot outcomes; no finish-page app launch or silent
  success until restart and successful rerun.
- Required VC runtime absent, current and newer; an unneeded VC runtime must not
  be installed. Verify final EXE-adjacent and resource DLL hashes.
- PDF main/worker rendering, CAD review, quote PDF export, backup/restore, optional
  Local AI and a second offline restart without any developer tools installed.

Static and compile checks on another platform do not replace that installed-app test.
