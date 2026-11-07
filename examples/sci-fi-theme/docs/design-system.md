# SCI-FI / SF-01 — design system

**English** · [中文](design-system-ch.md)

**Status**: reference theme package · version 1.0.0 · both colour schemes
**Host**: Reactive MD theme protocol `reactive-md-theme-1`
**Scope**: document components, host chrome, tokens and component contracts

SF-01 is a hard-sci-fi interface language for technical documents and control
surfaces. It is cold, rectilinear and engineered: strong grids, exposed rules,
mono machine labels and a small number of cold signal colours. It is not a
consumer theme with darker colours; soft depth, rounded geometry and decorative
gradients are deliberately excluded.

---

## 1. Intent

| Principle | Consequence |
| --- | --- |
| Signal before chrome | State is carried by stroke, a 2px signal line and a label, not by shadow or colour wash. |
| Rectilinear | All component geometry is 0–4px radius. Pills are removed at the token level. |
| Modular | Panels, cards and chart frames are separate modules with 1px borders and shared edges. |
| Engineered density | 4px spacing unit, 34px control height, 10.5–12px machine labels. |
| Cold, not neon | One cyan family is the accent. Violet, amber and red are status only. |
| Machine voice | Machine text — labels, metadata, values, navigation — is mono and uppercase. Prose stays sans. |
| Flat | Elevation is a ring, never a blurred drop shadow. |

The intended references are industrial terminals, tactical consoles, spacecraft
telemetry panels and test equipment — not entertainment holograms.

---

## 2. Token architecture

Three layers, one direction:

```
primitive (raw value)
    ↓
semantic (purpose; light + dark values)
    ↓
component (panel, table, field, nav, chart)
```

Components consume semantic and component tokens. Primitive tokens are never
used directly in component rules.

| Layer | Prefix | Example | Owner |
| --- | --- | --- | --- |
| Primitive | `--sf-*` | `--sf-cyan-700`, `--sf-radius-1` | `src/tokens.css` |
| Semantic | shared contract | `--surface`, `--ink`, `--accent`, `--line` | `src/tokens.css` |
| Component | `--sf-*` | `--sf-panel-head-bg`, `--sf-field-border` | `src/tokens.css` |

The shared semantic names are the published Reactive MD theme contract; a host
that already understands `--surface`/`--ink`/`--accent` needs no new wiring.
`--sf-*` component tokens exist so panel, table, field, navigation and chart
surfaces can be retuned without touching component CSS.

### 2.1 Primitive register

| Family | Values |
| --- | --- |
| Neutral | `--sf-neutral-0` `#ffffff` → `--sf-neutral-1000` `#05090d` (13 steps) |
| Signal | `--sf-cyan-100` `#d8f5fc` → `--sf-cyan-900` `#0d4557` |
| Status | teal, amber, red and violet ramps for success, warning, danger and a secondary series |
| Geometry | `--sf-unit: 4px`, `--sf-radius-0/1/2: 0/2/4px`, `--sf-hairline: 1px`, `--sf-rule: 2px` |
| Type | `--sf-type-micro: 10.5px`, `--sf-type-label: 11.5px`, `--sf-type-body: 15px`, `--sf-type-title: 20px`, `--sf-type-display: 30px` |
| Tracking | `--sf-track-micro: 0.16em`, `--sf-track-label: 0.1em`, `--sf-track-title: 0.02em` |
| Motion | `--sf-duration-1/2/3: 80/120/180ms`, `--sf-ease: cubic-bezier(0.2, 0, 0, 1)` |

### 2.2 Semantic contract

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page / paper | `--paper` | `#e8edf1` | `#070b10` |
| Document surface | `--surface` | `#f7f9fb` | `#0b1118` |
| Subtle surface | `--surface-subtle` | `#eef2f5` | `#0e1620` |
| Hover surface | `--surface-hover` | `#e6ecf1` | `#111c28` |
| Active surface | `--surface-active` | `#dde5ec` | `#16232f` |
| Primary ink | `--ink` | `#0a121a` | `#e5edf4` |
| Secondary ink | `--ink-soft` | `#354555` | `#a8b9c8` |
| Muted ink | `--ink-muted` | `#5f7183` | `#74889a` |
| Rule | `--line` | `#ccd6df` | `#1f2c3a` |
| Strong rule | `--line-strong` | `#a7b5c2` | `#32475c` |
| Accent fill | `--accent` | `#096b87` | `#17c3e6` |
| Accent hover | `--accent-hover` | `#075a72` | `#45d6f2` |
| Accent soft | `--accent-soft` | `#e1f2f7` | `#072231` |
| Accent on surface | `--accent-text` | `#055f79` | `#5fdcf5` |
| Ink on accent | `--accent-ink` | `#ffffff` | `#03161c` |
| Success | `--success` | `#076b4f` | `#3ddc97` |
| Warning | `--warning` | `#8a5a00` | `#f4b942` |
| Danger | `--danger` | `#b0253b` | `#ff6b81` |
| Code surface | `--code-bg` | `#0a1017` | `#05090e` |
| Code ink | `--code-ink` | `#dce8f4` | `#dce8f4` |

Light mode is a cold paper console; dark mode is the primary instrument mode.
Code blocks remain dark in light mode as a deliberate terminal module.

### 2.3 Component register

| Component | Tokens |
| --- | --- |
| Panel | `--sf-panel-bg`, `--sf-panel-head-bg`, `--sf-panel-border`, `--sf-panel-rule`, `--sf-corner-ink` |
| Table | `--sf-table-bg`, `--sf-table-head-bg`, `--sf-table-row-hover`, `--sf-table-row-selected` |
| Field | `--sf-field-bg`, `--sf-field-border`, `--sf-field-hover`, `--sf-label-ink` |
| Navigation | `--sf-nav-bg`, `--sf-nav-active-bg`, `--sf-signal-ink` |
| Chart frame | `--sf-chart-frame`, `--sf-chart-head`, `--chart-grid`, `--chart-axis` |
| Focus | `--sf-glow`, `--focus-outline`, `--focus-ring` |
| Disabled | `--sf-hatch`, `--disabled-opacity` |

---

## 3. Colour rules

- **Accent is signal, not decoration.** Use it for one primary action, the
  current navigation item, focus, progress and chart emphasis. A panel does not
  get an accent background merely because it is important.
- **Filled accent is for actions and selection.** Body text uses
  `--accent-text`, never the fill colour.
- **Status colours are semantic.** Success, warning and danger never replace the
  accent as a general highlight.
- **Colour is never the only state cue.** Every state also changes stroke,
  inset signal line, label, hatch or position.
- **Charts use the cold series palette.** Series 1–8 are separated by hue and
  luminance; grid lines stay one step above the surface.

Contrast floors are asserted in `tests/sci-fi-theme.test.ts`: body ink ≥ 7:1,
secondary/muted text ≥ 4.5:1, accent ink on accent ≥ 4.5:1, accent text on
surface ≥ 4.5:1, status text ≥ 4.5:1, chart series ≥ 3:1.

---

## 4. Typography

| Role | Token | Size | Weight | Case | Face |
| --- | --- | --- | --- | --- | --- |
| Document title | `--text-2xl` | 28px (mobile 24px) | 650 | Uppercase | Sans |
| Section title | `--text-xl` | 21px | 700 | Uppercase | Sans |
| Subsection | `--sf-type-label` | 11.5px | 600 | Uppercase | Mono |
| Body | `--text-md` | 15px | 400 | Sentence | Sans |
| Small body | `--text-sm` | 13px | 400 | Sentence | Sans |
| Micro / metadata | `--sf-type-micro` | 10.5px | 600 | Uppercase | Mono |
| Field value | `--text-sm` | 13px | 400 | As entered | Mono |
| Code | `--text-sm` | 13px | 400 | As written | Mono |

Rules:

1. Uppercase and tracking are reserved for machine labels, navigation and
   metadata. Paragraphs are never uppercased.
2. Numeric data uses tabular figures.
3. Labels carry `0.16em` tracking; values carry none.
4. Do not introduce a fourth typeface. The system is one sans plus one mono.
5. Chinese prose uses the same sans stack; uppercase rules are inert on Han
   characters and must not be relied on for meaning.

Line height: `1.15` display, `1.4` labels, `1.7` prose.

---

## 5. Grid, spacing, border, elevation

| Property | Contract |
| --- | --- |
| Base unit | 4px |
| Spacing | `4 / 8 / 12 / 16 / 24 / 32 / 48` |
| Document width | 880px, centred |
| Document padding | 32px desktop, 12–16px mobile |
| Background grid | 48px desktop, 32px mobile, 3–5% ink |
| Component grid | 1px gutters that render as shared rules |
| Column model | 12 columns, 16px gutter |
| Border | 1px structural; 2px signal (left edge, active tab, focus) |
| Radius | 0 default; 2px only for inline code or micro marks; 4px maximum |
| Elevation | `--shadow-*` are 1px rings; no blur shadows |
| Focus | 2px outline at 2px offset plus `--sf-glow` on fields |

Panels, cards, tables and chart frames share edges. Do not nest a bordered
module inside another bordered module without increasing the inner surface
tone; depth comes from the surface step, not from a shadow.

---

## 6. Component contracts

The contract column names the Reactive MD classes the theme styles. Hosts that
use the token layer outside a document can reproduce the same anatomy with
their own class names.

### 6.1 Document surface

**Classes**: `.md-document`, `.local-document`

- 880px maximum width, 1px frame, 2px accent top rail, faint 48px grid.
- Headings: `h1` uppercase with a 72px accent underline; `h2` with a 2px accent
  left rule; `h3` and below become mono uppercase labels.
- Blockquote: 1px frame, 2px accent left rule, subtle surface.
- Rules: 1px strong line with a 7px accent square at the left.
- Lists: square accent markers; ordered list numerals in mono.

### 6.2 Panel

**Classes**: `.local-panel`, `.local-panel-head`, `.local-panel-title`, `.local-panel-body`

| Part | Specification |
| --- | --- |
| Frame | 1px `--sf-panel-border`; square; no shadow |
| Corner ticks | 8px accent L-marks at top-left and bottom-right |
| Header | `--sf-panel-head-bg`, 1px bottom rule, 8px vertical padding |
| Title | 11.5px mono, uppercase, 600, 0.16em tracking, 6px accent square before the label |
| Reset | 28px quiet button, 1px border, 10px uppercase mono |
| Body | 12px top / 16px side / 16px bottom padding |

States: header hover does not change; reset hover adopts the accent stroke;
disabled reset uses hatch and 38% opacity.

### 6.3 Card and grid matrix

**Classes**: `.md-card`, `.md-card-title`, `.md-card-body`, `.local-grid`, `.local-card`

- Card: 1px rule, surface fill, no radius, header strip + body.
- Card title: 10.5px mono uppercase header on `--sf-panel-head-bg`.
- Grid: 1px gutters with the rule colour as the grid background; children are
  cards with no additional border. Maximum four columns.
- Grid cards stretch to equal height within a row.

### 6.4 Table

**Classes**: `.md-table-scroll`, `.md-table`, `.local-visual-table*`

| Part | Specification |
| --- | --- |
| Frame | 1px strong rule around the scroll area |
| Cells | 1px all-round rules; 8px × 12px padding |
| Header | `--sf-table-head-bg`; 10.5px mono uppercase; 0.1em tracking |
| Body | 13px; tabular numerals; even-row tint |
| Hover | One step lighter surface |
| Selected row | Accent soft fill plus 2px inset accent left bar |
| Sort | Mono uppercase button; active sort uses accent text and underline |
| Pagination | 1px framed square buttons; mono uppercase status line above a 1px rule |

Do not use vertical centring for prose cells; keep `vertical-align: top`.

### 6.5 Form field

**Classes**: `.md-control`, `.md-label`, `.md-hint`, `.local-validation-hint`

- Label: 10.5px mono uppercase, `--sf-label-ink`, 0.16em tracking.
- Gap between label and control: 4px.
- Hint: 10.5px mono, muted, 1.4 line height.
- Field error: danger border plus 1px inset danger line; the error text uses the
  danger colour but keeps the mono hint scale.

### 6.6 Text input, select, textarea

**Classes**: `.md-text-input`, `.md-select-input`

| State | Stroke | Fill | Other |
| --- | --- | --- | --- |
| Default | 1px `--sf-field-border` | `--sf-field-bg` | 34px height, 8px side padding |
| Hover | 1px `--sf-field-hover` | unchanged | No movement |
| Focus | 1px accent + 2px outline | unchanged | `--sf-glow` outer ring |
| Invalid | 1px danger + inset danger | unchanged | `aria-invalid="true"` |
| Disabled | 1px `--line` | 45° hatch | 38% opacity, not-allowed |

Text is 13px mono. Textarea minimum height 84px, vertical resize only. Select
keeps the native picker; its shell follows the field contract.

### 6.7 Range slider

**Classes**: `.md-slider input[type="range"]`, `.local-range-input`

- 4px rail with a 1px strong border; square 14px thumb in accent with a 2px
  surface ring.
- Value readout: framed mono box, right-aligned, 11.5px, accent text.
- Focus: 2px outline at 2px offset.
- Disabled: 38% opacity.

### 6.8 Checkbox, radio and choice cards

**Classes**: `.md-toggle-label`, `.local-checklist-item`, `.local-multi-option`,
`.local-radio-option`, `.local-choice`

- Selection marks are 16px squares. Checked boxes fill with accent and draw an
  accent-ink tick; checked radios fill with accent and a centred accent-ink
  square. Light and dark use separate tick glyph colours.
- Checklist containers and radio groups use a 1px frame and surface fill.
- Choice cards are rectangular; selected cards use accent-soft fill, accent
  stroke and a 2px inset left signal line.
- Hover is a stroke change only; no lift.

### 6.9 Button

**Classes**: `.md-button`, `.md-button-primary`, `.md-button-secondary`, `.md-button-quiet`

| Variant | Fill | Stroke | Text |
| --- | --- | --- | --- |
| Primary | Accent | Accent | Accent ink |
| Secondary | Surface | 1px strong | Ink |
| Quiet | Transparent | Transparent | Muted ink |

All buttons: 34px height, square, 11.5px mono uppercase, 0.1em tracking.
Hover adopts an accent stroke; active adds a 1px inset accent line; disabled
uses hatch plus 38% opacity. Focus is a 2px outline at 2px offset.

### 6.10 Tabs

**Classes**: `.local-tablist`, `.local-tab`, `.local-tabpanel`

- Equal-width segments in a 1px framed rail; 1px seams between tabs.
- Tab: 34px height, 10.5px mono uppercase, muted ink.
- Selected: accent-soft fill, accent text, 2px inset top signal line.
- Focus: 2px outline inset by 2px.
- Panel: 1px frame, no top border, surface fill.

### 6.11 Steps and accordion

**Classes**: `.local-steps*`, `.local-disclosure*`

- Steps: framed strip with 1px seams; previous/next are secondary buttons;
  the status line is mono uppercase and tabular.
- Disclosure: 1px rows sharing edges; trigger is 11.5px mono uppercase.
- Expanded disclosure: accent-soft fill, accent text, 2px inset left signal.
- Panel body is separated by a 1px rule.

### 6.12 Badge, alert, progress

**Classes**: `.md-badge*`, `.local-alert*`, `.local-progress*`

- Badge: square, 10.5px mono uppercase, 1px border, 2px × 8px padding. Tone is
  expressed by border and text colour, not by a solid fill.
- Alert: 1px frame, 2px left rule in the tone colour, surface fill. Title is
  11.5px mono uppercase in the tone colour.
- Progress: 10px framed track; fill is an 8px repeating accent stripe. Value is
  mono uppercase.

### 6.13 Chart container

**Classes**: `.local-visual`, `.local-visual-chart`, `.local-visual-plot`,
`.local-visual-diagram`, `.local-visual-timeline`, `.local-visual-table*`

- Frame: 1px strong rule, surface fill, 8px accent corner mark at bottom-right.
- Header: title becomes a 10.5px mono uppercase strip above a 1px rule.
- Chart text: mono; axis labels 10px uppercase; axis titles 10.5px uppercase.
- Grid: 1px chart-grid lines at 55% opacity; zero line dashed.
- Marks: bars are crisp rectangles; diagram nodes are forced to `rx: 0`;
  node labels are mono uppercase.
- Legends use square swatches and mono uppercase labels.
- Readout/help text is mono micro and muted.
- Interactive controls inside the frame (search, sort, pagination) follow the
  field/navigation contracts.

### 6.14 Code and math

**Classes**: `.md-code`, `.md-code-block*`, `.local-math-display`

- Code is a dark terminal module in both schemes: 1px ink-mixed frame, 34px
  toolbar, mono uppercase language label prefixed with a diamond, square copy
  control.
- Display math sits between 1px rules; formula ink follows the active scheme.
- Inline code is a 1px framed mono chip in accent text.

---

## 7. State encoding

| State | Stroke | Fill | Signal |
| --- | --- | --- | --- |
| Default | 1px line / line-strong | Surface | None |
| Hover | Accent stroke | One step lighter | None |
| Focus | 2px accent outline (2px offset) | Unchanged | Optional 3px glow |
| Selected / current | Accent stroke | Accent soft | 2px inset left or top line |
| Active / pressed | Accent stroke | Surface active | 1px inset accent |
| Disabled | Line | 45° hatch | 38% opacity |
| Error | Danger stroke + inset | Unchanged | Danger text |
| Success | Success stroke | Success soft | Success label |

No state relies on a drop shadow. No state relies on colour alone.

---

## 8. Accessibility

- AA contrast floors are part of the test suite, not an intention.
- Keyboard focus is always visible; focus rings are never removed.
- Selected tabs, steps and disclosures expose `aria-selected`/`aria-expanded`
  from the renderer and are reinforced visually.
- At 390px the document becomes edge-to-edge; controls keep 34px target
  height, tables scroll horizontally, and the 12-column matrix collapses.
- `prefers-reduced-motion` removes transitions.
- Uppercase is only applied to labels, never to body prose. Chinese text is
  unaffected by `text-transform` and must remain readable without tracking.
- Status is never conveyed by hue alone: tone also changes the border, label
  and left rule.

---

## 9. Usage

### Direct CSS

```ts
import 'reactive-md/styles.css';
import 'reactive-md-sci-fi-theme/styles.css';
```

### Registered theme

```tsx
import { LOCAL_THEME_PROTOCOL } from 'reactive-md';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './tokens.css';
import './components.css';

const sciFi = {
  name: 'sci-fi',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: ['light', 'dark'],
} as const;

<LocalReactiveDocument
  source={source}
  themes={[sciFi]}
  colorScheme="dark"
/>
```

### Document selection

```markdown
<theme name="sci-fi">

# Title
```

### Theme package

`src/theme.ts` runs the same CSS through `defineLocalTheme`, which validates
resources, scopes every rule to `[data-rmd-theme="sci-fi"]` and freezes the
package. Use `sciFiThemeResources` in export, SSR or offline pipelines.

---

## 10. Do and do not

| Do | Do not |
| --- | --- |
| Use a 1px rule to separate modules | Use a blurred card shadow |
| Use one accent action per module | Fill every selected thing with accent |
| Use mono uppercase for metadata | Uppercase paragraphs |
| Keep one 4px spacing rhythm | Mix 3/5/7px arbitrary gaps |
| Use a 2px inset signal for selection | Use a glow as the main selection cue |
| Let tables scroll on narrow screens | Shrink table text below 13px |
| Keep chart frames and panel headers aligned | Float chart labels outside the frame |
| Use `--sf-*` component tokens | Hard-code hex values in component rules |

---

## 11. Verification

```sh
# contract, scope, contrast, radius and spacing checks
npm run sci-fi:test

# typecheck + production build of the gallery
npx tsc -p examples/sci-fi-theme/tsconfig.json --noEmit
npm run sci-fi:build

# regenerate the screenshots in screenshots/
npm run sci-fi:screenshot
```

The screenshot script fails on console errors, page errors or renderer
diagnostics, and captures dark, light, component close-ups and a 390px layout.
