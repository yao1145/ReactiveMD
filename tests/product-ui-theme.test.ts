import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defineLocalTheme } from '../src/sdk/theme';

function readThemeCss(file: string): string {
  return readFileSync(new URL(`../examples/product-ui-theme/src/${file}`, import.meta.url), 'utf8');
}

const tokensCss = readThemeCss('tokens.css');
const overlaysCss = readThemeCss('overlays.css');
const formsCss = readThemeCss('forms.css');
const navigationCss = readThemeCss('navigation.css');
const feedbackCss = readThemeCss('feedback.css');
const spacingCss = readThemeCss('spacing.css');
const convenienceCss = readFileSync(
  new URL('../examples/product-ui-theme/src/product-ui.css', import.meta.url),
  'utf8',
);
const coreCss = readFileSync(new URL('../src/local/rendering/local.css', import.meta.url), 'utf8');

const RESOURCES = [
  ['tokens.css', tokensCss],
  ['overlays.css', overlaysCss],
  ['forms.css', formsCss],
  ['navigation.css', navigationCss],
  ['feedback.css', feedbackCss],
  ['spacing.css', spacingCss],
] as const;

const ROOT = '[data-rmd-theme="product-ui"]';
const DARK = '[data-rmd-theme="product-ui"][data-color-scheme="dark"]';

/** Split a selector list without breaking commas inside :is(), :where() or attrs. */
function splitSelectorList(prelude: string): string[] {
  const selectors: string[] = [];
  let parentheses = 0;
  let brackets = 0;
  let start = 0;
  for (let index = 0; index < prelude.length; index += 1) {
    const character = prelude[index];
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < prelude.length && prelude[index] !== quote) {
        if (prelude[index] === '\\') index += 1;
        index += 1;
      }
      continue;
    }
    if (character === '(') parentheses += 1;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(prelude.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(prelude.slice(start));
  return selectors.map((selector) => selector.trim()).filter(Boolean);
}

/**
 * Every selector must start at the theme root, including selectors nested in
 * @media, @supports, @starting-style, @container and @layer. Keyframe steps and
 * @font-face descriptors are values, not selectors, so those bodies are skipped.
 */
function assertScoped(css: string): void {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const check = (body: string): void => {
    let prelude = '';
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];
      if (character === ';') {
        // A statement such as `@layer tokens;` is not a selector.
        prelude = '';
        continue;
      }
      if (character !== '{') {
        prelude += character;
        continue;
      }
      let depth = 1;
      let end = index + 1;
      for (; end < body.length && depth > 0; end += 1) {
        if (body[end] === '{') depth += 1;
        else if (body[end] === '}') depth -= 1;
      }
      const head = prelude.trim();
      const inner = body.slice(index + 1, end - 1);
      if (head.startsWith('@')) {
        const atName = (/^@([\w-]+)/.exec(head)?.[1] ?? '').toLowerCase();
        if (atName === 'keyframes' || atName.endsWith('-keyframes') || atName === 'font-face') {
          // Animation steps and font descriptors are not selectors.
        } else {
          check(inner);
        }
      } else {
        for (const selector of splitSelectorList(head)) {
          expect(selector.startsWith(ROOT), `unscoped selector: ${selector}`).toBe(true);
        }
      }
      prelude = '';
      index = end - 1;
    }
  };
  check(source);
}

function block(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  expect(start, `missing block ${selector}`).toBeGreaterThanOrEqual(0);
  const open = start + marker.length - 1;
  let depth = 1;
  let end = open + 1;
  for (; end < css.length && depth > 0; end += 1) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') depth -= 1;
  }
  return css.slice(open + 1, end - 1);
}

function token(css: string, name: string): string | undefined {
  return new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css)?.[1].trim();
}

function resolve(name: string, scope: string): string {
  let value = token(scope, name) ?? token(block(tokensCss, ROOT), name);
  expect(value, `missing token --${name}`).toBeTruthy();
  for (let guard = 0; guard < 8 && /^var\(/.test(value!); guard += 1) {
    const reference = /var\((--[a-z0-9-]+)/.exec(value!)?.[1];
    if (!reference) break;
    value = token(scope, reference.slice(2)) ?? token(block(tokensCss, ROOT), reference.slice(2));
  }
  return value!;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  expect(match, `expected a six-digit hex colour, received ${hex}`).toBeTruthy();
  const number = Number.parseInt(match![1], 16);
  const red = channel((number >> 16) & 0xff);
  const green = channel((number >> 8) & 0xff);
  const blue = channel(number & 0xff);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const [light, dark] = first > second ? [first, second] : [second, first];
  return (light + 0.05) / (dark + 0.05);
}

const SEMANTIC_TOKENS = [
  'surface',
  'ink',
  'line',
  'accent',
  'accent-ink',
  'accent-text',
  'focus',
  'chart-1',
  'code-bg',
  'radius-panel',
  'radius-field',
] as const;

const PRODUCT_TOKENS = [
  'pu-overlay-shadow',
  'pu-segmented-track',
  'pu-segmented-thumb',
  'pu-chip-bg',
  'pu-chip-selected-bg',
  'pu-rail-track',
  'pu-rail-fill',
  'pu-focus-halo',
] as const;

const CONTRAST_PAIRS: readonly [string, string, number][] = [
  ['ink', 'surface', 7],
  ['ink-soft', 'surface', 4.5],
  ['ink-muted', 'surface', 4.5],
  ['accent-ink', 'accent', 4.5],
  ['accent-text', 'surface', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'surface', 4.5],
  ['danger', 'surface', 4.5],
  ['chart-1', 'surface', 3],
];

const RADII: readonly [string, number][] = [
  ['radius-control', 8],
  ['radius-field', 8],
  ['radius-card', 12],
  ['radius-panel', 14],
];

const REDUCED_MOTION_FILES = [
  ['overlays.css', overlaysCss],
  ['forms.css', formsCss],
  ['navigation.css', navigationCss],
  ['feedback.css', feedbackCss],
] as const;

describe('product-ui theme package', () => {
  it('scopes every rule in all six resources to the product-ui root', () => {
    for (const [file, css] of RESOURCES) {
      assertScoped(css);
      expect(css, `${file} must reference the theme root`).toContain(ROOT);
    }
  });

  it('declares no global keyframes in any resource', () => {
    // defineLocalTheme rejects @keyframes because animation names are global.
    // The theme expresses all motion with @starting-style and transitions.
    for (const [file, css] of RESOURCES) {
      expect(css, `${file} must not declare @keyframes`).not.toMatch(/@(?:-[a-z]+-)?keyframes\b/i);
    }
  });

  it('validates through the public theme contract', () => {
    const theme = defineLocalTheme({
      id: 'reactive-md/theme-product-ui',
      name: 'product-ui',
      version: '1.0.0',
      colorSchemes: ['light', 'dark'],
      css: RESOURCES.map(([id, css]) => ({ id, css })),
    });
    expect(theme.id).toBe('reactive-md/theme-product-ui');
    expect(theme.name).toBe('product-ui');
    expect(theme.version).toBe('1.0.0');
    expect(theme.colorSchemes).toEqual(['light', 'dark']);
    expect(theme.css).toHaveLength(6);
    expect(theme.css.every((resource) => resource.css.includes(ROOT))).toBe(true);
    expect(theme.css.every((resource) => !/@import|url\(\s*['"]?https?:/i.test(resource.css))).toBe(true);
  });

  it('defines the full light and dark semantic contract', () => {
    for (const selector of [ROOT, DARK]) {
      const scope = block(tokensCss, selector);
      const root = block(tokensCss, ROOT);
      for (const name of SEMANTIC_TOKENS) {
        expect(token(scope, name) ?? token(root, name), `${selector} is missing --${name}`).toBeTruthy();
      }
    }
  });

  it('defines the product component tokens in both modes', () => {
    for (const selector of [ROOT, DARK]) {
      const scope = block(tokensCss, selector);
      for (const name of PRODUCT_TOKENS) {
        expect(token(scope, name), `${selector} is missing --${name}`).toBeTruthy();
      }
    }
  });

  it('meets the stated contrast floors in both modes', () => {
    for (const selector of [ROOT, DARK]) {
      const scope = block(tokensCss, selector);
      for (const [foreground, background, floor] of CONTRAST_PAIRS) {
        const ratio = contrast(resolve(foreground, scope), resolve(background, scope));
        expect(ratio, `${selector}: --${foreground} on --${background} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('keeps the rounded-rectangle radius contract and the 4px spacing grid', () => {
    const root = block(tokensCss, ROOT);
    for (const [name, px] of RADII) {
      expect(Number.parseFloat(resolve(name, root)), `--${name}`).toBe(px);
    }
    for (let step = 1; step <= 7; step += 1) {
      const px = Number.parseFloat(resolve(`space-${step}`, root));
      expect(Number.isFinite(px), `--space-${step}`).toBe(true);
      expect(px % 4, `--space-${step}`).toBe(0);
    }
  });

  it('keeps the two-level document spacing contract', () => {
    const root = block(tokensCss, ROOT);
    expect(resolve('pu-gap-section', root)).toBe('32px');
    expect(resolve('pu-gap-block', root)).toBe('16px');
    expect(resolve('pu-gap-inline', root)).toBe('12px');

    // Headings use the section gap; top-level prose, section prose and block
    // components use the block gap.
    expect(spacingCss).toContain(
      'margin-block: var(--pu-gap-section) var(--space-3, 12px);',
    );
    expect(spacingCss.match(/margin-block: var\(--pu-gap-block\);/g)).toHaveLength(3);

    // Nested layout owns its own spacing.
    expect(spacingCss).toMatch(/\.local-grid > \*[^{]*\{[^}]*margin-block: 0;/);
    expect(spacingCss).toMatch(/\.local-accordion \.local-disclosure[^{]*\{[^}]*margin-block: 0;/);

    // Inline components must stay in the text flow.
    expect(spacingCss).not.toMatch(/\.(?:md-badge|md-status|local-tooltip)\b/);

    // The direct-import stylesheet loads the spacing layer last.
    const imports = [...convenienceCss.matchAll(/@import '([^']+)';/g)].map((match) => match[1]);
    expect(imports.at(-1)).toBe('./spacing.css');
  });

  it('honours the motion timing scale and reduced-motion contract', () => {
    const root = block(tokensCss, ROOT);
    expect(resolve('motion-fast', root)).toBe('150ms');
    expect(resolve('motion-base', root)).toBe('220ms');
    expect(resolve('motion-slow', root)).toBe('300ms');
    for (const [file, css] of REDUCED_MOTION_FILES) {
      expect(
        /@media[^{]*prefers-reduced-motion[^{]*\{/i.test(css),
        `${file} is missing a prefers-reduced-motion block`,
      ).toBe(true);
    }
  });

  it('exposes the documented motion hooks', () => {
    expect(overlaysCss).toContain('@starting-style');
    expect(navigationCss).toContain('@starting-style');
    expect(overlaysCss).toContain('scale(0.96)');
    expect(overlaysCss).toContain('scale(0.98)');
    expect(
      /--pu-choice-count|segmented/i.test(formsCss),
      'forms.css is missing the segmented/choice hook',
    ).toBe(true);
    expect(navigationCss).toContain('local-steps-rail');

    const rail = block(coreCss, '.local-steps-rail');
    expect(rail).toContain('display: none');
    const pop = block(coreCss, '.local-counter-value-pop');
    expect(pop).toContain('display: inline');
    for (const [name, rule] of [['.local-steps-rail', rail], ['.local-counter-value-pop', pop]] as const) {
      expect(
        /(?:^|[;\s])(?:animation|transition|color|background|border|padding|margin)\s*:/i.test(rule),
        `${name} must stay default-neutral`,
      ).toBe(false);
    }
  });
});
