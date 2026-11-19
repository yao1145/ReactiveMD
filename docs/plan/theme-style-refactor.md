# Shared theme and style architecture

The renderer uses one implementation per component across every theme. Theme
selection changes CSS. Static output and hydration choose implementations by
rendering capability, independently of the selected theme name.

## Ownership

| Source | Responsibility |
| --- | --- |
| `src/themes/default/` | Complete default design values for all document roots |
| Component CSS | Layout, parts, states and consumption of design values |
| `src/styles/` | Public aggregation, document styling and cross-component policies |
| External theme package | Scoped token overrides and optional part styling |
| `src/sdk/theme.ts` | Validation, document scoping, font isolation and theme composition |

The default design is always present. An empty registered theme receives the
same controls, chart implementation and design values as the default theme.
Unregistered or invalid selections resolve to the default theme with a diagnostic.

## Cascade and compatibility

The layer order is `rmd.reset`, `rmd.defaults`, `rmd.components`, `rmd.themes`,
`rmd.overrides`. The SDK normalizes theme resources into `rmd.themes` and keeps
their resource order. Revalidating or composing a package preserves that boundary.
Core CSS modules participate in the same cascade as the public stylesheet.

Existing semantic variables such as `--accent`, `--surface` and `--control-height`
remain the public semantic API. New component variables use `--rmd-` names.
Concrete defaults are defined once in the document baseline. Components consume
optional overrides with semantic fallbacks at the element using the value, so
local accent and density overrides continue to work in descendant scopes.

Public DOM hooks use `data-rmd-component` and `data-rmd-part`. Existing ARIA
attributes describe interaction states. Internal class names, CSS module hashes
and DOM nesting remain implementation details. Themes use tokens for common
changes and stable part hooks for additional decoration.

## Slider geometry

The slider exposes independent thumb width, height and radius. Horizontal track
insets use thumb width; vertical alignment and bubble placement use thumb height.
Keyboard and pointer interaction use the resulting layout. Native range inputs
have a separate `--rmd-native-range-*` component contract, preserving their 18px
thumbs while the adapted slider retains its 22px thumbs. Themes can override
both contracts when they want the same geometry.

## Delivery and verification

The public `reactive-md/styles.css` entry includes the complete baseline. SSR,
standalone and offline exports include that baseline plus the selected theme and
component resources. The compiler entry remains independent of CSS and React.

Verification covers an empty theme, variable-only rectangular thumbs, light and
dark modes, multiple documents, keyboard and pointer changes, fallback recovery
without state loss, static summaries and 375px layouts. Existing controls, visual,
export and package-boundary checks remain part of the regression coverage.

