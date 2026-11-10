import { defineLocalTheme, type LocalThemePackage } from 'reactive-md/sdk';
import { softThemeDefinition } from './definition';

/**
 * SOFT — a host-registered theme for Reactive MD.
 *
 * The old default appearance is the core baseline; this package contributes no
 * CSS. Registration is host-owned: pass the definition to
 * `LocalReactiveDocument`'s `themes` prop, then a document can select
 * `<theme name="soft">`.
 */
export const softTheme = defineLocalTheme({
  id: 'reactive-md/theme-soft',
  version: '1.0.0',
  ...softThemeDefinition,
  css: [],
});

/** Empty resource list, kept for parity with CSS-backed theme packages. */
export const softThemeResources = softTheme.css;

export { softThemeDefinition };

export type { LocalThemePackage };
