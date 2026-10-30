import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent, localComponentDigest } from '../src/sdk/manifest';
import { resolveLocalComponentProps } from '../src/sdk/props';
import { isLocalVersion, localVersionSatisfies } from '../src/sdk/version';

const manifest = {
  id: 'test/value', name: 'sdk-value', version: '1.0.0', protocol: 'reactive-md-component/v1', form: 'leaf',
  props: { amount: { kind: 'number', default: 2 } },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
} as const;

describe('SDK contract edges across consumers', () => {
  it('applies a declared default before enforcing required props', () => {
    const definition = defineLocalComponent({ ...manifest, props: { amount: { kind:'number', required:true, default:2 } } });
    const compiled = compileLocal('<sdk-value>', { config: createLocalConfig({ components:[definition] }) });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = createLocalRuntime(compiled.document);
    expect(resolveLocalComponentProps(definition, {}, runtime).amount).toBe(2);
    runtime.dispose();
  });
  it('invalidates compile semantics when dynamic expressions become forbidden', () => {
    const permissive = defineLocalComponent(manifest);
    const restricted = defineLocalComponent({ ...manifest, props: { amount: { ...manifest.props.amount, dynamic:false } } });
    expect(localComponentDigest(restricted)).not.toBe(localComponentDigest(permissive));
    const source = '<sdk-value amount="{{ 2 }}">';
    expect(compileLocal(source,{config:createLocalConfig({components:[permissive]})}).ok).toBe(true);
    expect(compileLocal(source,{config:createLocalConfig({components:[restricted]})}).ok).toBe(false);
  });
  it('keeps visual/editor changes out of the semantic compilation key', () => {
    const first = defineLocalComponent(manifest);
    const copy = defineLocalComponent({ ...manifest, authoring:{title:{en:'New copy'}} });
    expect(createLocalConfig({components:[first]}).key).toBe(createLocalConfig({components:[copy]}).key);
  });
  it('does not cache mutable caller manifests by object identity', () => {
    const raw = structuredClone(defineLocalComponent(manifest));
    const before = localComponentDigest(raw);
    (raw.props.amount as {default:number}).default = 4;
    expect(localComponentDigest(raw)).not.toBe(before);
  });
  it('compares numeric prereleases and requires explicit prerelease compatibility', () => {
    expect(isLocalVersion('1.0.0-beta.1')).toBe(true);
    expect(isLocalVersion('1.0.0-beta.01')).toBe(false);
    expect(localVersionSatisfies('1.0.0-beta.2','>=1.0.0-beta.1 <1.0.0')).toBe(true);
    expect(localVersionSatisfies('1.1.0-beta.1','^1.0.0')).toBe(false);
    expect(localVersionSatisfies('0.6.2','^0.6.1')).toBe(true);
    expect(localVersionSatisfies('0.7.0','^0.6.1')).toBe(false);
  });
  it('rejects writes when a dynamic binding-bound prop violates its own schema', () => {
    const definition = defineLocalComponent({ ...manifest,
      props:{ bound:{kind:'number',dynamic:true,min:0,max:10,integer:true} },
      bindings:{value:{kind:'number',family:'number',bind:'bind',initial:'initial',initialRule:'nearest-zero',
        constraints:{min:{literal:0},max:{prop:'bound'},step:{literal:1}}}},
    });
    const result=compileLocal('<number bind="limit" label="Limit" min="0" max="20" step="0.5" initial="5">\n<sdk-value bind="score" bound="{{ limit }}">',
      {config:createLocalConfig({components:[definition]})});
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    const runtime=createLocalRuntime(result.document);
    expect(runtime.setParameter('score',4)).toEqual([]);
    expect(runtime.setParameter('limit',11)).toEqual([]);
    expect(runtime.setParameter('score',8).length).toBeGreaterThan(0);
    expect(runtime.getParameter('score')).toBe(4);
    expect(runtime.setParameter('limit',5.5)).toEqual([]);
    expect(runtime.setParameter('score',5).length).toBeGreaterThan(0);
    runtime.dispose();
  });
});
