import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalStateFile } from 'reactive-md';
import { host } from '../extensions';
import { buildShareableHtml } from '../src/export-html';

const { config } = host;

describe('registered Demo extensions in static export', () => {
  it('uses the installed renderer, CSS and attribution without caller wiring', async () => {
    const source = '# External game\n\n<tetris width="8">';
    const compiled = compileLocal(source, { config });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const state = createLocalStateFile(compiled.document, {}, { name: 'test', version: '1' });
    const exported = await buildShareableHtml({ source, state, mode: 'static' });
    expect(exported.html).toContain('data-tetris-static');
    expect(exported.html).toContain('.local-document .rmd-tetris');
    expect(exported.html).toContain('original code written for this example');
    expect(exported.html).not.toMatch(/<script\b/);
  });
});
