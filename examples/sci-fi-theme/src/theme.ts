import { defineLocalTheme, type LocalThemePackage } from 'reactive-md/sdk';
import tokensCss from './tokens.css?raw';
import componentsCss from './components.css?raw';

/**
 * SCI-FI / SF-01 — a hard-sci-fi theme package for Reactive MD.
 *
 * `defineLocalTheme` validates the CSS, rejects network resources and scopes
 * every rule to `[data-rmd-theme="sci-fi"]`, so a document that selects
 * `<theme name="sci-fi">` cannot restyle its host page or another instance.
 *
 * Registration is host-owned: import the CSS (or collect these resources) and
 * pass the definition to `LocalReactiveDocument`'s `themes` prop.
 */
export const sciFiTheme = defineLocalTheme({
  id: 'reactive-md/theme-sci-fi',
  name: 'sci-fi',
  version: '1.0.0',
  protocol: 'reactive-md-theme-1',
  colorSchemes: ['light', 'dark'],
  css: [
    { id: 'reactive-md/theme-sci-fi.tokens.css', css: tokensCss },
    { id: 'reactive-md/theme-sci-fi.components.css', css: componentsCss },
  ],
});

/** The validated, already-scoped resources for export and SSR pipelines. */
export const sciFiThemeResources = sciFiTheme.css;

/** Plain registration metadata for hosts that load CSS themselves. */
export const sciFiThemeDefinition = Object.freeze({
  name: sciFiTheme.name,
  protocol: sciFiTheme.protocol,
  colorSchemes: sciFiTheme.colorSchemes,
});

export type { LocalThemePackage };
