import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, createLocalCompileSession, encodeLocalResultPatch, applyLocalResultPatch, exportLocalState, parseLocalState, applyLocalState } from '../src/local';
import { createLocalConfig, defineLocalComponent, type LocalComponentDefinition } from '../src/sdk';
import { defaultPreset } from '../src/presets/default';
import { createHeadingAnchors } from '../src/local/heading-anchors';
import { parseLocal } from '../src/local/parser';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/sdk-phase2-baseline.json', import.meta.url), 'utf8'));
const alias = (name: string) => `custom-${name}`;
function externalCopy(definition: LocalComponentDefinition): LocalComponentDefinition {
  const structure = definition.structure;
  return defineLocalComponent({ ...definition, name: alias(definition.name), id: `consumer/${definition.name}`,
    ...(structure ? { structure: { ...structure,
      ...(structure.parents ? { parents: structure.parents.map(alias) } : {}),
      ...(structure.child ? { child: alias(structure.child) } : {}),
      ...(structure.children ? { children: structure.children.map(alias) } : {}),
    } } : {}),
    ...(definition.rules ? { rules: definition.rules.map(rule => {
      const copy = { ...rule } as Record<string, unknown>;
      for (const key of ['child', 'node', 'edge']) {
        if (typeof copy[key] === 'string') copy[key] = alias(copy[key] as string);
      }
      if (Array.isArray(copy.children)) copy.children = copy.children.map(alias);
      return copy as unknown as NonNullable<LocalComponentDefinition['rules']>[number];
    }) } : {}),
  });
}

describe('public component boundary', () => {
  it('keeps null binding values consistent with their declared type', () => {
    const definition = defineLocalComponent({ id: 'consumer/null', name: 'null-value', version: '1.0.0', protocol: 'reactive-md-component/v1', form: 'leaf', props: {},
      bindings: { value: { kind: 'null', family: 'text', bind: 'bind', initial: 'initial', initialRule: 'empty' } },
      capabilities: { interactive: true, static: true, ssr: true, offline: true } });
    const config = createLocalConfig({ components: [definition] });
    for (const initial of ['', ' initial="null"']) {
      const compiled = compileLocal(`<null-value bind="nothing"${initial}>`, { config });
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const runtime = createLocalRuntime(compiled.document);
      try {
        expect(runtime.getParameter('nothing')).toBeNull();
        expect(runtime.setParameter('nothing', 'wrong')).not.toEqual([]);
        expect(runtime.getParameter('nothing')).toBeNull();
        expect(runtime.setParameter('nothing', null)).toEqual([]);
      } finally { runtime.dispose(); }
    }
    expect(compileLocal('<null-value initial="wrong">', { config }).ok).toBe(false);
  });

  it('round-trips numeric collections through the portable state format', () => {
    const definition = defineLocalComponent({ id: 'consumer/series', name: 'numeric-series', version: '1.0.0', protocol: 'reactive-md-component/v1',
      form: 'leaf', props: {}, bindings: { value: { kind: 'number-array', family: 'collection', bind: 'bind', initial: 'initial', initialRule: 'empty-array', maxItems: { literal: 3 } } },
      capabilities: { interactive: true, static: true, ssr: true, offline: true } });
    const compiled = compileLocal('<numeric-series bind="samples" initial="[1,1]">', { config: createLocalConfig({ components: [definition] }) });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      expect(runtime.setParameter('samples', [3, 3])).toEqual([]);
      const file = exportLocalState(runtime);
      const parsed = parseLocalState(JSON.stringify(file));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error('Expected a portable numeric collection');
      runtime.setParameter('samples', [2]);
      expect(applyLocalState(runtime, parsed.file)).toEqual([]);
      expect(runtime.getParameter('samples')).toEqual([3, 3]);
      expect(parseLocalState({ ...file, parameters: { samples: [1, 'mixed'] } }).ok).toBe(false);
    } finally { runtime.dispose(); }
  });
  it('constructs every default manifest with the public validator', () => {
    expect(defaultPreset.components).toHaveLength(46);
    for (const component of defaultPreset.components) {
      expect(defineLocalComponent(JSON.parse(JSON.stringify(component)))).toEqual(component);
    }
  });

  it('keeps builtin implementations on the public adapter and component helpers', () => {
    const directory = new URL('../src/components/', import.meta.url);
    for (const file of readdirSync(directory).filter(file => /\.[cm]?tsx?$/.test(file))) {
      const source = readFileSync(new URL(file, directory), 'utf8');
      expect(source, `${file} accesses an internal AST/runtime object`).not.toMatch(/\bLocalNode\b|\bruntime\.document\b|\breadContentNode\b/);
      expect(source, `${file} imports a private local module`).not.toMatch(/from\s+['"]\.\.\/local\//);
    }
  });

  it('keeps old host inputs as an adapter to the unified kernel', () => {
    const compiler = readFileSync(new URL('../src/local/compiler.ts', import.meta.url), 'utf8');
    expect(compiler).not.toMatch(/function (?:resolveHostBindings|validateHostComponents)\b/);
    expect(compiler).not.toMatch(/entry\.name\s*===?\s*['"](?:slider|coordinate|range-slider|multi-select|tabs|timer|diagram|data-table)['"]/);
    expect(compiler).not.toMatch(/component\.name\s*===?\s*['"](?:timeline|chart)['"]/);
  });

  it('applies the same contracts to all external aliases across the compatibility corpus', () => {
    const definitions = defaultPreset.components.map(externalCopy);
    const config = createLocalConfig({ components: definitions });
    const names = new Set(defaultPreset.components.map(item => item.name));
    for (const fixture of baseline.cases) {
      const edits: {start: number; end: number; text: string}[] = [];
      const visit = (nodes: ReturnType<typeof parseLocal>['nodes']) => {
        for (const node of nodes) {
          if (node.type === 'component' && node.name && names.has(node.name)) {
            edits.push({start: node.range.start + 1, end: node.range.start + 1 + node.name.length, text: alias(node.name)});
            const closing = fixture.source.lastIndexOf(`</${node.name}`, node.range.end);
            if (closing > node.range.start && closing < node.range.end) edits.push({start: closing + 2, end: closing + 2 + node.name.length, text: alias(node.name)});
          }
          if (node.children) visit(node.children);
        }
      };
      visit(parseLocal(fixture.source).nodes);
      let source = fixture.source;
      for (const edit of edits.sort((a,b) => b.start-a.start)) source = source.slice(0,edit.start)+edit.text+source.slice(edit.end);
      const compiled = compileLocal(source, { config });
      expect(compiled.ok, `${fixture.id}: ${JSON.stringify(compiled.diagnostics)}`).toBe(fixture.ok);
      expect(compiled.diagnostics.map(item => item.code), fixture.id).toEqual(fixture.diagnostics.map((item: {code: string}) => item.code));
      if (!compiled.ok) continue;
      const runtime = createLocalRuntime(compiled.document);
      try {
        expect(runtime.getParameters(), fixture.id).toEqual(fixture.initial);
        for (const action of fixture.actions ?? []) {
          expect(runtime.setParameter(action.bind, action.value).map(item => item.code), fixture.id).toEqual(action.codes);
          expect(runtime.getParameters(), fixture.id).toEqual(action.state);
        }
      } finally { runtime.dispose(); }
    }
  });

  it('preserves public rules through structured clone, result patches and incremental edits', () => {
    const config = createLocalConfig({ components: defaultPreset.components.map(externalCopy) });
    const source = '<custom-range-slider label="Range" bind-start="low" bind-end="high" min="0" max="10">\n\n'
      + '<custom-input label="Email" bind="mail" type="email">\n\nInitial paragraph';
    const original = compileLocal(source, { config: structuredClone(config) });
    const changed = compileLocal(source.replace('max="10"', 'max="12"'), { config });
    expect(original.ok).toBe(true);
    expect(changed.ok).toBe(true);
    const encoded = encodeLocalResultPatch(original, changed);
    expect(encoded).not.toBeNull();
    const patched = applyLocalResultPatch(structuredClone(original), structuredClone(encoded!));
    expect(patched).toEqual(changed);
    if (!patched?.ok) throw new Error('Expected successful patched compile result');
    const runtime = createLocalRuntime(patched.document);
    try {
      expect(runtime.setParameter('mail', 'invalid')).not.toEqual([]);
      const range = patched.document.nodes.find(node => node.name === 'custom-range-slider')!;
      expect(runtime.setMany(range, { start: 9, end: 2 })).not.toEqual([]);
      expect(runtime.getParameter('low')).toBe(0);
      expect(runtime.getParameter('high')).toBe(12);
    } finally { runtime.dispose(); }
    const session = createLocalCompileSession();
    session.compile(source, { config });
    session.prepare();
    const incremental = session.compile(source.replace('Initial paragraph', 'Edited paragraph'), { config });
    expect(incremental).toEqual(compileLocal(source.replace('Initial paragraph', 'Edited paragraph'), { config }));
  });

  it('resolves navigation for external anchor and jump contracts', () => {
    const config = createLocalConfig({ components: defaultPreset.components.map(externalCopy) });
    const compiled = compileLocal('<custom-anchor id="target">\n\n<custom-jump to="target">Go</custom-jump>', { config });
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) throw new Error('Expected a compiled navigation document');
    const anchors = createHeadingAnchors(compiled.document, 'consumer');
    expect(anchors.targetId('target')).toBe('consumer-target');
    expect(anchors.anchorIds.size).toBe(1);
    expect(anchors.htmlIds.size).toBe(0);
  });
});
