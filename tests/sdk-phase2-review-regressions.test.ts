import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, type LocalNode } from '../src/local';
import { createLocalConfig, defineLocalComponent, getLocalComponentRegistry, type LocalComponentDefinition, type LocalComponentBinding } from '../src/sdk';
import { projectAnchors, sameAnchorProjection } from '../src/local/view-revision';

function definition(input: Partial<LocalComponentDefinition> = {}) {
  return defineLocalComponent({
    id: 'example/combo', name: 'combo', version: '1.0.0',
    protocol: 'reactive-md-component/v1', form: 'leaf', props: {},
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
    ...input,
  });
}

const numberBinding = { kind: 'number', family: 'number', bind: 'bind', initial: 'initial', initialRule: 'nearest-zero' } as const;
function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

describe('phase two independent review regressions', () => {
  it('rejects ids that collide with the default preset through both config entry paths', () => {
    const impostor = definition({ id: 'reactive-md/number' });
    expect(() => createLocalConfig({ components: [impostor] })).toThrow(/id.*reactive-md\/number/);
    const config = createLocalConfig();
    expect(() => getLocalComponentRegistry({ ...config, components: [impostor] })).toThrow(/id.*reactive-md\/number/);
  });

  it('supports scalar and named values in one atomic node transaction', () => {
    const combo = definition({ bindings: {
      value: { ...numberBinding, bind: 'bind-v' },
      x: { ...numberBinding, bind: 'bind-x', initial: 'initial-x', exclusive: true,
        constraints: { min: { literal: 0 }, max: { literal: 10 } } },
    } });
    const result = compileLocal('<combo bind-v="v" initial="1" bind-x="xv" initial-x="2">', { config: createLocalConfig({ components: [combo] }) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = flatten(result.document.nodes).find(node => node.name === 'combo')!;
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.get(node)).toBe(1);
      expect(runtime.set(node, 3)).toEqual([]);
      expect(runtime.setMany(node, { value: 4, x: 5 })).toEqual([]);
      expect(runtime.getParameters()).toEqual({ v: 4, xv: 5 });
      const revision = runtime.snapshot().revision;
      expect(runtime.setMany(node, { value: 7, x: 11 }).length).toBeGreaterThan(0);
      expect(runtime.snapshot().revision).toBe(revision);
      expect(runtime.getParameters()).toEqual({ v: 4, xv: 5 });
      runtime.reset(node);
      expect(runtime.getParameters()).toEqual({ v: 1, xv: 2 });
    } finally { runtime.dispose(); }
  });

  it('enforces required authored binding names for scalar and named slots', () => {
    const cases: Record<string, LocalComponentBinding>[] = [
      { value: { ...numberBinding, required: true } },
      { x: { ...numberBinding, bind: 'bind-x', required: true } },
    ];
    for (const bindings of cases) {
      const component = definition({ bindings });
      const config = createLocalConfig({ components: [component] });
      const result = compileLocal('<combo>', { config });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.some(item => item.code === 'local.attribute.required')).toBe(true);
    }
  });

  it('rejects a dynamic maxItems source instead of silently dropping the cap', () => {
    expect(() => definition({
      props: { limit: { kind: 'number', dynamic: true } },
      bindings: { value: { kind: 'array', family: 'collection', bind: 'bind', initial: 'initial', initialRule: 'empty-array', maxItems: { prop: 'limit' } } },
    })).toThrow(/maxItems.*static/);
  });

  it('makes the supported named-slot exclusivity contract explicit', () => {
    const component = definition({ bindings: { x: numberBinding } });
    expect(component.bindings?.x.exclusive).toBe(true);
    expect(() => definition({ bindings: { x: { ...numberBinding, exclusive: false } } })).toThrow(/exclusive/);
    expect(() => definition({ bindings: { x: { ...numberBinding, family: 'timer', initialRule: 'duration' } } })).toThrow(/named slots/);
  });

  it('invalidates anchor caches for external rule aliases and rule changes', () => {
    const component = definition({ props: { target: { kind: 'string', static: true } }, rules: [{ kind: 'anchor', id: 'target' }] });
    const result = compileLocal('<combo target="place">', { config: createLocalConfig({ components: [component] }) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = result.document;
    const projection = projectAnchors(document);
    expect(projection.nodes.some(node => node.name === 'combo')).toBe(true);
    expect(sameAnchorProjection(projection, projectAnchors({ ...document, nodes: [] }))).toBe(false);
    const changed = { ...document, componentDefinitions: document.componentDefinitions?.map(item => item.name === 'combo' ? { ...item, rules: [] } : item) };
    expect(sameAnchorProjection(projection, projectAnchors(changed))).toBe(false);
  });
});
