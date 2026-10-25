import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileLocal, createLocalStateFile, type LocalCompileOptions } from 'reactive-md';
import { buildShareableHtml } from '../src/export-html';

const spies = vi.hoisted(() => ({
  compileLocal: vi.fn(),
  createShareableHtml: vi.fn(),
}));

vi.mock('react-dom/server', () => ({
  renderToString: () => '<article data-test="static"></article>',
}));

// Vitest's CSS loader is inert; this unit checks option transport. The browser
// acceptance opens a real exported file with the generated stylesheet/runtime.
vi.mock('../../dist-library/reactive-md.css?raw', () => ({ default: 'body{}' }));

vi.mock('reactive-md', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactive-md')>();
  return {
    ...actual,
    compileLocal: (
      source: string,
      options?: Parameters<typeof actual.compileLocal>[1],
    ) => {
      spies.compileLocal(source, options);
      return actual.compileLocal(source, options);
    },
    createShareableHtml: (options: Parameters<typeof actual.createShareableHtml>[0]) => {
      spies.createShareableHtml(options);
      return actual.createShareableHtml(options);
    },
  };
});

const SOURCE = '<p>Native HTML export</p>';
const COMPILE_OPTIONS: LocalCompileOptions = {
  enableCss: true,
  enableExtendedHtml: true,
};

describe('shareable HTML build option propagation', () => {
  beforeEach(() => {
    spies.compileLocal.mockClear();
    spies.createShareableHtml.mockClear();
  });

  it('uses the same compile options for the document and the HTML envelope', async () => {
    const initial = compileLocal(SOURCE, COMPILE_OPTIONS);
    if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
    const state = createLocalStateFile(
      initial.document,
      {},
      { name: 'demo-test', version: '0.0.0' },
    );
    spies.compileLocal.mockClear();

    const result = await buildShareableHtml({
      source: SOURCE,
      state,
      mode: 'static',
      locale: 'en',
      colorScheme: 'light',
      compileOptions: COMPILE_OPTIONS,
    });

    expect(spies.compileLocal).toHaveBeenLastCalledWith(SOURCE, COMPILE_OPTIONS);
    expect(spies.createShareableHtml).toHaveBeenCalledTimes(1);
    const envelope = spies.createShareableHtml.mock.calls[0][0] as {
      compileOptions?: LocalCompileOptions;
    };
    expect(envelope.compileOptions).toEqual(COMPILE_OPTIONS);
    expect(result.html).toContain('reactive-md-html-format');
  });

  it('leaves the compile options undefined for the default ReactiveMD route', async () => {
    const initial = compileLocal('# Safe route');
    if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
    const state = createLocalStateFile(
      initial.document,
      {},
      { name: 'demo-test', version: '0.0.0' },
    );
    spies.compileLocal.mockClear();

    await buildShareableHtml({
      source: '# Safe route',
      state,
      mode: 'static',
      locale: 'en',
      colorScheme: 'light',
    });

    expect(spies.compileLocal).toHaveBeenLastCalledWith('# Safe route', undefined);
    const envelope = spies.createShareableHtml.mock.calls[0][0] as {
      compileOptions?: LocalCompileOptions;
    };
    expect(envelope.compileOptions).toBeUndefined();
  });
});
