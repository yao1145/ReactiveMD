import { describe, expect, it } from 'vitest';
import { portableCompileOptions } from '../src/local/configuration/portable-options';
import { compileLocal } from '../src/local/compilation/compiler';
import { analyzeLocalSource } from '../src/local/source/authoring';
import { createLocalStateFile } from '../src/local/runtime/state';
import { parseMountPayload } from '../src/standalone/payload';
import { prepareStandaloneDocument } from '../src/standalone/prepare';
import { createShareableHtml } from '../src/shareable';
import type { LocalCompileOptions } from '../src/local/contracts/types';

/** One structural repair: the unclosed <card> is literal until the next heading. */
const RECOVERED_SOURCE = '<card>\n正文\n\n## 后续\n\n后文 **粗体**';

describe('portable strict semantics', () => {
  it('retains the selected mode in normalized and standalone payload options', () => {
    const options = { strict: false } as LocalCompileOptions;
    expect(portableCompileOptions(options)).toMatchObject({ strict: false });
    const compiled = compileLocal('# Title');
    if (!compiled.ok) throw new Error('Invalid fixture');
    const state = createLocalStateFile(compiled.document, {});
    const parsed = parseMountPayload({ version: 1, target: 'document', source: '# Title', state, compileOptions: options });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.payload.compileOptions).toMatchObject({ strict: false });
    const html = createShareableHtml({
      source: '# Title', state, title: 'Title', staticMarkup: '<article>Title</article>',
      css: '.md-document{}', mode: 'interactive', runtimeScript: 'void 0;', compileOptions: options,
    });
    expect(html).toContain('"strict":false');
  });

  it('rejects non-boolean strict instead of losing it during serialization', () => {
    expect(() => portableCompileOptions({ strict: 'false' } as unknown as LocalCompileOptions)).toThrow();
  });

  it('replays recovered source in standalone and keeps authoring inert', () => {
    const source = '<alert>\n<const name="hidden" value="{{ 1 }}">\n{{ missing }}\n\n## Next\n\n<counter bind="n" label="Count" initial="2">';
    const options = { strict: false } as LocalCompileOptions;
    const prepared = prepareStandaloneDocument(source, undefined, undefined, options);
    expect(prepared.document.bindings.n?.initial).toBe(2);
    expect(prepared.document.computations?.hidden).toBeUndefined();
    const analysis = analyzeLocalSource(source, options);
    expect(analysis.bindings.some(binding => binding.name === 'hidden' || binding.name === 'missing')).toBe(false);
    expect(analysis.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(false);
    expect(() => prepareStandaloneDocument(source)).toThrow();
  });
});

describe('recovered warning export', () => {
  const options: LocalCompileOptions = { strict: false };

  it('replays recovered source in standalone without turning warnings into failure', () => {
    const compiled = compileLocal(RECOVERED_SOURCE, options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.recoveries).toHaveLength(1);
    const recovery = compiled.recoveries?.[0];
    if (!recovery) return;
    const warning = compiled.diagnostics.find(item => item.code === recovery.code);
    expect(warning).toMatchObject({ severity: 'warning', range: recovery.causeRange });
    expect(compiled.diagnostics.some(item => item.severity === 'error')).toBe(false);

    const prepared = prepareStandaloneDocument(RECOVERED_SOURCE, undefined, undefined, options);
    expect(prepared.document.source).toBe(RECOVERED_SOURCE);
    expect(prepared.diagnostics).toEqual(compiled.diagnostics);
    expect(prepared.document.nodes.length).toBeGreaterThan(0);
    // Omitting the options keeps the strict default, so the same source fails.
    expect(() => prepareStandaloneDocument(RECOVERED_SOURCE)).toThrow();
  });

  it('keeps recovered compile options in the HTML payload and replays them', () => {
    expect(portableCompileOptions(options)).toMatchObject({ strict: false });
    const compiled = compileLocal(RECOVERED_SOURCE, options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const state = createLocalStateFile(compiled.document, {});
    const html = createShareableHtml({
      source: RECOVERED_SOURCE,
      state,
      title: 'Recovered',
      staticMarkup: '<article>Recovered</article>',
      css: '.md-document{}',
      mode: 'interactive',
      runtimeScript: 'void 0;',
      compileOptions: options,
    });
    expect(html).toContain('"strict":false');

    const script = /<script type="application\/reactive-md\+json" data-reactive-md-auto>([\s\S]*?)<\/script>/.exec(html);
    expect(script).not.toBeNull();
    if (!script) return;
    const parsed = parseMountPayload(JSON.parse(script[1]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.source).toBe(RECOVERED_SOURCE);
    expect(parsed.payload.compileOptions).toMatchObject({ strict: false });

    const replay = prepareStandaloneDocument(parsed.payload.source, undefined, undefined, parsed.payload.compileOptions);
    expect(replay.document.source).toBe(RECOVERED_SOURCE);
    expect(replay.diagnostics.some(item => item.severity === 'error')).toBe(false);
  });
});
