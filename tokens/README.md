## Kwantflow Token Registry

This directory is the canonical design-token registry for the desktop app.

Rules:

- Edit token values here first.
- Run `pnpm design:build` after changes.
- Generated artifacts under `src/lib/design/generated/` are downstream outputs, not the source of truth.
- Figma and Storybook should consume this registry, not invent parallel values.

Current scope is intentionally narrow:

- primitive colour, spacing, radius, sizing, and motion values already used by the app
- semantic typography composites for owned text roles
- shared layout and shell sizing contracts
- semantic light/dark theme mappings already used by the app
- component-token mappings for owned shared wrappers and shell chrome

This registry does not yet attempt full product copy tokenisation or partner-brand modes.
