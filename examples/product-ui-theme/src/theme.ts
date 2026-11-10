import { defineLocalTheme, type LocalThemePackage } from 'reactive-md/sdk';
import tokensCss from './tokens.css?raw';
import overlaysCss from './overlays.css?raw';
import formsCss from './forms.css?raw';
import navigationCss from './navigation.css?raw';
import feedbackCss from './feedback.css?raw';
import spacingCss from './spacing.css?raw';

/**
 * PRODUCT UI / PU-01 — a warm product-interface theme for Reactive MD.
 *
 * The visual language is a product surface rather than a document skin: warm
 * off-white paper, white panels, near-black ink and one vivid blue accent.
 * Geometry is rounded but not capsule-shaped — 8px fields and controls, 10px
 * buttons, 12px cards, 14px panels — and elevation is soft.
 *
 * Motion follows the motion-prompt `ui` pack: short, eased transitions with a
 * dialog entrance from .96, a popover from .98, 220ms panels and 180ms toggles.
 *
 * `defineLocalTheme` validates the CSS, rejects network resources and scopes
 * every rule to `[data-rmd-theme="product-ui"]`, so a document that selects
 * `<theme name="product-ui">` cannot restyle its host page or another instance.
 *
 * Registration is host-owned: import the CSS (or collect these resources) and
 * pass the definition to `LocalReactiveDocument`'s `themes` prop.
 */
export const productUiTheme = defineLocalTheme({
  id: 'reactive-md/theme-product-ui',
  name: 'product-ui',
  version: '1.0.0',
  protocol: 'reactive-md-theme-1',
  colorSchemes: ['light', 'dark'],
  css: [
    { id: 'reactive-md/theme-product-ui.tokens.css', css: tokensCss },
    { id: 'reactive-md/theme-product-ui.overlays.css', css: overlaysCss },
    { id: 'reactive-md/theme-product-ui.forms.css', css: formsCss },
    { id: 'reactive-md/theme-product-ui.navigation.css', css: navigationCss },
    { id: 'reactive-md/theme-product-ui.feedback.css', css: feedbackCss },
    { id: 'reactive-md/theme-product-ui.spacing.css', css: spacingCss },
  ],
});

/** The validated, already-scoped resources for export and SSR pipelines. */
export const productUiThemeResources = productUiTheme.css;

/** Plain registration metadata for hosts that load CSS themselves. */
export const productUiThemeDefinition = Object.freeze({
  name: productUiTheme.name,
  protocol: productUiTheme.protocol,
  colorSchemes: productUiTheme.colorSchemes,
});

export type { LocalThemePackage };
