import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalStateFile } from '../src/local/runtime/state';
import { createShareableHtml } from '../src/shareable';
import type { LocalCompileOptions } from '../src/local/types';
import { prepareLocalPrintHtml, waitForLocalPrintImages } from '../src/export/print-document';

function compile(source: string, options: LocalCompileOptions = {}) {
  const result = compileLocal(source, options);
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  return result.document;
}

/** Engine envelope around a native document, exactly as the CLI builds it. */
function nativeEnvelope(source: string): string {
  const document = compile(source, { enableCss: true });
  return createShareableHtml({
    title: 'Print',
    source,
    state: createLocalStateFile(document, document.initialState),
    staticMarkup: '<article class="md-document"></article>',
    css: 'body { color: black; }',
    mode: 'static',
    compileOptions: { enableCss: true },
  });
}

describe('prepareLocalPrintHtml', () => {
  it('lifts a static native srcdoc body and its styles to the top-level page', () => {
    const source = '<!doctype html><html><head><style>.card{color:red}</style></head>'
      + '<body class="printable"><div class="card"><p>First</p><p>Second</p></div></body></html>';
    const html = nativeEnvelope(source);
    expect(html).toContain('reactive-md-native-frame');
    const prepared = prepareLocalPrintHtml(html);
    expect(prepared).toContain('First');
    expect(prepared).toContain('Second');
    expect(prepared).toContain('.card{color:red}');
    expect(prepared).not.toContain('reactive-md-native-frame');
    expect(prepared).not.toContain('srcdoc=');
    expect(prepared).toContain('<body class="printable">');
    expect(prepared).toContain('body { color: black; }');
  });

  it('returns ordinary HTML and non-engine frames byte-for-byte', () => {
    const document = compile('There are {{ 2 }} people.');
    const staticHtml = createShareableHtml({
      title: 'Markdown',
      source: document.source,
      state: createLocalStateFile(document, document.initialState),
      staticMarkup: '<article class="md-document"><p>There are 2 people.</p></article>',
      css: 'body { color: black; }',
      mode: 'static',
    });
    expect(prepareLocalPrintHtml(staticHtml)).toBe(staticHtml);

    const example = '<!doctype html><html><head></head><body><div class="reactive-md-native-document">'
      + '<iframe class="reactive-md-native-frame" sandbox="" srcdoc="<p>Example</p>"></iframe></div></body></html>';
    expect(prepareLocalPrintHtml(example)).toBe(example);

    // An engine shell whose frame is not the wrapper's only child stays intact.
    const html = nativeEnvelope('<!doctype html><html><body><p>Keep</p></body></html>');
    const nested = html.replace(
      '<div class="reactive-md-native-document">',
      '<div class="reactive-md-native-document"><p>Author sibling</p>',
    );
    expect(prepareLocalPrintHtml(nested)).toBe(nested);
  });

  it('drops scripts and remote resources that were never safe to print', () => {
    const shell = '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="reactive-md-html-format" content="reactive-md-html/v1">'
      + '<meta name="reactive-md-output" content="static"></head><body>'
      + '<div id="doc" class="reactive-md-export-root">'
      + '<div class="reactive-md-native-document">'
      + '<iframe class="reactive-md-native-frame" sandbox="" srcdoc="&lt;!doctype html&gt;&lt;html&gt;&lt;head&gt;'
      + '&lt;meta charset=&quot;utf-8&quot;&gt;&lt;meta http-equiv=&quot;Content-Security-Policy&quot; content=&quot;default-src &apos;none&apos;&quot;&gt;'
      + '&lt;style&gt;.kept{color:blue}&lt;/style&gt;&lt;/head&gt;&lt;body&gt;'
      + '&lt;p class=&quot;kept&quot;&gt;Visible&lt;/p&gt;&lt;script&gt;window.ran=true&lt;/script&gt;'
      + '&lt;link rel=&quot;stylesheet&quot; href=&quot;https://example.test/a.css&quot;&gt;'
      + '&lt;img src=&quot;https://example.test/a.png&quot; alt=&quot;Remote&quot;&gt;'
      + '&lt;img src=&quot;data:image/png;base64,AAAA&quot; alt=&quot;Inline&quot;&gt;'
      + '&lt;/body&gt;&lt;/html&gt;"></iframe></div></div></body></html>';
    const prepared = prepareLocalPrintHtml(shell);
    expect(prepared).toContain('Visible');
    expect(prepared).toContain('.kept{color:blue}');
    expect(prepared).toContain('base64,AAAA');
    expect(prepared).not.toContain('<script');
    expect(prepared).not.toContain('example.test');
    expect(prepared).not.toContain('srcdoc');
  });
});

describe('waitForLocalPrintImages', () => {
  function fakeDocument(images: { alt: string; decode: () => Promise<void> }[]) {
    return {
      images,
      fonts: { ready: Promise.resolve() },
    } as unknown as Document;
  }

  it('returns alt text for broken images and indices for empty alt', async () => {
    const broken = await waitForLocalPrintImages(fakeDocument([
      { alt: 'Revenue chart', decode: () => Promise.reject(new Error('broken')) },
      { alt: '', decode: () => Promise.resolve() },
      { alt: '', decode: () => Promise.reject(new Error('broken')) },
      { alt: 'data:image/png;base64,AAAA', decode: () => Promise.reject(new Error('broken')) },
      { alt: 'Second chart', decode: () => Promise.reject(new Error('broken')) },
    ]));
    expect(broken).toEqual(['Revenue chart', '#3', '#4', 'Second chart']);
  });

  it('returns nothing when every image decodes', async () => {
    expect(await waitForLocalPrintImages(fakeDocument([
      { alt: 'ok', decode: () => Promise.resolve() },
    ]))).toEqual([]);
  });

  it('never yields a source and stays usable without a document', async () => {
    const absent = await waitForLocalPrintImages(undefined);
    expect(absent).toEqual([]);
    const labeled = await waitForLocalPrintImages(fakeDocument([
      { alt: 'x'.repeat(400), decode: () => Promise.reject(new Error('broken')) },
    ]));
    expect(labeled).toHaveLength(1);
    expect(labeled[0].length).toBeLessThanOrEqual(120);
    expect(labeled[0].endsWith('...')).toBe(true);
  });
});
