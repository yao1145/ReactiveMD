import { describe, expect, it, vi } from 'vitest';
import { compileLocal, createLocalStateFile } from 'reactive-md';
import { buildShareableHtml } from '../src/export-html';
import { parseFragment } from 'parse5';

vi.mock('../../dist-library/reactive-md.css?raw', () => ({ default: '.md-document{}' }));
const elements = (n: any, tag: string): any[] => [...(n.tagName === tag ? [n] : []), ...(n.childNodes ?? []).flatMap((c: any) => elements(c, tag))];

describe('browser export of HTML tables', () => {
  it.each(['interactive', 'static'] as const)('preserves normalized merged cells and current state in %s output', async mode => {
    const source = '<counter bind="n" label="N" initial="2">\n\n<table><caption>Values</caption><tr><th colspan="2">Header</th></tr><tr><td>Current</td><td>{{ n }}</td></tr></table>';
    const compiled = compileLocal(source);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const state = createLocalStateFile(compiled.document, { n: 5 }, { name: 'test', version: '1' });
    const result = await buildShareableHtml({ source, state, mode });
    const tree = parseFragment(result.html);
    expect(elements(tree, 'table')).toHaveLength(1);
    expect(elements(tree, 'tbody')).toHaveLength(1);
    expect(elements(tree, 'th')[0].attrs).toContainEqual({ name: 'colspan', value: '2' });
    expect(result.html.includes('>5</span>')).toBe(true);
  });
});
