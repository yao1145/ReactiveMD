# Reactive MD theme protocol

**English** · [中文](theme-protocol-ch.md)

Protocol revision: `reactive-md-theme-1`, introduced in `0.4.0`. The built-in `default` theme uses the product-UI appearance. Every other theme, including a `soft` example that preserves the package's original look, is external and must be registered by the host.

The source [extension SDK preview](../integration/extension-sdk-en.md) provides `defineLocalTheme`, `composeLocalTheme` and theme package resource conventions. Its build adapter includes theme CSS, fonts and images in offline exports. The semantic variables and scope rules below still apply. Use a tarball built from the current source for the SDK preview.

## Selecting a theme

Place a declaration before the document body:

```markdown
<theme name="default">

# Document title
```

`<theme name="default" />` is also accepted. Omission selects `default`. Whitespace, a BOM and comments may precede the declaration. Declare it once, outside components. The static `name` uses lowercase kebab-case, starts with a letter and has at most 64 characters. Expressions and additional attributes are invalid.

Only `default` is built in. A document selects any other theme by name only when the host has registered that name, for example `<theme name="soft">` for the original-look example in the product-UI gallery or `<theme name="paper">` for a host design. Registration is described below.

The declaration is document metadata, does not count as a component and produces no visible element. Compilation stores `document.theme` and the original declaration's `document.themeRange`. Body nodes retain their original source positions. Fenced code, inline code, comments and escaped examples remain literal.

Invalid declarations produce `local.theme.*` warnings and select `default`. Repeated declarations do not change the first selection. Late or nested declarations do not select a theme. Healthy body content and controls remain usable.

## Host registration

A developer supplies CSS and registration metadata. Import the shared styles before the theme stylesheet, then pass the allowed themes to the renderer:

```tsx
import { LOCAL_THEME_PROTOCOL, type LocalThemeDefinition } from 'reactive-md';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './paper-theme.css';

const paperTheme = {
  name: 'paper',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: ['light', 'dark'],
} as const satisfies LocalThemeDefinition;

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} themes={[paperTheme]} colorScheme="auto" />;
}
```

This demonstrates registration. The repository includes only `default` as a built-in theme, and a host definition cannot replace it. Everything else is external: the original-look `soft` name and the complete sci-fi reference package both require host registration; `soft` has no separate stylesheet, so the product-UI gallery registers the name with a plain definition while the core baseline CSS supplies its appearance. The repository's `paper` example above has no design or stylesheet; a complete reference package with tokens, component styling, both colour schemes and a live gallery is in [examples/sci-fi-theme](../../examples/sci-fi-theme/README.md).

| Field | Requirement |
| --- | --- |
| `name` | Follows the document identifier rules; unique in the host list; `default` is reserved |
| `protocol` | Must be `reactive-md-theme-1`; use `LOCAL_THEME_PROTOCOL` |
| `colorSchemes` | Must include both `light` and `dark` |

The host loads the CSS. Registration does not fetch or inject styles. Documents select a registered name and cannot provide CSS, stylesheet URLs or scripts. Theme CSS is trusted host code; the host reviews its scope and resource references.

An unknown name, duplicate selected name, invalid selected registration, unsupported protocol or missing mode produces a renderer warning and falls back to `default`. Built-in `default` is always available; selecting `soft` or any other external name without registering it falls back to `default` in the same way. Core-only hosts can call `resolveLocalTheme(name, themes, range?, source?)` to obtain `{ name, diagnostics }`. Compilation parses declarations independently of host registrations.

## Color schemes and instance scope

Both React components accept `themes` and `colorScheme`. The theme selects the visual design; the color scheme selects its light or dark version:

| Value | Behavior |
| --- | --- |
| `light` | Forces light mode for this document, including inside a dark host |
| `dark` | Forces dark mode for this document |
| `auto` (default) | Uses the nearest ancestor's explicit preference, then the system preference; server output starts in light mode |

Ancestor preferences support `data-color-scheme="light|dark"` and the existing `data-theme="light|dark"`. Ancestor attribute changes and system preference changes update the document in the browser. An explicit local `colorScheme` takes precedence.

The renderer exposes the resolved selection on its document root:

```html
<article class="md-document local-document"
         data-rmd-theme="paper"
         data-color-scheme="dark">
```

Each instance chooses independently. Every theme rule must be scoped to its named root or descendants, for example `[data-rmd-theme="paper"][data-color-scheme="dark"]`. Global `body`, `:root` and unscoped element rules must not affect the host.

Changing `themes` or `colorScheme` does not create a runtime. Changing `LocalReactiveDocument.source` retains its existing behavior: recompilation and a new runtime. Hosts that retain parameters across source changes can manage `LocalDocumentView` and its runtime themselves.

## Shared style variables

Shared component CSS supplies structure, interaction and defaults. Custom themes inherit a complete default variable set and override the values they need. Both light and dark variants must be designed and checked.

| Purpose | Public variables |
| --- | --- |
| Surfaces | `--paper`, `--surface`, `--document-bg` (defaults to `--surface`), `--surface-subtle`, `--surface-hover`, `--surface-active`, `--image-zoom-backdrop` |
| Text and borders | `--ink`, `--ink-soft`, `--ink-muted`, `--line`, `--line-strong` |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-line`, `--accent-ink` (text on accent fills), `--accent-text` (accent used as ink) |
| Status | `--info`, `--info-soft`, `--success`, `--success-soft`, `--success-line`, `--warning`, `--warning-soft`, `--warning-line`, `--danger`, `--danger-soft`, `--danger-line`, `--neutral-soft` |
| Focus | `--focus`, `--focus-outline`, `--focus-ring` |
| Data and code | `--chart-1` through `--chart-8`, `--chart-grid`, `--chart-axis`, `--code-bg`, `--code-bg-deep`, `--code-ink` |
| Fonts | `--font-sans`, `--font-mono`, `--text-xs` through `--text-xl`, `--text-2xl`, `--text-block-title`, `--text-block-subtitle` |
| Line height and weight | `--leading-tight`, `--leading-snug`, `--leading-normal`, `--leading-relaxed`, `--weight-regular`, `--weight-medium`, `--weight-semibold`, `--weight-bold` |
| Spacing | `--space-1` through `--space-7`, `--field-gap` |
| Radius | `--radius-control`, `--radius-card`, `--radius-panel`, `--radius-pill`, `--radius-field`, `--radius-field-multiline` |
| Controls | `--control-height-sm`, `--control-height`, `--control-height-lg`, `--control-padding-x`, `--control-padding-y`, `--control-inset-x`, `--control-selected`, `--control-selected-ink`, `--control-track`, `--control-thumb`, `--disabled-opacity` |
| Tables | `--table-cell-padding-y`, `--table-cell-padding-x` |
| Motion and elevation | `--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-standard`, `--shadow-sm`, `--shadow-md` |

Existing `--blue`, `--blue-deep`, `--blue-soft` and `--blue-line` remain compatible. New themes should use the accent variables. Explicit component `color` attributes override their corresponding local color; other properties continue to use the theme. Series and status colors retain their semantic roles.

## Themed native buttons

`reactive-md/styles.css` includes the shared `controls.css` button skin. A component that renders a native `<button>` or an `input` with type `button`, `submit` or `reset` inside `.md-document` receives the current document's secondary appearance:

```tsx
<button type="button">Pause</button>
<button type="button" className="md-button-primary">Start</button>
<button type="button" className="game-direction">←</button>
<button type="button" data-rmd-appearance="custom">Custom button</button>
```

| Usage | Appearance responsibility |
| --- | --- |
| Plain native button or compatible `md-button` class | Secondary by default, with hover, active, focus-visible and disabled states |
| `md-button-primary`, `md-button-secondary`, `md-button-quiet` | Explicit semantic variant; each class works on its own |
| Component CSS class | Overrides individual properties; changing width retains shared colors, disabled and focus styles |
| `data-rmd-appearance="custom"` | The element opts out of the shared button skin; its component owns appearance and interaction states and can still use theme variables |

`data-rmd-appearance` is a DOM attribute emitted by the component. It requires no RMD syntax change and does not opt out descendant buttons. Shared rules use `:where()` for zero selector specificity and no `!important`. An ordinary component class overrides its declared properties, including those properties in interaction states. Shared buttons set no margin: containers and component layouts own spacing. `[hidden]` stays hidden. Disabled styling also covers buttons in disabled fieldsets.

Themes adjust buttons through `--surface`, `--surface-hover`, `--surface-active`, `--ink`, `--line-strong`, `--accent`, `--accent-hover`, `--accent-ink`, `--control-height`, `--control-inset-x`, `--control-padding-y`, `--radius-field`, `--focus-outline` and the existing typography and motion variables. Component packages own boards, tile colors and game animations. Built-in and external buttons share one implementation.

Hosts load shared CSS, theme resources, then component resources. SSR pages load the same `reactive-md/styles.css` for the first paint. Offline HTML includes shared CSS, the selected theme and component CSS. Each document root supplies its own variables; changing themes preserves component runtime state. Compiler-only entries retain no CSS dependency.

Automatic matching covers native buttons inside documents. Components style `[role="button"]` themselves. Host navigation and editor toolbars outside documents keep their own appearance. Portal, Shadow DOM and iframe content need separate theme integration. The same automatic approach covers the native controls and component classes below.

## Themed native controls

The shared stylesheet also skins the native controls below when they appear inside `.md-document`. Matching uses the real element and input type; the skin does not infer a control from a role, a container class or a `div`. Keyboard handling, validation timing, pickers, spinners and platform interaction remain native. Components own labels, ARIA, state and behavior. `data-rmd-appearance="custom"` on a matched element returns its appearance to the component; theme variables remain available.

**Fields.** Text-like inputs with an omitted type or `text`, `search`, `email`, `url`, `tel`, `password`, `number`, `date`, `time`, `datetime-local`, `month` or `week`, plus `textarea` and single or multiple `select`, use the theme surface, border, radius and control height. Focus uses `--focus` and `--focus-ring`. `aria-invalid="true"` and the platform `:user-invalid` state show the danger border; the skin ignores bare `:invalid` so validation timing stays with the author. Read-only fields keep their theme and focus behavior; disabled fields use `--disabled-opacity`, including controls in a disabled `fieldset`. Native date and time pickers, number spinners and select arrows stay available. Fields fill the container up to 420px and shrink at 375px.

`.md-field` and the compatible `.md-control` group a label, control, hint and error with a vertical gap. `.md-label`, `.md-hint`, `.md-error` and `.md-required` style those parts; native `label` and `legend` receive base typography. Authors set `required` or `aria-required` on the control itself. `.md-text-input` and `.md-select-input` remain compatible hooks with the same skin.

**Selection and progress.** Native `input[type="checkbox"]` and `input[type="radio"]` keep their platform shape and use `--control-selected`, falling back to `--accent`, for the checked mark. A native checkbox opts into switch appearance with `.md-switch`, or with `role="switch"` on that same checkbox. `input[type="range"]` themes the track and thumb in WebKit and Firefox while retaining native input semantics. `progress` supports determinate and indeterminate output. `meter` keeps its low, high and optimum semantics with status colors. `.md-progress` and `.md-meter` are optional hooks on the same native elements. Each control type has its own sizing rules.

**Disclosure.** Native `details` and `summary` receive basic appearance; the marker, keyboard behavior and closed state stay native, and the skin never sets `display` on a closed element. `.md-disclosure`, `.md-disclosure-title` and `.md-disclosure-panel` are optional appearance hooks for author-owned disclosure markup.

**Dialog and popover.** A native `dialog` is styled only while open, and a native `[popover]` only in `:popover-open`. The skin sets no display, position or pointer behavior. `dialog::backdrop` uses `--image-zoom-backdrop` with a neutral fallback. `.md-dialog`, `.md-popover`, `.md-tooltip`, `.md-menu`, `.md-menu-item` and `.md-menu-separator` provide appearance for author-owned markup; the author owns open state, placement, focus, keyboard handling and portalling. The classes never reveal a closed dialog or popover, and size constraints keep them usable at 375px.

## Themed component classes

Shared classes cover the remaining public UI. They supply appearance; the author supplies semantics, behavior, focus and position.

| Area | Public hooks |
| --- | --- |
| Surfaces | `md-card`, `md-card-title`, `md-card-body`, `md-panel`, `md-panel-title`, `md-panel-body`, `md-group` |
| Status | `md-badge` and `md-status` with `md-badge-neutral`, `md-badge-success`, `md-badge-warning`, `md-badge-danger`, `md-badge-info` and the matching `md-status-*` variants |
| Feedback | `md-alert` with `md-alert-success`, `md-alert-warning`, `md-alert-danger`, `md-alert-info`, `md-alert-title`, `md-alert-body`; `md-empty-state`, `md-empty-state-title`, `md-empty-state-description`; `md-spinner`, `md-loading`, `md-skeleton` |
| Navigation | `md-tabs`, `md-tablist`, `md-tab`, `md-tabpanel`, `md-pagination`, `md-page`, `md-steps`, `md-step` |
| Content | Document typography for headings, paragraphs, links, lists, quotes, rules, `kbd`, inline code and code blocks; native tables and `md-table` |
| Charts | `md-chart`, `md-chart-axis`, `md-chart-grid`, `md-chart-legend`, `md-chart-node`, `md-chart-edge`, `md-chart-series-line`, `md-chart-series-area` |

Tabs and steps read `aria-selected`, `aria-current`, `aria-expanded` and disabled states for appearance. `aria-current="step"` and `data-state="complete"` mark step progress. Tables add `md-table-striped` for zebra rows and `aria-selected="true"` or `data-state="selected"` for selected rows. Cell padding uses `--table-cell-padding-y` and `--table-cell-padding-x`.

A chart series element sets `--series-color`, falling back to `--chart-1`. `data-series="1"` through `"8"` map the existing `--chart-1` to `--chart-8` palette. The author supplies SVG geometry, accessible names and interaction.

Document typography uses the shared type, spacing and line-height variables. Inline code and code blocks use `--code-bg`, `--code-bg-deep` and `--code-ink`; `kbd` uses the control surface and border. Native tables and `md-table` share cell padding and borders. Specialized widgets keep their own appearance.

Every new skin is scoped to `.md-document`. Base and state selector bodies use `:where()` for zero specificity; pseudo-elements follow that body. The new skins add no `!important`. An ordinary component class overrides any property it declares in either stylesheet order. `[data-rmd-appearance="custom"]` opts out only the element it marks; descendants keep their skin. Hidden elements stay hidden. Print keeps native control values and the existing built-in print summaries.

## Density

`data-rmd-density="compact"` or `"comfortable"` on the document root or a subtree adjusts control height and table cell padding through the shared variables. Components and themes override individual sizes as usual.

## Component CSS and acceptance

Themes can supplement variable overrides with existing `.md-*` and `.local-*` component classes. Root classes, component outer classes and semantic state attributes are styling interfaces; internal node ordering is not an extension API. Load scoped theme rules after the shared stylesheet, using sufficiently specific root and component selectors instead of relying on `!important`.

Coverage includes Markdown, tables, formulas, controls, containers, feedback, charts and diagrams. New components must consume shared variables and work with `default`. Themes without dedicated rules for a new component inherit its shared styles.

A conforming theme must check every component in both modes, including hover, focus, active, disabled, error and selection states. Preserve visible keyboard focus, readable text and controls, a usable 375px layout and reduced-motion preferences. Font changes require checking SVG diagram labels, nodes and bounds.

Registration validates protocol and declared modes. Browser acceptance verifies CSS coverage, contrast and layout. Include multiple isolated themes, forced light inside a dark host, system preference changes, retained interaction state and unmount cleanup.
