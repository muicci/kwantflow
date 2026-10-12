# Branding Assets

`assets/brand` is the canonical source-of-truth for Kwantflow desktop branding.

The cross-platform desktop app-icon master lives at `assets/brand/kwantflow-app-icon.svg`.
The native macOS adaptive icon source lives at `assets/brand/macos/kwantflow.icon.xcassets`.

## Source Files

- `kwantflow-app-icon.svg`: desktop app-icon master composition (1024×1024)
- `kwantflow-logo-icon.svg`: clean icon-only SVG (122×122 original)
- `kwantflow-logo-text-icon.svg`: full logo with wordmark + icon (726×100 original)
- `kwantflow-logo-text.svg`: wordmark-only SVG (592×99 original)
- `kwantflow-source.svg`: app-icon with white background (for website/preserve contrast)
- `kwantflow-mark.svg`: transparent mark asset (same as app-icon)
- `kwantflow-logo-app-source.svg`: sidebar/app wordmark source
- `macos/kwantflow.icon.xcassets`: native macOS adaptive icon source compiled from Icon Composer exports

## Generated Outputs

- `assets/brand/kwantflow-app-icon.png`
- `static/favicon.png`
- `static/images/kwantflow-app-icon.png`
- `src-tauri/icons`
- `src/lib/assets/branding/kwantflow-logo-app.svg`
- `src/lib/assets/branding/kwantflow-sidebar-mark.svg`

## Regeneration

Run:

```bash
pnpm branding:regen
```

Before packaging a macOS app bundle, run:

```bash
pnpm branding:build:macos-icon-assets
```

If Finder or Dock still shows a stale icon after a branding change on macOS, run:

```bash
pnpm branding:refresh:macos
```

This regenerates the splash image, favicon, and the tracked Tauri icon bundle in `src-tauri/icons`.
The macOS asset-catalog step compiles `Assets.car` from
`assets/brand/macos/kwantflow.icon.xcassets`, keeps `CFBundleIconName` set to `AppIcon` for the
packaged app bundle, and refreshes the generated fallback `src-tauri/icons/icon.icns`.

The sidebar wordmark is kept as a separate runtime SVG under `src/lib/assets/branding` so app-shell
components can import it without depending on repo-root files.

The current desktop app icon pipeline uses the canonical SVG/PNG source for splash, favicon, and
tracked Tauri fallback icons in `src-tauri/icons`, plus the native macOS adaptive source in
`assets/brand/macos/kwantflow.icon.xcassets` for bundle packaging. If Finder or Dock still shows a
stale icon, prefer cache refresh and `Assets.car` regeneration rather than changing the source art
ad hoc.
The compact sidebar mark is also kept as a separate runtime SVG under `src/lib/assets/branding`
so shell chrome does not reuse the packaged desktop app icon.
