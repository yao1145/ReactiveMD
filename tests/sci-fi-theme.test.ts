import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defineLocalTheme } from '../src/sdk/theme';
import { LOCAL_STYLE_LAYER_ORDER } from '../src/themes/contract';

const tokensCss = readFileSync(new URL('../examples/sci-fi-theme/src/tokens.css', import.meta.url), 'utf8');
const componentsCss = readFileSync(new URL('../examples/sci-fi-theme/src/components.css', import.meta.url), 'utf8');

const ROOT = '[data-rmd-theme="sci-fi"]';
const DARK = '[data-rmd-theme="sci-fi"][data-color-scheme="dark"]';

/** Every rule, including rules nested in @media, must start at the theme root. */
function assertScoped(css: string): void {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const check = (body: string) => {
    let prelude = '';
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];
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
        check(inner);
      } else {
        for (const selector of head.split(',')) {
          expect(selector.trim().startsWith(ROOT), `unscoped selector: ${selector.trim()}`).toBe(true);
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

const PAIRS: readonly [string, string, number][] = [
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

const COMPONENT_TOKENS = [
  'sf-panel-bg',
  'sf-panel-head-bg',
  'sf-table-head-bg',
  'sf-table-row-selected',
  'sf-field-bg',
  'sf-field-border',
  'sf-nav-bg',
  'sf-nav-active-bg',
  'sf-chart-frame',
  'sf-corner-ink',
  'sf-glow',
] as const;

describe('sci-fi theme package', () => {
  it('bootstraps the same public cascade for direct CSS imports', () => {
    for (const css of [tokensCss, componentsCss]) {
      expect(css.startsWith(LOCAL_STYLE_LAYER_ORDER)).toBe(true);
      expect(css).toContain('@layer rmd.themes {');
    }
  });
  it('scopes every rule to the sci-fi document root', () => {
    assertScoped(tokensCss);
    assertScoped(componentsCss);
  });

  it('validates through the public theme contract', () => {
    const theme = defineLocalTheme({
      id: 'reactive-md/theme-sci-fi',
      name: 'sci-fi',
      version: '1.0.0',
      colorSchemes: ['light', 'dark'],
      css: [
        { id: 'tokens.css', css: tokensCss },
        { id: 'components.css', css: componentsCss },
      ],
    });
    expect(theme.name).toBe('sci-fi');
    expect(theme.colorSchemes).toEqual(['light', 'dark']);
    expect(theme.css).toHaveLength(2);
    expect(theme.css.every((resource) => resource.css.includes(ROOT))).toBe(true);
    expect(theme.css.every((resource) => !/@import|url\(\s*['\"]?https?:/i.test(resource.css))).toBe(true);
  });

  it('defines the full light and dark semantic contract', () => {
    for (const selector of [ROOT, DARK]) {
      const scope = block(tokensCss, selector);
      const root = block(tokensCss, ROOT);
      for (const name of ['surface', 'ink', 'line', 'accent', 'accent-ink', 'focus', 'chart-1', 'code-bg', 'radius-panel', 'radius-field']) {
        expect(token(scope, name) ?? token(root, name), `${selector} is missing --${name}`).toBeTruthy();
      }
      for (const name of COMPONENT_TOKENS) {
        expect(token(scope, name) ?? token(root, name), `${selector} is missing --${name}`).toBeTruthy();
      }
    }
  });

  it('meets the stated contrast floors in both modes', () => {
    for (const selector of [ROOT, DARK]) {
      const scope = block(tokensCss, selector);
      for (const [foreground, background, floor] of PAIRS) {
        const ratio = contrast(resolve(foreground, scope), resolve(background, scope));
        expect(ratio, `${selector}: --${foreground} on --${background} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('keeps the radius contract at or below 4px and spacing on the 4px grid', () => {
    const radius = block(tokensCss, ROOT);
    for (const name of ['sf-radius-1', 'sf-radius-2', 'radius-control', 'radius-card', 'radius-panel', 'radius-pill', 'radius-field']) {
      const px = Number.parseFloat(resolve(name, radius));
      expect(Number.isFinite(px), `--${name}`).toBe(true);
      expect(px, `--${name}`).toBeLessThanOrEqual(4);
    }
    for (let step = 1; step <= 7; step += 1) {
      const px = Number.parseFloat(resolve(`space-${step}`, radius));
      expect(px % 4, `--space-${step}`).toBe(0);
    }
  });
});
