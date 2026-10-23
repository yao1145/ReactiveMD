import { describe, expect, it } from 'vitest';
import { parseLocal } from '../src/local/parser';
import { compileLocal } from '../src/local/compiler';
import {
  DEFAULT_LOCAL_THEME,
  LOCAL_THEME_PROTOCOL,
  resolveLocalTheme,
  type LocalThemeDefinition,
} from '../src/local/theme';
import type { LocalNode } from '../src/local/types';

const flat = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap((node) => [node, ...flat(node.children ?? [])]);

const paper: LocalThemeDefinition = {
  name: 'paper',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: ['light', 'dark'],
};

function compiled(source: string) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(`Expected a successful compile: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

describe('document theme metadata', () => {
  it('consumes a leading declaration while preserving CRLF source offsets', () => {
    const source = '<theme name="paper">\r\n\r\n# Title\r\n\r\n<counter bind="n" label="Count" initial="2">';
    const result = compiled(source);

    expect(result.document.theme).toBe('paper');
    expect(result.document.themeRange).toEqual({ start: 0, end: '<theme name="paper">'.length });
    expect(result.document.nodes[0]).toMatchObject({
      type: 'heading',
      range: { start: source.indexOf('# Title') },
    });
    expect(result.document.initialState.n).toBe(2);
    expect(flat(result.document.nodes).some((node) => node.name === 'theme')).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts a self-closing declaration after a BOM, whitespace and comments', () => {
    const bom = String.fromCharCode(0xfeff);
    const source = `${bom}  <!-- note -->\r\n  <theme name="paper" />\r\n\r\n<counter label="Count">`;
    const parsed = parseLocal(source);

    expect(parsed.theme).toBe('paper');
    expect(parsed.diagnostics).toEqual([]);
    const tagStart = source.indexOf('<theme');
    expect(parsed.themeRange).toEqual({ start: tagStart, end: tagStart + '<theme name="paper" />'.length });
    expect(flat(parsed.nodes).find((node) => node.name === 'counter')?.range.start)
      .toBe(source.indexOf('<counter'));
  });

  it('defaults old documents and hand-built documents to the built-in theme', () => {
    const result = compiled('# Existing document');
    expect(result.document.theme).toBe(DEFAULT_LOCAL_THEME.name);
    expect(result.document.themeRange).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps the first declaration only and keeps controls usable after invalid or repeated headers', () => {
    const source = '<theme name="{{ x }}">\n<theme name="paper">\n\n<counter label="Count">';
    const result = compiled(source);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('local.theme.expression');
    expect(codes).toContain('local.theme.duplicate');
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
    expect(result.document.theme).toBe('default');
    expect(flat(result.document.nodes).some((node) => node.name === 'counter')).toBe(true);
  });

  it('warns for malformed leading declarations without stopping the body', () => {
    for (const header of [
      '<theme>',
      '<theme name=paper>',
      '<theme name="Paper">',
      '<theme name="paper" tone="warm">',
      '<theme name="paper"> trailing text',
    ]) {
      const result = compiled(`${header}\n\n<counter label="Count">`);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith('local.theme.'))).toBe(true);
      expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
      expect(result.document.theme).toBe('default');
      expect(flat(result.document.nodes).some((node) => node.name === 'counter')).toBe(true);
    }
  });

  it('leaves declarations in code, escapes and comments literal without diagnostics', () => {
    const source = '`<theme name="paper">`\n\n```md\n<theme name="paper">\n```\n\n\\<theme name="paper">\n\n<!-- <theme name="paper"> -->\n\n<counter label="Count">';
    const result = compiled(source);

    expect(result.document.theme).toBe('default');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('local.theme.'))).toEqual([]);
    expect(flat(result.document.nodes).some((node) => node.name === 'counter')).toBe(true);
  });

  it('treats late and nested declarations as inert warnings', () => {
    const late = compiled('# Title\n\n<theme name="paper">\n\n<counter label="Late">');
    expect(late.document.theme).toBe('default');
    expect(late.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.theme.late');
    expect(flat(late.document.nodes).some((node) => node.name === 'counter')).toBe(true);

    const nested = compiled('<panel title="P">\n<theme name="paper">\n<counter label="Nested">\n</panel>');
    expect(nested.document.theme).toBe('default');
    expect(nested.diagnostics.map((diagnostic) => diagnostic.code)).toContain('local.theme.nested');
    expect(flat(nested.document.nodes).some((node) => node.name === 'counter')).toBe(true);
  });

  it('does not treat an unregistered name as a compilation error', () => {
    const result = compiled('<theme name="ghost-theme">\n\n<counter label="Count">');
    expect(result.document.theme).toBe('ghost-theme');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });
});

describe('resolveLocalTheme', () => {
  it('returns the selected registered theme without diagnostics', () => {
    expect(resolveLocalTheme('paper', [paper])).toEqual({ name: 'paper', diagnostics: [] });
    expect(resolveLocalTheme('paper', [paper], { start: 0, end: 20 }, '<theme name="paper">')).toEqual({
      name: 'paper',
      diagnostics: [],
    });
  });

  it('silently uses the built-in theme when nothing is selected', () => {
    expect(resolveLocalTheme()).toEqual({ name: 'default', diagnostics: [] });
    expect(resolveLocalTheme('', [])).toEqual({ name: 'default', diagnostics: [] });
    expect(resolveLocalTheme('default', [])).toEqual({ name: 'default', diagnostics: [] });
  });

  it('warns and falls back for missing, duplicate, invalid or unsupported manifests', () => {
    const cases: Array<{ result: ReturnType<typeof resolveLocalTheme>; code: string }> = [
      {
        result: resolveLocalTheme('missing', [paper]),
        code: 'local.theme.missing',
      },
      {
        result: resolveLocalTheme('paper', [paper, { ...paper }]),
        code: 'local.theme.duplicate',
      },
      {
        result: resolveLocalTheme('paper', [{ ...paper, protocol: 'other' } as unknown as LocalThemeDefinition]),
        code: 'local.theme.protocol',
      },
      {
        result: resolveLocalTheme('paper', [{ ...paper, colorSchemes: ['light'] } as unknown as LocalThemeDefinition]),
        code: 'local.theme.modes',
      },
      {
        result: resolveLocalTheme('paper', undefined),
        code: 'local.theme.missing',
      },
    ];

    for (const { result, code } of cases) {
      expect(result.name).toBe('default');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({ code, severity: 'warning' });
    }
  });

  it('rejects malformed identifiers and never throws on malformed host input', () => {
    expect(resolveLocalTheme('Paper').diagnostics[0]?.code).toBe('local.theme.name');
    expect(resolveLocalTheme('a--b').diagnostics[0]?.code).toBe('local.theme.name');
    expect(resolveLocalTheme(5 as unknown as string).diagnostics[0]?.code).toBe('local.theme.name');
    expect(() => resolveLocalTheme('paper', [null, 3, 'x'] as unknown as LocalThemeDefinition[])).not.toThrow();
    expect(() => resolveLocalTheme('paper', { length: 1 } as unknown as LocalThemeDefinition[])).not.toThrow();
    expect(resolveLocalTheme('paper', [null, 3, 'x'] as unknown as LocalThemeDefinition[]).name).toBe('default');
  });

  it('points diagnostics at the document theme range when available', () => {
    const source = '\n<theme name="missing">\n\n# Title';
    const result = compiled(source);
    const range = result.document.themeRange;
    expect(range).toBeDefined();

    const resolution = resolveLocalTheme(result.document.theme, [], range, source);
    expect(resolution.name).toBe('default');
    expect(resolution.diagnostics[0]).toMatchObject({
      code: 'local.theme.missing',
      range,
      line: 2,
      column: 1,
    });
  });
});
