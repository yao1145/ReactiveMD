import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeLocalSource, compileLatex, compileLocal, completeLocalSource, formatLocalSource, renameLocalBinding } from '../src/local';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { createLocalRuntime } from '../src/local/runtime';

const examples = new URL('../examples/local/', import.meta.url);
const names = readdirSync(examples).filter(name => name.endsWith('.reactive.md') && name !== 'diagnostics.reactive.md');

function render(source: string) {
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error('Expected a compilable fixture');
  const runtime = createLocalRuntime(result.document);
  try { return renderToStaticMarkup(createElement(LocalDocumentView, { document: result.document, runtime })); }
  finally { runtime.dispose(); }
}

describe('author formatting preserves document behavior', () => {
  it.each(names)('preserves rendered content of %s', name => {
    const source = readFileSync(new URL(name, examples), 'utf8');
    const formatted = formatLocalSource(source);
    expect(render(formatted)).toBe(render(source));
    expect(formatLocalSource(formatted)).toBe(formatted);
  });

  it('retains CRLF, Markdown hard breaks, code, math and fallback bytes', () => {
    const source = [
      '<number   bind="count"  label="Count">', '',
      'A hard break.  ', 'Next line with $count$ and **{{ count }}**.', '',
      '`<number  bind="literal" label="Code">`', '',
      '<future><number  bind="inert" label="Fallback">{{ count }}</future>', '',
      '$$ count \\cdot x $$', '',
    ].join('\r\n');
    const formatted = formatLocalSource(source);
    expect(formatted.slice(formatted.indexOf('\r\n'))).toBe(source.slice(source.indexOf('\r\n')));
    expect(render(formatted)).toBe(render(source));
  });

  it('renames actual plot reads while preserving the curve', () => {
    const source = '<number bind="a" label="Amplitude">\n\n<plot label="Curve">\n$$ y = a x $$\n</plot>';
    expect(compileLocal(source).ok).toBe(true);
    const renamed = renameLocalBinding(source, 'a', 'amplitude');
    expect(compileLocal(renamed.source).ok, renamed.source).toBe(true);
    expect(renamed.source).toContain('y = \\mathrm{amplitude} x');
    expect(compileLatex('y = \\mathrm{amplitude} x').evaluate(2, { amplitude: 3 })).toBe(6);
  });

  it('renames Greek, mathrm and adjacent single-letter plot reads without touching comments or display math', () => {
    const source = [
      '<number bind="alpha" label="Alpha">', '<number bind="a" label="A">',
      '$alpha + a$', '<plot label="Curve">',
      '$$ y = \\alpha + \\mathrm{alpha} + ax % alpha a', '$$', '</plot>',
    ].join('\n');
    expect(compileLocal(source).ok).toBe(true);
    expect(analyzeLocalSource(source).bindings.find(binding => binding.name === 'alpha')?.references).toHaveLength(2);
    const greek = renameLocalBinding(source, 'alpha', 'scale');
    const letter = renameLocalBinding(greek.source, 'a', 'offset');
    expect(compileLocal(letter.source).ok, letter.source).toBe(true);
    expect(letter.source).toContain('$alpha + a$');
    expect(letter.source).toContain('% alpha a');
    expect(letter.source).toContain('\\mathrm{scale} + \\mathrm{scale} + \\mathrm{offset}x');
  });

  it('protects decoded attribute strings and returns original reference offsets', () => {
    const source = '<input bind="name" label="{{ &quot;name }}&quot; + name }}">';
    expect(compileLocal(source).ok).toBe(true);
    const analysis = analyzeLocalSource(source);
    expect(analysis.bindings[0].references).toEqual([{ start: source.lastIndexOf('name'), end: source.lastIndexOf('name') + 4 }]);
    const renamed = renameLocalBinding(source, 'name', 'title');
    expect(renamed.source).toContain('&quot;name }}&quot; + title');
    expect(compileLocal(renamed.source).ok).toBe(true);
  });

  it('suppresses completion inside comments and unfinished literal regions', () => {
    for (const source of ['<!-- <sli -->', '<!-- <sli', '```text\n<sli', '`<sli`']) {
      const offset = source.indexOf('sli') + 3;
      expect(completeLocalSource(source, offset), source).toEqual([]);
    }
  });
});
