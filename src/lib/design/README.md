# Kwantflow Design System

Kwantflow uses a code-owned design system for a dense, restrained desktop product. The visual
direction is a Mac-native hybrid: calm shell chrome, strong hierarchy, and operational clarity
without copying literal native controls.

## Stack Boundary

- `Bits UI` is the behaviour and accessibility engine.
- `shadcn-svelte` is an upstream reference/bootstrap source, not the product design authority.
- Local files under `src/lib/components/ui/*` and `src/lib/components/primitives/*` are the owned
  source of truth for component APIs and styling.

## Layer Ownership

- `tokens/*.json`
  - canonical design-token registry in Git
  - primitive, semantic theme, semantic typography, shared layout, and owned component tokens
- `src/lib/design/generated/*`
  - generated CSS/TS artifacts built from the token registry
  - downstream only; do not edit by hand
- `tokens.css`
  - imports generated primitives
  - keeps Tailwind/runtime compatibility aliases stable
- `theme.css`
  - imports generated semantic light/dark modes
  - owns semantic utility helpers layered above those modes
- `typography.css`
  - semantic type roles only
  - consumes generated typography composites from the canonical token registry
- `motion.css`
  - shared transition utilities
  - reduced-motion-safe defaults
- `layout.css`
  - page rhythm, shell sizing, and primitive utility classes
  - consumes generated shared layout tokens from the canonical token registry
- `src/app.css`
  - imports and shell-level helpers only

The authority order is:

1. `tokens/*.json`
2. `src/lib/design/generated/*`
3. `src/lib/design/*.css`
4. `src/lib/components/primitives/*`
5. `src/lib/components/ui/*`
6. Storybook docs/stories

Storybook is a living documentation and verification surface. It is not a second value source.

Reusable content/copy patterns (labels, helper text, error rendering, metadata rows, and empty
states) are described in the UI conventions section of `ARCHITECTURE.md`.

## Live Typography Roles

The live type system is intentionally small and role-based:

- headings: `h3`, `h4`, `title-copy`
- forms and controls: `field-label`, `field-copy`, `field-help`, `control-copy`
- shell: `shell-label`, `shell-label-strong`, `shell-meta`, `tab-label`
- tables: `table-heading`, `table-copy`, `table-caption`
- support/meta: `small`, `muted`, `caption`, `badge-label`, `eyebrow`, `menu-copy`,
  `tooltip-copy`, `calendar-copy`, `calendar-caption`

Use these roles directly. Do not reintroduce retired generic prose roles such as `h1`, `h2`, `p`,
`lead`, `blockquote`, `list`, or `inline-code` in application code.

## Primitive Posture

Shared layout and surface primitives are preferred over local wrapper divs when building new
screens:

- `Stack`
- `Inline`
- `Cluster`
- `Box`
- `Surface`
- `Panel`
- `Inset`
- `Divider`
- `Heading`
- `Text`
- `Eyebrow`
- `Meta`
- `FieldShell`
- `FieldLabel`
- `FieldHelp`
- `FieldError`

These primitives exist to keep shell, table, and form rhythm consistent even when feature work is
new.

## Token Scope

The system owns reusable visual decisions:

- colour
- spacing
- radius
- sizing
- motion
- semantic text roles
- component defaults

Current component-token coverage includes:

- button
- input
- select
- badge
- dialog
- popover
- sidebar
- table
- empty state
- textarea
- dropdown menu
- tooltip
- sheet
- checkbox
- label
- avatar
- alert
- alert dialog
- calendar
- breadcrumb
- data table
- resizable panes
- scroll area
- separator
- skeleton
- sonner/toasts

Literal business strings do not become tokens by default. They remain content, but they must render
through owned primitives and owned component contracts.

## Radius And Shape Policy

Corner treatment is system-owned. Use the shared radius tokens and helpers instead of local
`rounded-*` drift:

- `ui-radius-tight`
  - compact shell controls, drag handles, dense toggles, and micro utility buttons
- `ui-radius-sm`
  - compact sidebar actions, dense utility chrome, and smaller secondary row controls
- `ui-radius-md`
  - standard panel, dialog, popover, table, card, and empty-state radius
- `ui-radius-lg`
  - standard buttons, field controls, and field-style picker triggers
- `ui-radius-pill`
  - circular or pill-shaped affordances only

Sharp versus rounded is a component decision, not a page-local preference. If a surface should
feel sharper or softer, change the owned component or primitive default rather than adding local
`rounded-*` overrides.

Round avatars, status dots, and pill badges should use `ui-radius-pill`. Standard buttons and field
controls should use `ui-radius-lg`. Panels, dialogs, popovers,
cards, and table shells should use `ui-radius-md` unless a deliberately softer oversized surface is
being introduced.

## Form/Dialog Recipe

The default form recipe for new dialog and panel work is:

- `FieldShell` for one field row
- `FieldLabel` for the semantic label
- owned field controls; text inputs, selects, and field-style picker triggers now share one 32px height
- `FieldError` for validation output
- `FieldHelp` for helper or pending-state guidance
- `Panel` for grouped settings/attachment/confirmation sections

Required-field validation should use the softer `invalidTone="neutral"` path. Destructive or
blocking validation should use `invalidTone="destructive"`. Avoid local `h-8`,
`border-destructive`, and hand-authored error-caption stacks in migrated form surfaces.

## Rules

- Use semantic typography classes and semantic colour tokens only.
- Use owned radius helpers and component defaults; avoid raw `rounded-*` classes in product code.
- Prefer fixing primitives and tokens over patching page-local styling.
- Keep `bits-ui` imports inside owned wrappers and controls, not product screens.
- Treat local components as editable product code, not vendor code.
