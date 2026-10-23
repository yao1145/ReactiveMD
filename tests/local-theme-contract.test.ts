import { expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';

it('consumes a document theme declaration and preserves original body offsets', () => {
  const source = '<theme name="paper">\r\n\r\n# Title\r\n\r\n<counter bind="n" label="Count" initial="2">';
  const result = compileLocal(source);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.document).toMatchObject({ theme: 'paper', themeRange: { start: 0, end: 20 } });
  expect(result.document.nodes[0]).toMatchObject({ type: 'heading', range: { start: source.indexOf('# Title') } });
  expect(result.document.initialState.n).toBe(2);
  expect(result.document.nodes.some(node => node.name === 'theme')).toBe(false);
});

it('defaults old documents to the built-in theme', () => {
  const result = compileLocal('# Existing document');
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.document.theme).toBe('default');
});

it('keeps controls usable after an invalid or repeated theme declaration', () => {
  const result = compileLocal('<theme name="{{ x }}">\n<theme name="paper">\n\n<counter label="Count">');
  expect(result.ok).toBe(true);
  expect(result.diagnostics.some(item => item.code.startsWith('local.theme.') && item.severity === 'warning')).toBe(true);
  if (result.ok) {
    expect(result.document.theme).toBe('default');
    expect(result.document.nodes.some(node => node.name === 'counter')).toBe(true);
  }
});

it('leaves theme-looking syntax inside code literal', () => {
  const result = compileLocal('```md\n<theme name="paper">\n```\n\n`<theme name="paper">`');
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
  if (result.ok) expect(result.document.theme).toBe('default');
});

it('preserves following controls when a theme declaration lacks its closing bracket', () => {
  const result = compileLocal('<theme name="paper"\n<counter label="Count">');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.document.theme).toBe('default');
    expect(result.document.nodes.some(node => node.name === 'counter')).toBe(true);
  }
  expect(result.diagnostics.some(item => item.code === 'local.theme.malformed')).toBe(true);
});

it('keeps theme syntax and controls inside BOM-prefixed fenced code inert', () => {
  const source = '\uFEFF```md\n<theme name="paper">\n<counter bind="hidden" label="Hidden">\n```\n\n<counter bind="visible" label="Visible">';
  const result = compileLocal(source);
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
  if (result.ok) {
    expect(result.document.theme).toBe('default');
    expect(result.document.initialState).toEqual({ visible: 0 });
    expect(result.document.nodes.find(node => node.type === 'code')?.range.start).toBe(1);
  }
});

it('does not merge metadata into the first prose paragraph without a blank line', () => {
  const source = '<theme name="paper">\nBody text';
  const result = compileLocal(source);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.document.nodes).toHaveLength(1);
    expect(result.document.nodes[0]).toMatchObject({
      type: 'paragraph', range: { start: source.indexOf('Body') },
      children: [{ type: 'text', value: 'Body text' }],
    });
  }
});
