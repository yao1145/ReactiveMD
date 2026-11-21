import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { compileLocal, createLocalRuntime } from '../../src/local';
import { LocalDocumentView, LocalReactiveDocument } from '../../src/local/rendering/document/LocalDocumentView';
import { createLocalStateFile } from '../../src/local/runtime/state';
import { createShareableHtml } from '../../src/shareable';
import type { LocalHtmlPolicy } from '../../src/local/types';
import '../../src/local/rendering/document/local.css';

const SOURCE = [
  '<css>',
  'h2 { color: #24549a; }',
  '</css>',
  '',
  '## People',
  '',
  '<slider bind="people" label="People" initial="2" min="1" max="20" css="max-width: 24rem; margin-block: 1rem; margin-left: 1px; margin: 2px; margin-left: 3px">',
  '',
  'People: {{ people }}',
  '',
  'Before <iframe title="Example" srcdoc="<p>Embedded example</p>"></iframe> after.',
  '',
  '<dl><dt>Example term</dt><dd>Example definition</dd></dl>',
  '',
  '<javascript>',
  'await rmd.set("people", 10);',
  '</javascript>',
].join('\n');

const ACTIONS = [
  '<counter bind="a" label="First" initial="2" action-id="first">',
  '<counter bind="b" label="Second" initial="5" action-id="second">',
  '',
  'Counters: {{ a }} and {{ b }}',
  '',
  '<javascript>',
  'await rmd.set("a", 2);',
  'rmd.handleAction("first", "increment", async () => { await rmd.set("a", await rmd.get("a") + 2); });',
  'rmd.observeAction("second", "increment", () => {});',
  '</javascript>',
].join('\n');

const root = createRoot(document.getElementById('root')!);
const diagnostics: string[] = [];
const onDiagnostics = (items: readonly { message: string }[]) => diagnostics.push(...items.map(item => item.message));
const compile = (source: string, policy?: LocalHtmlPolicy) => {
  const result = compileLocal(source, policy);
  if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
  return result.document;
};
const actionPolicy = { enableCss: true, enableJavaScript: true, enableExtendedHtml: false };
const precompiled = compile(SOURCE, actionPolicy);
const first = createLocalRuntime(precompiled);
const second = createLocalRuntime(precompiled);
const pausedRuntime = createLocalRuntime(precompiled);
const standaloneRuntime = await fetch('/dist-standalone/reactive-md-standalone.js').then(response => response.text());
const generator = { name: 'test', version: '1.0.0' };

Object.assign(window, {
  rmdCapabilities: {
    render(policy: LocalHtmlPolicy, key?: string) {
      root.render(<LocalReactiveDocument key={key} source={SOURCE} compileOptions={policy} onDiagnostics={onDiagnostics} />);
    },
    actions(enableJavaScript: boolean, edit?: 'add' | 'remove' | 'restore') {
      const source = edit === 'add'
        ? '<counter bind="c" label="Third" initial="0" action-id="third">\n' + ACTIONS
        : edit === 'remove' ? ACTIONS.replace(' action-id="first"', '')
          : edit === 'restore' ? ACTIONS + '\n\nOriginal action restored.' : ACTIONS;
      root.render(<LocalReactiveDocument key="actions" source={source} compileOptions={actionPolicy}
        capabilityGrants={{ enableJavaScript }} onDiagnostics={onDiagnostics} />);
    },
    twoViews(enableJavaScript: boolean) {
      root.render(<>
        <div id="allowed"><LocalDocumentView document={precompiled} runtime={first}
          capabilityGrants={{ enableJavaScript }} onDiagnostics={onDiagnostics} /></div>
        <div id="denied"><LocalDocumentView document={precompiled} runtime={second} onDiagnostics={onDiagnostics} /></div>
      </>);
    },
    pausedView(paused: boolean) {
      root.render(<div id="paused-view"><LocalDocumentView document={precompiled} runtime={pausedRuntime}
        capabilityGrants={{ enableJavaScript: true }} authorScriptPaused={paused} onDiagnostics={onDiagnostics} /></div>);
    },
    nested() {
      const outer = compile([
        '<css>', ':scope { color: rgb(21, 44, 79); font-family: monospace; --outer-accent: violet; }',
        'h2 { background-color: rgb(5, 7, 11); }', '</css>', '',
        '## Outer',
      ].join('\n'));
      const inner = compile('## Inner');
      const outerRuntime = createLocalRuntime(outer);
      const innerRuntime = createLocalRuntime(inner);
      const innerView = <LocalDocumentView document={inner} runtime={innerRuntime} capabilityGrants={{ enableCss: false }} />;
      root.render(<div id="nested-result" ref={element => {
        // An explicitly nested mount exercises DOM inheritance independently
        // of the React tree and uses a separate document runtime.
        const article = element?.querySelector('article');
        if (article && !article.querySelector('#nested-document')) {
          const target = document.createElement('div');
          target.id = 'nested-document';
          article.append(target);
          createRoot(target).render(innerView);
        }
      }}><LocalDocumentView document={outer} runtime={outerRuntime} /></div>);
    },
    exportHtml(policy: LocalHtmlPolicy, value: number, mode: 'interactive' | 'static') {
      const document = compile(SOURCE, policy);
      const runtime = createLocalRuntime(document);
      try {
        runtime.setParameter('people', value);
        const state = createLocalStateFile(document, runtime.snapshot().state, generator);
        return createShareableHtml({
          title: 'Document capability export', source: SOURCE, state,
          staticMarkup: renderToString(<LocalDocumentView document={document} runtime={runtime} mode="static" capabilityGrants={policy} />),
          css: '.md-document{display:block}', mode, runtimeScript: standaloneRuntime, compileOptions: policy,
        });
      } finally {
        runtime.dispose();
      }
    },
    legacyExport(nativeCss: boolean) {
      const source = '<p>Legacy content</p>\n\n<slider bind="people" label="People" initial="2">\n\nPeople: {{ people }}';
      const document = compile(source);
      const state = createLocalStateFile(
        nativeCss ? { ...document, bindings: {}, initialState: {} } : document,
        nativeCss ? {} : { people: 7 },
        generator,
      );
      const html = createShareableHtml({
        title: 'Legacy payload', source, state, staticMarkup: '<article class="md-document"></article>',
        css: '.md-document{display:block}', mode: 'interactive',
        runtimeScript: standaloneRuntime,
      });
      const tree = new DOMParser().parseFromString(html, 'text/html');
      const script = tree.querySelector('script[type="application/reactive-md+json"]')!;
      const payload = JSON.parse(script.textContent!);
      delete payload.sourceSemantics;
      delete payload.compileOptions;
      payload.hydrate = false;
      if (nativeCss) {
        payload.compileOptions = { enableCss: true, enableJavaScript: false, enableExtendedHtml: false };
        const csp = tree.querySelector('meta[http-equiv="Content-Security-Policy"]')!;
        csp.setAttribute('content', csp.getAttribute('content')!.replace("frame-src 'none'", 'frame-src about:'));
      }
      script.textContent = JSON.stringify(payload).replaceAll('<', '\\u003c');
      return '<!doctype html>' + tree.documentElement.outerHTML;
    },
    diagnostics,
  },
});
