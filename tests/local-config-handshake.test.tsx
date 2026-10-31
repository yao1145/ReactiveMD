import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/index';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import { createReactConfig, defineReactComponent } from '../src/react/sdk';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { cloneLocalCompileResult, encodeLocalResultPatch, applyLocalResultPatch } from '../src/local/compile-patch';
import { validateLocalDocumentConfig } from '../src/sdk/config';
import { createReactHost, defineReactComponentPackage } from '../src/react/package';

it('reports a missed compiler config even when no extension node survived parsing', () => {
  const definition = defineLocalComponent({ id: 'test/sample-note', name: 'sample-note', version: '1.0.0',
    protocol: 'reactive-md-component/v1', form: 'container', props: {}, children: { kind: 'markdown' },
    capabilities: { interactive: true, static: true, ssr: true, offline: true } });
  const config = createLocalConfig({ components: [definition] });
  const reactConfig = createReactConfig(config, {
    components: [defineReactComponent(definition, { render: ctx => <aside>{ctx.children.render()}</aside> })],
  });
  const compiled = compileLocal('<sample-note>hello</sample-note>');
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const runtime = createLocalRuntime(compiled.document);
  try {
    const markup = renderToStaticMarkup(<LocalDocumentView document={compiled.document} runtime={runtime} reactConfig={reactConfig} />);
    expect(markup).toContain('data-rmd-extension-error');
    expect(markup).toContain('compiler');
  } finally { runtime.dispose(); }
});

it('preserves fingerprints in Worker clones and incremental result patches', () => {
  const before = compileLocal('Before');
  const after = compileLocal('After');
  if (!before.ok || !after.ok) throw new Error('Fixture failed.');
  const clone = cloneLocalCompileResult(before);
  if (!clone.ok) throw new Error('Clone failed.');
  expect(clone.document.componentConfigKey).toBe(before.document.componentConfigKey);
  const patch = encodeLocalResultPatch(before, after);
  expect(patch).not.toBeNull();
  if (!patch) throw new Error('Expected an incremental patch.');
  const restored = applyLocalResultPatch(before, structuredClone(patch));
  expect(restored).toEqual(after);
  expect(validateLocalDocumentConfig(after.document)).toEqual([]);
  const legacy = { ...after.document }; delete legacy.componentConfigKey;
  expect(validateLocalDocumentConfig(legacy)).toEqual([]);
});

it('reports a missing renderer even when its installed manifest matches', () => {
  const pkg = defineReactComponentPackage({ id: 'test/view', name: 'test-view', version: '1.0.0',
    capabilities: { interactive: true, static: true, ssr: true, offline: true }, render: () => <span>view</span> });
  const host = createReactHost({ packages: [pkg] });
  const compiled = compileLocal('<test-view>', host.compileOptions);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const runtime = createLocalRuntime(compiled.document);
  try {
    const markup = renderToStaticMarkup(<LocalDocumentView document={compiled.document} runtime={runtime} reactConfig={{ ...host.reactConfig, components: [] }} />);
    expect(markup).toContain('data-rmd-extension-error');
    expect(markup).toContain('No React implementation');
  } finally { runtime.dispose(); }
});
