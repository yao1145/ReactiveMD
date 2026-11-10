# PRODUCT UI / PU-01 — Reactive MD theme

A warm product-interface design system that is now the built-in `default`
theme, and remains available here as a reference and mirror package. It
supplies a complete light and dark token contract and component styling for
overlays, forms, navigation, feedback, data and code surfaces.

The visual language is a modern product surface rather than a document skin:
warm off-white paper, white panels, near-black ink, one vivid blue accent, and
restrained elevation. Borders and shadows follow a surface budget: one border
per nesting level, one bordered content container (`.md-panel`), and shadows
only for floating layers. Geometry is rounded but not capsule-shaped — 8px
fields and controls, 10px buttons, 12px cards and 14px panels; pills are
reserved for badges and switches. Motion follows the motion-prompt `ui` pack:
short eased transitions, a dialog entrance from 96% scale, a popover from 98%,
220ms panels, 180ms toggles, a 160ms counter pop and a 1.08/1.15 range thumb.

**English** · [中文](README-ch.md) · [Design system specification](docs/design-system.md)

## What is included

| Asset | Path | Purpose |
| --- | --- | --- |
| Primitive, semantic and product tokens | `src/tokens.css` | Complete light and dark contract for every surface, state and component family |
| Overlay layer | `src/overlays.css` | Dialog, popover, menu and tooltip appearance and motion |
| Form layer | `src/forms.css` | Fields, selects, switches, checkboxes, radios, ranges and counters |
| Navigation layer | `src/navigation.css` | Tabs, steps, accordions and disclosure controls |
| Feedback layer | `src/feedback.css` | Badges, alerts, progress, validation and empty states |
| Document spacing layer | `src/spacing.css` | Section, block and inline rhythm for document content |
| Direct-import stylesheet | `src/product-ui.css` | Convenience entry that imports the six layers |
| Registered theme package | `src/theme.ts` | `defineLocalTheme` validation, scoping and frozen resources |
| Live gallery source | `demo/document.reactive.md` | A product document exercising every component family |
| Gallery host | `demo/main.tsx`, `demo/demo.css` | Reuses the same tokens outside the document root |
| Design specification | `docs/design-system.md` | Token tables, component and motion contracts |

`product-ui` is the visual language of the built-in `default` theme. Core
`reactive-md/styles.css` contains this layer, so a document with no `<theme>`
declaration, or with `<theme name="default">`, renders this appearance without
host registration.

This directory mirrors that layer as a standalone reference package. A host can
still register it under the explicit `product-ui` name, and a document can then
select it with `<theme name="product-ui">`. Every CSS rule is scoped to the
theme root, so the theme cannot restyle the host page or another document
instance.

The demo's `soft` mode is not built in. It is an external example theme, like the sci-fi example: the host registers
`{ name: 'soft', protocol: 'reactive-md-theme-1', colorSchemes: ['light', 'dark'] }`
in the `themes` prop, and the core baseline CSS in `reactive-md/styles.css`
supplies the original default appearance. A document selects it with
`<theme name="soft">` only when the host has registered that name.

## Quick start

The built-in default requires no theme registration:

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

<LocalReactiveDocument
  source={source}
  colorScheme="light"
  locale="en"
/>
```

```markdown
# Product workspace
```

Omitting the declaration selects `default`, and `<theme name="default">` is
equivalent.

### External soft example

To compare with the original appearance, register the example name and select
it in the source:

```tsx
import { LOCAL_THEME_PROTOCOL } from 'reactive-md';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const softTheme = {
  name: 'soft',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: ['light', 'dark'],
} as const;

<LocalReactiveDocument
  source={source}
  themes={[softTheme]}
  colorScheme="light"
  locale="en"
/>
```

```markdown
<theme name="soft">

# Product workspace
```

`soft` has no separate stylesheet. The core baseline CSS used by every document
provides the old look; registration only makes the name selectable. A standalone
definition package is available in [examples/soft-theme](../soft-theme/README.md).

### Explicit product-ui registration

The mirror package remains registerable under its own name:

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import { productUiTheme } from 'reactive-md-product-ui-theme';

<LocalReactiveDocument
  source={source}
  themes={[productUiTheme]}
  colorScheme="light"
  locale="en"
/>
```

```markdown
<theme name="product-ui">

# Product workspace
```

Or load the stylesheet directly when the host owns registration:

```ts
import 'reactive-md/styles.css';
import 'reactive-md-product-ui-theme/styles.css';
```

For the explicit route, `defineLocalTheme` rejects network resources and
host-global selectors and retargets every rule to
`[data-rmd-theme="product-ui"]`. The source CSS is authored against that scope,
so direct import and package registration produce the same result. The built-in
`default` layer uses the same rules under its own root.

## Token summary

| Layer | Examples |
| --- | --- |
| Primitive | `--pu-paper`, `--pu-blue-500`, `--pu-radius-lg` |
| Semantic | `--paper`, `--surface`, `--ink`, `--line`, `--accent`, `--accent-text`, `--focus`, `--chart-1` |
| Component | `--pu-focus-halo`, `--pu-segmented-track`, `--pu-chip-bg`, `--pu-rail-fill` |

Key contracts:

- Radius: `8px` fields and controls, `10px` buttons, `12px` cards, `14px` panels;
  `999px` only for badges and switches.
- Elevation: shadows are reserved for overlays and the optional demo document
  window; content surfaces use borders, dividers and background steps instead.
  Token values deepen in dark mode, but the usage budget does not change.
- Motion: `150 / 220 / 300ms` with `cubic-bezier(0.22, 0.61, 0.36, 1)`.
- Accent: one vivid blue; filled controls use `--accent-ink`.
- Both schemes define every semantic token; body ink and muted ink meet the
  contrast floors.

## Surface budget

Borders and shadows are spent deliberately so a document reads as one
workspace, not a stack of cards.

- One border per nesting level. The gallery's document window is the single
  strong window frame; content inside it does not repeat that frame.
- `.md-panel` is the one bordered content container. `.md-card` is a
  background-only metric tile: no border, no shadow.
- `.md-group`, checklist, multi-select, timer and quiz are not cards. They carry
  no outer border, background or shadow.
- Checklist and multi-select are list rows with visible checkboxes and row
  dividers, not chips or buttons.
- Disclosures and accordions are a divider list inside a container, not
  per-item cards. The open state uses accent text and an accent left rule
  instead of a filled header.
- Shadows belong to overlays: dialog, popover, menu and tooltip (plus the
  optional demo document window). Content surfaces do not use shadows.
- Controls keep the borders they need to be operable. Fields, toggle, range,
  segmented choices and buttons are controls, not cards.

Surface properties live in `src/feedback.css` (panel, card, group, checklist,
multi-select and data display), `src/navigation.css` (disclosure list) and
`src/forms.css` (controls). Core placement, sizing and base component behaviour
remain in `src/local/rendering/local.css`; the theme layers only appearance.
Timer and quiz inherit their base skin from the core layer, so the contract is
to remove their card frame rather than add one.

## Component coverage

| Family | Components |
| --- | --- |
| Structure | Document window (gallery host), panel, card (metric tile), group, empty state |
| Overlays | Native dialog, native popover, menu, tooltip |
| Forms | Input, textarea, number, select, range, switch, checkbox, radio, choices, counter |
| Selection | Checklist and multi-select, both list-style rows with visible checkboxes and dividers |
| Local components | Timer, quiz |
| Actions | Primary, secondary and quiet buttons |
| Navigation | Tabs, steps, accordion and disclosure (divider list), anchors |
| Feedback | Badges, alerts, progress, validation hints, error and empty states |
| Data | Markdown table, enhanced table, chart, plot, diagram, timeline |
| Code | Fenced code block, inline code, display math |

## Run the gallery

From the repository root:

```sh
npm run product:dev          # Vite dev server on http://127.0.0.1:4318
```

The gallery imports `reactive-md` through Vite aliases to the repository source,
so no package build is required while developing the theme. The top bar switches
between the built-in `default` (product UI) and the host-registered `soft`
example (original) as well as light and dark schemes. The equivalent direct
command is:

```sh
npx vite --config examples/product-ui-theme/vite.config.ts
```

## Design notes

- This product-UI language is the built-in `default`. The demo's `soft` mode is
  an externally registered example theme that keeps the original default
  appearance through the core baseline styles.
- The light scheme is a warm paper workspace; the dark scheme is a soft
  near-black product surface, not an inverted print page.
- Panels are the one bordered content container; cards are background-only
  metric tiles. Nested groups, selection lists and disclosures use dividers
  instead of another card frame. Real containers keep 12–14px corners; fields
  and buttons stay at 8–10px so dense product forms remain calm.
- Selected states use the accent, accent-soft fill and a visible focus halo.
  Status colours are semantic and never replace the accent as a highlight.
- Dialog and popover entrances are transform-based and short; reduced-motion
  users receive the end state without scale.
- Print removes host chrome and shadow, and keeps document content on the white
  surface.

## License

MIT, matching the repository.
