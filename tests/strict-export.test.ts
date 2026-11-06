import { describe, expect, it } from 'vitest';
import { portableCompileOptions } from '../src/local/configuration/portable-options';
import { compileLocal } from '../src/local/compilation/compiler';
import { analyzeLocalSource } from '../src/local/source/authoring';
import { createLocalStateFile } from '../src/local/runtime/state';
import { parseMountPayload } from '../src/standalone/payload';
import { prepareStandaloneDocument } from '../src/standalone/prepare';
import { createShareableHtml } from '../src/shareable';
import type { LocalCompileOptions } from '../src/local/contracts/types';

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
