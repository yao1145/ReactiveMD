import { defineLocalTheme } from 'reactive-md/sdk';
import themeCss from './theme.css?raw';

/**
 * A package theme. `defineLocalTheme` scopes every selector to
 * `[data-rmd-theme="paper"]`, validates `url()` data resources and freezes the
 * package. The original CSS stays in `theme.css` so it can also be shipped as
 * an export resource with the same identity.
 */
export const paper = defineLocalTheme({
  id: 'example/paper',
  name: 'paper',
  version: '1.0.0',
  protocol: 'reactive-md-theme-1',
  colorSchemes: ['light', 'dark'],
  css: [{ id: 'example/paper.css', css: themeCss }],
});

export const themeResource = Object.freeze({
  id: 'example/paper.css',
  css: paper.css[0].css,
});
