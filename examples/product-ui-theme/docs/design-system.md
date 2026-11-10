# PRODUCT UI / PU-01 — design system

**Status**: built-in `default` theme · reference/mirror package · version 1.0.0 · light and dark
**Host**: Reactive MD theme protocol `reactive-md-theme-1`
**Scope**: document components, host chrome, tokens and motion contracts

PU-01 is a warm product-interface language for working documents: a paper
workspace, white surfaces, near-black ink and one vivid blue accent. It is a
product UI, not a marketing page. Geometry is rounded but never capsule-shaped
except for badges and switches. Elevation is reserved for floating layers;
content follows a surface budget with one border per nesting level.

This language is the built-in `default` theme: a document with no `<theme>`
declaration, or with `<theme name="default">`, renders it without host
registration. The demo's `soft` mode is not built in; it is an external example
theme registered by the host, like the sci-fi example. Its name is registered in
the `themes` prop, and the core baseline CSS in `reactive-md/styles.css`
supplies the package's original default appearance. A document selects it with
`<theme name="soft">` only while that registration is present. This directory
mirrors the product-UI layer as a standalone package and can still be registered
explicitly as `product-ui`.

---

## 1. Intent

| Principle | Consequence |
| --- | --- |
| Calm surface | Warm paper and white/near-black panels carry the interface; colour is reserved for action and state. |
| One accent | A single blue family drives primary actions, selection, links and focus. Status colours stay semantic. |
| Rounded rectangles | 8px fields and controls, 10px buttons, 12px cards, 14px panels. Pills only for badges and switches. |
| Soft depth | One border per nesting level. Shadows belong to overlays and the optional demo window; content surfaces use rules, dividers and background steps. |
| Controls stay controls | Fields, toggles, ranges, segmented choices and buttons keep the borders they need; they are never promoted to cards. |
| Short motion | 150–300ms transitions with one shared easing curve; entrances use small scale changes rather than slides. |
| Readable density | 38px control height, 4px spacing unit, 15px body, tabular numerals. |

The references are modern product workspaces, settings surfaces and data tools —
not neon dashboards, terminal consoles or editorial print.

---

## 2. Token architecture

Three layers, one direction:

```
primitive (raw value)
    ↓
semantic (purpose; light + dark values)
    ↓
component (product controls, chrome and overlays)
```

| Layer | Prefix | Example |
| --- | --- | --- |
| Primitive | `--pu-*` | `--pu-paper`, `--pu-blue-500`, `--pu-radius-lg` |
| Semantic | shared contract | `--surface`, `--ink`, `--accent`, `--line` |
| Component | `--pu-*` | `--pu-focus-halo`, `--pu-segmented-track`, `--pu-rail-fill` |

Both scopes in `src/tokens.css` define every semantic token. The theme defines
the complete contract for both modes and never falls back to a partial palette
for a missing mode.

### 2.1 Semantic register

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page / paper | `--paper` | `#f5f3f1` | `#141517` |
| Document surface | `--surface` | `#ffffff` | `#1c1d20` |
| Subtle surface | `--surface-subtle` | `#faf9f7` | `#232428` |
| Hover surface | `--surface-hover` | `#f3f1ee` | `#2a2b30` |
| Active surface | `--surface-active` | `#ebe8e4` | `#32343a` |
| Primary ink | `--ink` | `#111111` | `#f4f2ef` |
| Secondary ink | `--ink-soft` | `#55524e` | `#c9c6c1` |
| Muted ink | `--ink-muted` | `#6f6c68` | `#9b9792` |
| Rule | `--line` | `#e6e4e3` | `#34363b` |
| Strong rule | `--line-strong` | `#d6d4d2` | `#4a4c52` |
| Accent fill | `--accent` | `#1f5ae8` | `#7aa2ff` |
| Accent hover | `--accent-hover` | `#1a4fd0` | `#9ab8ff` |
| Accent soft | `--accent-soft` | `#eef3fe` | `#1e2a44` |
| Accent line | `--accent-line` | `#cad9f9` | `#344a75` |
| Ink on accent | `--accent-ink` | `#ffffff` | `#0b1220` |
| Accent as text | `--accent-text` | `#1f5ae8` | `#9ab8ff` |
| Focus | `--focus` | `#1f5ae8` | `#9ab8ff` |
| Success | `--success` | `#18794e` | `#6fce9f` |
| Warning | `--warning` | `#9a6700` | `#e8b75a` |
| Danger | `--danger` | `#c4323f` | `#ff9aa5` |
| Code surface | `--code-bg` | `#ffffff` | `#17181b` |
| Code ink | `--code-ink` | `#253247` | `#e6e3de` |

`--ink-muted` in light mode is `#6f6c68`, chosen to clear the 4.5:1 contrast
floor against `--surface`. Do not replace it with a lighter decorative grey for
text that carries meaning.

### 2.2 Radius and elevation

| Token | Value | Use |
| --- | --- | --- |
| `--radius-field` / `--radius-control` | `8px` | Inputs, selects, shared controls |
| `--radius-field-multiline` | `14px` | Textareas and tall field surfaces |
| `--radius-card` | `12px` | Cards, popovers, menus, alerts |
| `--radius-panel` | `14px` | Panels, dialogs, framed surfaces |
| `--radius-pill` | `999px` | Badges and switches only |
| `--radius-sm` / `--radius-md` / `--radius-lg` | `8 / 12 / 14px` | Compatibility aliases |

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow-sm` | `0 1px 2px rgb(17 17 17 / 6%)` | `0 1px 2px rgb(0 0 0 / 30%)` |
| `--shadow-md` | `0 8px 24px rgb(17 17 17 / 10%)` | `0 8px 24px rgb(0 0 0 / 38%)` |
| `--pu-overlay-shadow` | `0 24px 64px rgb(17 17 17 / 18%)` | `0 24px 64px rgb(0 0 0 / 55%)` |

Explicit buttons target 10px radius in the form layer; shared controls keep 8px.
Do not turn fields or buttons into pills.

Shadow tokens exist for floating layers. Do not apply `--shadow-sm` or
`--shadow-md` to resting content surfaces; the optional demo document window is
the one place `--shadow-md` may appear around the document. Dialog, popover,
menu and tooltip use `--pu-overlay-shadow`.

### 2.3 Product component tokens

| Token | Light | Dark |
| --- | --- | --- |
| `--pu-focus-halo` | `0 0 0 3px rgb(31 90 232 / 16%)` | `0 0 0 3px rgb(122 162 255 / 22%)` |
| `--pu-segmented-track` | `#f0efed` | `#26282c` |
| `--pu-segmented-thumb` | `#ffffff` | `#3a3d43` |
| `--pu-chip-bg` | `#f7f6f4` | `#232428` |
| `--pu-chip-selected-bg` | `#eef3fe` | `#1e2a44` |
| `--pu-rail-track` | `#e6e4e3` | `#34363b` |
| `--pu-rail-fill` | `#1f5ae8` | `#7aa2ff` |

Charts use `--chart-1` through `--chart-8`; series 1 is the accent blue, and the
remaining series are warm, distinguishable hues. Grid lines use `--chart-grid`;
axis text uses `--chart-axis`.

---

## 3. Surface budget

Borders and shadows are budgeted so a document reads as one workspace, not a
stack of cards.

| Level | Surface | Border | Background | Shadow |
| --- | --- | --- | --- | --- |
| Window | Demo document window (`.pu-chassis`, host chrome) | 1px `--line`; the one strong window frame | `--surface` | Optional `--shadow-md` |
| Container | `.md-panel` | 1px `--line`; the one bordered content container | `--surface` | None |
| Metric tile | `.md-card` | None | Quiet background fill | None |
| Group | `.md-group` | None | None (transparent) | None |
| Selection list | `.local-checklist`, `.local-multi-select` | Row dividers only | Transparent | None |
| Disclosure list | `.local-accordion`, `.local-disclosure`, native `details` | Row dividers `--line`; optional container top rule | Transparent | None |
| Local block | `.local-timer`, `.local-quiz` | None | Transparent | None |
| Alert | `.md-alert` | 1px tone line plus 3px semantic left rule | Soft tone surface | None |
| Overlay | Dialog, popover, menu, tooltip | 1px `--line` | `--surface` | `--pu-overlay-shadow` |
| Control | Fields, toggle, range, segmented choices, buttons | Control border as required | Control surface | Focus halo only |

Rules:

1. One border per nesting level. The demo window is the one strong window
   border; a panel inside it may carry the one content border; cards, groups
   and lists inside that panel add no second frame.
2. `.md-panel` is the one bordered content container. `.md-card` is a
   background-only metric tile with no border and no shadow.
3. `.md-group`, checklist, multi-select, timer and quiz are not cards: no outer
   border, background or shadow.
4. Checklist and multi-select are list rows with visible checkboxes and row
   dividers, not chips or buttons. Selected rows use accent text and a quiet
   accent fill, not a raised control.
5. Disclosures and accordions are a divider list inside a container, not
   per-item cards. The open state uses accent text and an accent left rule
   instead of a filled header.
6. Shadows belong to overlays (dialog, popover, menu, tooltip) and optionally
   the demo document window. Content surfaces do not use shadows.
7. Controls keep the borders they need to be operable. A control is not a card,
   and a card is not a control.
8. Atomic content blocks (code, tables, inline code, alerts) keep the single
   hairline or semantic rule they need; they are not nested cards.

Surface properties live in `src/feedback.css` (panel, card, group, checklist,
multi-select and data display), `src/navigation.css` (disclosure list) and
`src/forms.css` (controls). Core placement, sizing and base component behaviour
remain in `src/local/rendering/local.css`; the theme layers only appearance.
Timer and quiz inherit their base skin from the core layer; the contract above
removes their card frame rather than adding one.

---

## 4. Motion contract

All motion uses `--ease-standard: cubic-bezier(0.22, 0.61, 0.36, 1)`. Durations
come from the motion-prompt `ui` pack.

| Surface | Entrance | Duration | Notes |
| --- | --- | --- | --- |
| Dialog | opacity + `scale(.96)` → 1 | 220ms (`--motion-base`) | Centre origin; backdrop fades with the dialog. |
| Popover | opacity + `scale(.98)` → 1 | 220ms (`--motion-base`) | Light, quick; exits in reverse. |
| Panel / disclosure body | opacity + short translate | 220ms (`--motion-base`) | No bounce; height changes stay clipped. |
| Toggle / switch | thumb position + track colour | 180ms | Thumb never overshoots the track. |
| Counter | `scale(1.08)` pop | 160ms | One pulse on value change, then settle. |
| Range thumb | `scale(1.08)` hover, `scale(1.15)` drag | 150ms | Track fill follows the value. |

Rules:

1. Transitions animate `transform`, `opacity`, `background-color`, `border-color`,
   `color` and `box-shadow`; never animate layout properties.
2. Entrances are short and reversible. A dialog that opens in 220ms closes in
   the same duration.
3. No infinite decorative animation. Loading indicators are the only exception.
4. Motion never carries meaning alone: state also changes colour, border, label
   or position.

---

## 5. Component contracts

### 5.1 Overlays

**Classes**: native `dialog[open]`, `[popover]:popover-open`, `.md-dialog`,
`.md-popover`, `.md-menu`, `.md-tooltip`

- Dialog: `--surface`, 1px `--line`, `--radius-panel`, `--pu-overlay-shadow`,
  `--space-5` padding. The backdrop is a dark translucent layer; the image-zoom
  dialog keeps its own frame and `--image-zoom-backdrop`.
- Popover and menu: `--surface`, 1px `--line`, `--radius-card`,
  `--pu-overlay-shadow`; menu items use `--radius-control`.
- Tooltip: a dark tooltip surface with light text; `--radius-control`.
- Focus: `--focus-outline` at 2px offset; the dialog itself never traps focus —
  native modal behaviour does.
- Entry motion: dialog 96% scale, popover 98% scale (section 4).

The overlay layer sets appearance only. The author owns open state, placement,
focus and keyboard behaviour.

### 5.2 Forms

**Classes**: `.md-field`, `.md-label`, `.md-hint`, `.md-error`, `.md-text-input`,
`.md-select-input`, `.md-switch`, native inputs inside `.md-document`

| Part | Contract |
| --- | --- |
| Field | 38px height, 8px radius, 1px `--line`, `--surface` fill |
| Hover | `--line-strong` or `--accent-line` stroke; no movement |
| Focus | `--accent` stroke plus `--pu-focus-halo` or `--focus-ring` |
| Invalid | `--danger` stroke; error text in `--danger` |
| Disabled | `--disabled-opacity`, not-allowed cursor |
| Textarea | 14px radius, 84px minimum height, vertical resize |
| Switch | Pill track (`--control-track`) with a `--control-thumb` thumb |
| Range | `--pu-rail-track` rail, `--pu-rail-fill` filled portion, accent thumb |
| Counter | 160ms value pop; controls are 8px rounded |

Labels are 11–12px, medium weight, `--ink-soft`; hints and errors use the same
scale in `--ink-muted` and `--danger` respectively.

Controls keep a field border because it is their affordance. Toggle tracks,
range rails, segmented tracks and counters use control geometry; none of them is
promoted to a card, and none carries a content-surface shadow.

### 5.3 Navigation

**Classes**: `.local-tablist`, `.local-tab`, `.local-steps`, `.local-accordion`,
`.local-disclosure`, `.md-disclosure`

- Tabs: segmented track `--pu-segmented-track`, selected thumb
  `--pu-segmented-thumb`, 8px radius. The selected label uses `--ink`; idle
  labels use `--ink-muted`.
- Steps: numbered markers use `--accent` for the current step, `--success` for
  complete steps and `--line-strong` for upcoming steps.
- Accordion and disclosure: a divider list inside a container, not per-item
  cards. Rows stay transparent and are separated by 1px `--line`; the container
  carries only its top rule. The open state uses `--accent-text` and an accent
  left rule, not a filled header, and the body stays transparent.
- Focus: `--focus-outline` at 2px offset on every interactive element.

### 5.4 Feedback

**Classes**: `.md-badge`, `.md-alert`, `.md-progress`, `.local-validation-hint`,
`.local-checklist`, `.local-multi-select`

- Badges: pill radius, 10–11px semibold uppercase, `--pu-chip-bg` base.
  Tones use the soft status surface plus the status line and text colour.
- Alerts: 12px radius, 1px tone line, soft tone surface, 3px semantic left rule.
  An alert is a semantic callout, not a card.
- Progress: 8px rail (`--pu-rail-track`) with `--pu-rail-fill`; value text is
  tabular and muted.
- Checklist and multi-select: list-style selections, not chips or buttons. Each
  row shows a visible checkbox and is separated by a row divider; the container
  adds no outer frame or shadow. Selected rows use `--accent-text` with a quiet
  accent fill.
- Validation hints sit directly below the field and never shift layout on focus.

### 5.5 Document and host chrome

- Document: warm `--paper` page, `--surface` document body, `--ink` prose.
- Headings use `--ink`; body copy uses `--ink`; metadata uses `--ink-muted`.
- Links use `--accent-text` with an underline on hover, never a filled pill.
- Code blocks use `--code-bg` in both schemes with `--code-ink` and syntax tokens
  adjusted for each mode.
- Tables use `--surface`, `--line` rules, `--surface-hover` row hover and
  `--accent-soft` selection.
- The demo host draws the one strong window frame: `.pu-chassis`, 1px `--line`,
  `--radius-panel`, optionally `--shadow-md`. The document inside the window
  adds no second frame.

### 5.6 Selection and local blocks

**Classes**: `.local-checklist`, `.local-checklist-item`, `.local-multi-select`,
`.local-multi-option`, `.local-timer`, `.local-quiz`

- Checklist: list rows with a visible checkbox and a row divider. The group and
  its rows carry no outer border, card background or shadow.
- Multi-select: the same list-row contract. The option list scrolls; selection
  is shown by the checkbox, accent text and a quiet accent fill on the row.
- Timer: a local block with a tabular value and inline controls. It is not a
  card and adds no outer frame.
- Quiz: question, options and actions sit directly in the document flow. The
  feedback line uses semantic status colour; the explanation uses a quiet fill,
  not a card.
- These blocks may use `--surface-subtle` for an inset explanation or a
  disabled fill, but not for a raised panel.

---

## 6. Light and dark rules

- Both scopes define the full semantic contract. A mode is not an inverted
  version of the other.
- Light: paper `#f5f3f1`, surface `#ffffff`, ink `#111111`, accent fill
  `#1f5ae8` with white ink.
- Dark: paper `#141517`, surface `#1c1d20`, ink `#f4f2ef`, accent fill
  `#7aa2ff` with near-black ink `#0b1220`. The lighter blue keeps filled
  controls legible without glare.
- Dark borders stay visible (`#34363b` / `#4a4c52`); never use pure black as a
  surface or pure white as text.
- Status colours are re-tuned per mode for contrast, not reused verbatim.
- Selection is never expressed by colour alone: it also changes stroke, fill
  step, inset line or label weight.

Contrast floors: body ink ≥ 7:1, secondary and muted text ≥ 4.5:1, accent ink on
accent ≥ 4.5:1, accent text on surface ≥ 4.5:1, status text ≥ 4.5:1.

---

## 7. Reduced motion and print

**Reduced motion** (`prefers-reduced-motion: reduce`):

- Transitions and animations are reduced to their end state; no scale, pop or
  translate entrance is played.
- Dialog and popover still appear and disappear, without opacity or transform
  animation.
- Counter pops and range-thumb scaling are disabled.
- Focus rings, selected states and layout remain identical.

**Print**:

- Host chrome, side rails and window bars are removed.
- Shadows are removed; borders fall back to `--line` on a white page.
- Overlay content prints statically when open, avoids page breaks, and never
  prints a backdrop.
- Code and tables keep their text contrast and hairline rules; syntax colour may
  be reduced to ink where a printer cannot reproduce it.
- Reduced motion is implicit in print; no transitions run.

---

## 8. Usage

### Built-in default

The product-UI layer is the built-in `default`, so no registration is needed:

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

<LocalReactiveDocument source={source} colorScheme="light" locale="en" />
```

Omitting a declaration selects it; `<theme name="default">` is equivalent.

### External soft example

`soft` is an external example theme, registered like any host theme. It has no
stylesheet: the core baseline CSS supplies the original appearance. A standalone
definition package is in [examples/soft-theme](../../soft-theme/README.md).

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

### Explicit product-ui registration

The mirror package can also be registered under its own name:

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

# Title
```

### Direct CSS

```ts
import 'reactive-md/styles.css';
import 'reactive-md-product-ui-theme/styles.css';
```

### Theme package

`src/theme.ts` runs the six resources through `defineLocalTheme` in order:
`tokens.css`, `overlays.css`, `forms.css`, `navigation.css`, `feedback.css`,
`spacing.css`. The validated package scopes every rule to
`[data-rmd-theme="product-ui"]` and freezes the resources for export and SSR
pipelines. `src/product-ui.css` is a direct-import convenience file and is not
passed to `defineLocalTheme`.

---

## 9. Do and do not

| Do | Do not |
| --- | --- |
| Keep one accent action per surface | Fill every selected element with accent |
| Use 8–14px rounded rectangles | Turn fields or buttons into pills |
| Keep one border per nesting level | Frame every group, checklist and disclosure as a card |
| Let checklist and multi-select read as list rows | Turn list rows into chips or buttons |
| Use shadows only for overlays and the optional demo window | Shadow resting content surfaces |
| Keep borders on controls | Promote a control to a card |
| Use `--pu-focus-halo` with a visible outline | Remove focus rings |
| Use semantic tokens in component CSS | Hard-code hex values in component rules |
| Keep motion under 300ms | Add bounce, spring or infinite decoration |
| Verify both schemes | Treat dark mode as an inverted light page |
