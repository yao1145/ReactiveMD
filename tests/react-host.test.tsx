import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/index';
import { createReactHost, defineReactComponentPackage } from '../src/react/package';
import { renderLocalStaticDocument } from '../src/react/server';
import { readLocalComponentManifest } from '../src/sdk/manifest';

const capabilities = { interactive: true, static: true, ssr: true, offline: true };
const make = () => defineReactComponentPackage({ id: 'test/easy-rating', name: 'easy-rating', version: '1.0.0', capabilities,
  props: { count: { kind: 'number', default: 2 } }, css: '.local-document .easy-rating { color: var(--ink); }',
  render: ctx => <span className="easy-rating">{ctx.mode}:{typeof ctx.props.count}:{String(ctx.props.count)}:{String(ctx.bindings.isReadOnly)}</span>,
});

describe('component packages and host composition', () => {
  it('normalizes defaults to a serializable strict manifest', () => {
    const pkg = make();
    expect(pkg.definition.protocol).toBe('reactive-md-component/v1');
    expect(pkg.definition.form).toBe('leaf');
    expect(pkg.definition.styles).toEqual(['test/easy-rating.css']);
    expect(readLocalComponentManifest(JSON.parse(JSON.stringify(pkg.definition)))).toEqual(pkg.definition);
    expect(() => readLocalComponentManifest({ ...pkg.definition, protocol: undefined })).toThrow();
  });
  it('shares one host config and reuses render for read-only SSR', () => {
    const host = createReactHost({ packages: [make()] });
    expect(host.compileOptions.config).toBe(host.reactConfig.config);
    expect(host.config).toBe(host.reactConfig.config);
    const compiled = compileLocal('<easy-rating count="3">', host.compileOptions);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(structuredClone(compiled.document).componentConfigKey).toBe(host.config.key);
    const runtime = createLocalRuntime(compiled.document);
    try {
      const rendered = renderLocalStaticDocument({ document: compiled.document, runtime, reactConfig: host.reactConfig, resources: host.resources });
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
      expect(rendered.markup.replace(/<!--.*?-->/g, '')).toContain('static:number:3:true');
    } finally { runtime.dispose(); }
  });
  it('does not invent a stylesheet for a component without CSS', () => {
    const pkg = defineReactComponentPackage({ id: 'test/plain-view', name: 'plain-view', version: '1.0.0', capabilities, render: () => null });
    expect(pkg.resources).toEqual([]);
    expect(pkg.definition.styles).toBeUndefined();
  });
  it('keeps collision and resource validation on the common composition path', () => {
    const pkg = make();
    expect(() => createReactHost({ packages: [pkg, pkg] })).toThrow();
    expect(() => defineReactComponentPackage({ ...pkg.definition, css: 'a{}', resources: [{ id: pkg.definition.styles![0], css: 'b{}' }], render: () => null })).toThrow();
    expect(() => defineReactComponentPackage({ ...pkg.definition, render: () => null })).toThrow('missing style');
  });
});
