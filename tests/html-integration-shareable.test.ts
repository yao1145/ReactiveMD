import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalStateFile } from '../src/local/state';
import type {
  LocalCompileOptions,
  LocalDocument,
  LocalHtmlOptions,
  LocalHtmlPolicy,
} from '../src/index';
import { createShareableHtml } from '../src/shareable';
import { ReactiveMDMountError } from '../src/standalone/diagnostics';
import { parseMountPayload } from '../src/standalone/payload';
import { prepareStandaloneDocument } from '../src/standalone/prepare';

const NATIVE_SOURCE = '<p>Native HTML</p><script>window.authorRan = true</script>';
const DEFAULT_SOURCE = '# Safe route';

function compileOk(source: string, options?: LocalCompileOptions): LocalDocument {
  const result = compileLocal(source, options);
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  return result.document;
}

function stateOf(document: LocalDocument) {
  return createLocalStateFile(document, {}, { name: 'integration-test', version: '0.0.0' });
}

function payloadScript(html: string): Record<string, unknown> {
  const match = /<script type="application\/reactive-md\+json" data-reactive-md-auto>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('Missing auto-mount payload.');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const document = compileOk(DEFAULT_SOURCE);
  return {
    version: 1,
    target: 'reactive-md-document',
    source: DEFAULT_SOURCE,
    state: stateOf(document),
    locale: 'en',
    colorScheme: 'auto',
    hydrate: true,
    ...overrides,
  };
}

describe('exported HTML capability types', () => {
  it('exports LocalHtmlOptions and LocalHtmlPolicy from the core index', () => {
    const flags: LocalHtmlOptions = { enableCss: false, enableJavaScript: false, enableExtendedHtml: false };
    const policy: LocalHtmlPolicy = {
      enableCss: flags.enableCss === true,
      enableJavaScript: flags.enableJavaScript === true,
      enableExtendedHtml: flags.enableExtendedHtml === true,
    };
    expect(policy).toEqual({ enableCss: false, enableJavaScript: false, enableExtendedHtml: false });
  });
});

describe('native HTML shareable envelope', () => {
  it('preserves native routing options in the interactive payload and permits the srcdoc frame', () => {
    const options: LocalCompileOptions = {
      enableCss: true,
      enableJavaScript: true,
      limits: { maxSyntaxNodes: 500 },
    };
    const document = compileOk('<style>p{color:red}</style><p>Native</p>', options);
    const html = createShareableHtml({
      title: 'Native export',
      source: document.source,
      state: stateOf(document),
      staticMarkup: '<article class="md-document"></article>',
      css: 'body{}',
      mode: 'interactive',
      runtimeScript: 'globalThis.mounted = true;',
      compileOptions: options,
    });

    expect(html).toContain('frame-src about:');
    expect(html).toContain('application/reactive-md+json');
    expect(payloadScript(html).compileOptions).toEqual({
      enableCss: true,
      enableJavaScript: true,
      enableExtendedHtml: false,
      limits: { maxSyntaxNodes: 500 },
    });
  });

  it('round-trips parser work and Markdown depth budgets into standalone preparation', () => {
    const options: LocalCompileOptions = {
      limits: { maxSyntaxNodes: 500, maxParseWork: 123_456, maxMarkdownDepth: 17 },
    };
    const document = compileOk(DEFAULT_SOURCE, options);
    const html = createShareableHtml({
      title: 'Budget export',
      source: DEFAULT_SOURCE,
      state: stateOf(document),
      staticMarkup: '<article class="md-document"></article>',
      css: 'body{}',
      mode: 'interactive',
      runtimeScript: 'globalThis.mounted = true;',
      compileOptions: options,
    });
    const parsed = parseMountPayload(payloadScript(html));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.compileOptions).toEqual({
      enableCss: false,
      enableJavaScript: false,
      enableExtendedHtml: false,
      limits: { maxSyntaxNodes: 500, maxParseWork: 123_456, maxMarkdownDepth: 17 },
    });
    const prepared = prepareStandaloneDocument(
      parsed.payload.source,
      parsed.payload.state,
      undefined,
      parsed.payload.compileOptions,
    );
    expect(prepared.document.source).toBe(DEFAULT_SOURCE);
  });

  it('regenerates a script-free native frame for a static JavaScript-only document', () => {
    const options: LocalCompileOptions = { enableJavaScript: true };
    const document = compileOk(NATIVE_SOURCE, options);
    const hostileMarkup = [
      '<article data-host="1">',
      '<iframe sandbox="allow-scripts allow-same-origin" srcdoc="&lt;script&gt;window.authorRan=true&lt;/script&gt;"></iframe>',
      '<script>window.hostRan = true</script>',
      '</article>',
    ].join('');

    const html = createShareableHtml({
      title: 'Static native export',
      source: NATIVE_SOURCE,
      state: stateOf(document),
      staticMarkup: hostileMarkup,
      css: 'body{}',
      mode: 'static',
      compileOptions: options,
    });

    // Native routing survives even though the effective static policy has no
    // capabilities enabled at all.
    expect(html).toContain('<iframe');
    expect(html).toContain('frame-src about:');
    expect(html).toContain('reactive-md-output" content="static"');
    // The caller's wrapper is kept, but its scripts and unsafe srcdoc are not.
    expect(html).toContain('data-host="1"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('allow-scripts');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('Native HTML');
    expect(html).not.toContain('reactive-md+json');
  });

  it('generates its own frame when static markup has none', () => {
    const options: LocalCompileOptions = { enableExtendedHtml: true };
    const document = compileOk('<p>Native</p>', options);
    const html = createShareableHtml({
      title: 'Static native export',
      source: '<p>Native</p>',
      state: stateOf(document),
      staticMarkup: '<article data-host="wrapped"></article>',
      css: 'body{}',
      mode: 'static',
      compileOptions: options,
    });

    expect(html).toContain('reactive-md-native-document');
    expect(html).toContain('<iframe');
    expect(html).toContain('sandbox="allow-forms"');
    expect(html).toContain('frame-src about:');
  });

  it('does not inherit disabled base and form policies into an extended native export', () => {
    const options: LocalCompileOptions = { enableExtendedHtml: true };
    const source = '<base href="https://forms.example.test/"><form action="/submit"><button>Submit</button></form>';
    const document = compileOk(source, options);
    const html = createShareableHtml({ title: 'Forms', source, state: stateOf(document), staticMarkup: '<article></article>', css: 'body{}', mode: 'static', compileOptions: options });
    expect(html).toContain('base-uri &#39;self&#39; http: https:');
    expect(html).toContain('form-action http: https:');
    expect(html).not.toContain('base-uri &#39;none&#39;');
    expect(html).not.toContain('form-action &#39;none&#39;');
  });

  it('keeps the default ReactiveMD export unchanged and frame-free', () => {
    const document = compileOk(DEFAULT_SOURCE);
    const sentinel = '<article class="md-document"><p>Sentinel</p></article>';
    const html = createShareableHtml({
      title: 'Default export',
      source: DEFAULT_SOURCE,
      state: stateOf(document),
      staticMarkup: sentinel,
      css: 'body{}',
      mode: 'static',
    });

    expect(html).toContain(sentinel);
    expect(html).toContain('frame-src &#39;none&#39;');
    expect(html).not.toContain('compileOptions');
    expect(html).not.toContain('<iframe');
  });

  it('rejects invalid compile options instead of exporting them', () => {
    const document = compileOk(DEFAULT_SOURCE);
    expect(() => createShareableHtml({
      title: 'Invalid',
      source: DEFAULT_SOURCE,
      state: stateOf(document),
      staticMarkup: '<article></article>',
      css: 'body{}',
      mode: 'static',
      compileOptions: { enableCss: 'yes' } as unknown as LocalCompileOptions,
    })).toThrow(/compileOptions/);
  });
});

describe('shareable payload compile options', () => {
  it('accepts and normalizes only the known flags and limits', () => {
    const result = parseMountPayload(validPayload({
      compileOptions: {
        enableCss: true,
        enableExtendedHtml: false,
        limits: { maxSyntaxNodes: 7 },
        ignored: 'drop me',
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.compileOptions).toEqual({
      enableCss: true,
      enableJavaScript: false,
      enableExtendedHtml: false,
      limits: { maxSyntaxNodes: 7 },
    });
  });

  it('rejects invalid flags, limits and shapes at the parse boundary', () => {
    const invalid: unknown[] = [
      { enableCss: 'yes' },
      { enableJavaScript: 1 },
      { enableExtendedHtml: null },
      { limits: { maxSyntaxNodes: 0 } },
      { limits: { maxSyntaxNodes: 1.5 } },
      { limits: { maxParseWork: 0 } },
      { limits: { maxMarkdownDepth: 1.5 } },
      { limits: [] },
      [],
      'css',
    ];
    for (const compileOptions of invalid) {
      expect(parseMountPayload(validPayload({ compileOptions })).ok).toBe(false);
    }
  });

  it('never infers capabilities from source tags or parameter state', () => {
    const document = compileOk(DEFAULT_SOURCE);
    const result = parseMountPayload(validPayload({
      source: '<p>Native</p><script>window.authorRan = true</script>',
      state: { ...stateOf(document), enableJavaScript: true },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.compileOptions).toBeUndefined();
  });
});

describe('standalone preparation with compile options', () => {
  it('recompiles the document with the replayed flags', () => {
    const prepared = prepareStandaloneDocument(
      '<p>Native HTML</p>',
      undefined,
      undefined,
      { enableExtendedHtml: true },
    );
    expect(prepared.document.html).toEqual({
      enableCss: false,
      enableJavaScript: false,
      enableExtendedHtml: true,
    });
    expect(prepared.document.bindings).toEqual({});
  });

  it('keeps the default route when options are omitted', () => {
    const prepared = prepareStandaloneDocument(DEFAULT_SOURCE);
    expect(prepared.document.html).toBeUndefined();
  });

  it('rejects invalid compile options before mounting', () => {
    expect(() => prepareStandaloneDocument(
      DEFAULT_SOURCE,
      undefined,
      undefined,
      { enableCss: 'yes' } as unknown as LocalCompileOptions,
    )).toThrow(ReactiveMDMountError);
  });
});
