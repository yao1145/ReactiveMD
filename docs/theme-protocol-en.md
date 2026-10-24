# Reactive MD theme protocol

Protocol revision: `reactive-md-theme-1`. This feature ships in `0.4.0`, the preview release on the `next` channel. The built-in `default` preserves the existing appearance.

## Selecting a theme

Place a declaration before the document body:

```markdown
<theme name="default">

# Document title
```

`<theme name="default" />` is also accepted. Omission selects `default`. Whitespace, a BOM and comments may precede the declaration. Declare it once, outside components. The static `name` uses lowercase kebab-case, starts with a letter and has at most 64 characters. Expressions and additional attributes are invalid.

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

This demonstrates registration. The repository includes only `default`; it does not include a `paper` design or stylesheet.

| Field | Requirement |
| --- | --- |
| `name` | Follows the document identifier rules; unique in the host list; `default` is reserved |
| `protocol` | Must be `reactive-md-theme-1`; use `LOCAL_THEME_PROTOCOL` |
| `colorSchemes` | Must include both `light` and `dark` |

The host loads the CSS. Registration does not fetch or inject styles. Documents select a registered name and cannot provide CSS, stylesheet URLs or scripts. Theme CSS is trusted host code; the host reviews its scope and resource references.

An unknown name, duplicate selected name, invalid selected registration, unsupported protocol or missing mode produces a renderer warning and falls back to `default`. Core-only hosts can call `resolveLocalTheme(name, themes, range?, source?)` to obtain `{ name, diagnostics }`. Compilation parses declarations independently of host registrations.

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
| Surfaces | `--paper`, `--surface`, `--document-bg` (defaults to `--surface`), `--surface-subtle`, `--surface-hover`, `--surface-active` |
| Text and borders | `--ink`, `--ink-soft`, `--ink-muted`, `--line`, `--line-strong` |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-line` |
| Status | `--info`, `--info-soft`, `--success`, `--success-soft`, `--success-line`, `--warning`, `--warning-soft`, `--warning-line`, `--danger`, `--danger-soft`, `--danger-line`, `--neutral-soft` |
| Focus | `--focus`, `--focus-outline`, `--focus-ring` |
| Data and code | `--chart-1` through `--chart-8`, `--chart-grid`, `--chart-axis`, `--code-bg`, `--code-bg-deep`, `--code-ink` |
| Fonts | `--font-sans`, `--font-mono`, `--text-xs` through `--text-xl`, `--text-2xl`, `--text-block-title`, `--text-block-subtitle` |
| Line height and weight | `--leading-tight`, `--leading-snug`, `--leading-normal`, `--leading-relaxed`, `--weight-regular`, `--weight-medium`, `--weight-semibold`, `--weight-bold` |
| Spacing | `--space-1` through `--space-7`, `--field-gap` |
| Radius | `--radius-control`, `--radius-card`, `--radius-panel`, `--radius-pill` |
| Controls | `--control-height-sm`, `--control-height`, `--control-height-lg`, `--control-padding-x`, `--control-padding-y`, `--disabled-opacity` |
| Motion and elevation | `--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-standard`, `--shadow-sm`, `--shadow-md` |

Existing `--blue`, `--blue-deep`, `--blue-soft` and `--blue-line` remain compatible. New themes should use the accent variables. Explicit component `color` attributes override their corresponding local color; other properties continue to use the theme. Series and status colors retain their semantic roles.

## Component CSS and acceptance

Themes can supplement variable overrides with existing `.md-*` and `.local-*` component classes. Root classes, component outer classes and semantic state attributes are styling interfaces; internal node ordering is not an extension API. Load scoped theme rules after the shared stylesheet, using sufficiently specific root and component selectors instead of relying on `!important`.

Coverage includes Markdown, tables, formulas, controls, containers, feedback, charts and diagrams. New components must consume shared variables and work with `default`. Themes without dedicated rules for a new component inherit its shared styles.

A conforming theme must check every component in both modes, including hover, focus, active, disabled, error and selection states. Preserve visible keyboard focus, readable text and controls, a usable 375px layout and reduced-motion preferences. Font changes require checking SVG diagram labels, nodes and bounds.

Registration validates protocol and declared modes. Browser acceptance verifies CSS coverage, contrast and layout. Include multiple isolated themes, forced light inside a dark host, system preference changes, retained interaction state and unmount cleanup.
