import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalCompileSession } from '../src/local/incremental';
import type { LocalCompileResult, LocalNode } from '../src/local/types';

/** Session node IDs may stay stable while fresh compilation renumbers them. */
function normalize(input: LocalCompileResult): unknown {
  const copy = structuredClone(input);
  if (!copy.ok) return copy;
  const doc = copy.document;
  const ids = new Map<string, string>();
  const visit = (nodes: LocalNode[]) => { for (const n of nodes) { ids.set(n.id, `node-${ids.size}`); if (n.children) visit(n.children); } };
  visit(doc.nodes);
  for (const [name, c] of Object.entries(doc.computations ?? {})) ids.set(c.nodeId, `computed-${name}`);
  const id = (value: string) => ids.get(value) ?? value;
  const key = (value: string) => value.startsWith('@') && ids.has(value.slice(1)) ? '@' + id(value.slice(1)) : value;
  for (const node of (function flatten(nodes: LocalNode[]): LocalNode[] {return nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);})(doc.nodes)) node.id = id(node.id);
  doc.initialState = Object.fromEntries(Object.entries(doc.initialState).map(([k,v]) => [key(k),v]));
  doc.bindings = Object.fromEntries(Object.entries(doc.bindings).map(([k,b]) => [key(k), {...b,name:key(b.name),owner:b.owner ? id(b.owner) : b.owner,nodeIds:b.nodeIds.map(id)}]));
  for (const c of Object.values(doc.computations ?? {})) c.nodeId = id(c.nodeId);
  for (const v of doc.validations ?? []) v.nodeId = id(v.nodeId);
  if (doc.dependencies) doc.dependencies = Object.fromEntries(Object.entries(doc.dependencies).map(([k,v]) => [id(k),v?.map(key) ?? null]));
  if (doc.bindingSlots) doc.bindingSlots = Object.fromEntries(Object.entries(doc.bindingSlots).map(([k,v]) => [id(k),Object.fromEntries(Object.entries(v).map(([s,n])=>[s,key(n)]))]));
  if (doc.tableShapes) doc.tableShapes = Object.fromEntries(Object.entries(doc.tableShapes).map(([k,v]) => [id(k),{...v,rowIds:v.rowIds.map(r=>r.map(id))}]));
  return copy;
}
const slider = '<slider bind="n" label="N" initial="2">';

describe('incremental compilation sessions', () => {
  it('defers rebuilding throughout context edits and recovers on the next prose edit', () => {
    const session = createLocalCompileSession();
    let source = `${slider}\n\nFirst **paragraph**\n\nValue {{ n }}\n\nLast paragraph`;
    session.compile(source);
    for (let n = 3; n < 8; n++) {
      source = source.replace(/initial="\d+"/, `initial="${n}"`);
      const result = session.compile(source);
      expect(normalize(result)).toEqual(normalize(compileLocal(source)));
      expect(session.stats).toMatchObject({mode: 'full', cacheBuilds: 0});
      if (result.ok) {
        result.document.nodes[0].attrs!.initial = '999';
        result.document.nodes[1].children![0].value = 'corrupted';
        result.document.initialState.n = 999;
      }
    }
    expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
    expect(session.stats).toMatchObject({mode: 'cached', cacheBuilds: 0});
    source = source.replace('Last paragraph', 'Last paragraph edited');
    expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
    expect(session.stats).toMatchObject({mode: 'incremental', compiledBlocks: 1, reusedBlocks: 2, cacheBuilds: 1});
  });

  it('drops deferred state on errors, option changes, clear and disposal', () => {
    const session = createLocalCompileSession();
    const initial = `${slider}\n\none\nline\n\ntwo`;
    const changed = initial.replace('initial="2"', 'initial="3"');
    for (const reset of ['clear', 'options', 'error'] as const) {
      session.compile(initial); session.compile(changed);
      if (reset === 'clear') session.clear();
      if (reset === 'error') session.compile(changed + '\n\n{{ unknown }}');
      const options = reset === 'options' ? {markdownBreaks: true} : undefined;
      expect(normalize(session.compile(changed.replace('two', 'two edited'), options)))
        .toEqual(normalize(compileLocal(changed.replace('two', 'two edited'), options)));
      expect(session.stats.mode).toBe('full');
      session.clear();
    }
    session.compile(initial); session.compile(changed); session.dispose();
    expect(() => session.compile(changed)).toThrow('disposed');
  });

  it('recovers with current computed values, container shapes and relocated ranges', () => {
    for (const context of [
      '<computed name="n" value="{{ 2 }}">',
      '<table label="Data">\n| A |\n| --- |\n| 2 |\n</table>',
      '<panel title="Panel">\n\nInside 2\n\n</panel>',
    ]) {
      const session = createLocalCompileSession();
      let source = `Introduction\n\n${context}\n\nLast paragraph`;
      session.compile(source);
      for (const value of ['333', '4', '55555']) {
        source = source.replace(/2|333|55555|4/, value);
        expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
        expect(session.stats).toMatchObject({mode: 'full', cacheBuilds: 0});
      }
      source = source.replace('Last paragraph', 'An edited last paragraph');
      expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
      expect(session.stats.mode).toBe('incremental');
      const stable = session.compile(source);
      if (stable.ok) stable.document.source = 'corrupted';
      expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
      session.dispose();
    }
  });

  it('compiles only the changed Markdown block and retains neighboring block IDs', () => {
    const session = createLocalCompileSession();
    const initial = session.compile('first **bold**\n\nsecond _emphasis_\n\nthird');
    const result = session.compile('first **bold**\n\nsecond _edited_\n\nthird');
    expect(normalize(result)).toEqual(normalize(compileLocal('first **bold**\n\nsecond _edited_\n\nthird')));
    expect(session.stats).toMatchObject({mode: 'incremental', totalBlocks: 3, compiledBlocks: 1, reusedBlocks: 2});
    if (initial.ok && result.ok) expect(result.document.nodes[0].id).toBe(initial.document.nodes[0].id);
  });

  it('reuses compiled expression blocks while the binding context is unchanged', () => {
    const session = createLocalCompileSession();
    let source = `${slider}\n\n# Heading\n\nValue {{ n * 2 }}\n\nUnchanged **text**`;
    session.compile(source);
    source = source.replace('n * 2', 'n * 3');
    expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
    expect(session.stats.mode).toBe('incremental');
    expect(session.stats.compiledBlocks).toBe(1);
    expect(session.stats.reusedBlocks).toBeGreaterThanOrEqual(2);
    source = source.replace('initial="2"', 'initial="4"');
    expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
    expect(session.stats.mode).toBe('full');
  });

  it('remaps suffix offsets after insertions and deletions without recompiling them', () => {
    const session = createLocalCompileSession();
    for (const source of ['one\n\ntwo\n\nthree', 'new\n\none\n\ntwo\n\nthree', 'new\n\none\n\nthree', 'new text\n\none\n\nthree']) {
      expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
    }
    expect(session.stats.mode).toBe('incremental');
    expect(session.stats.compiledBlocks).toBe(1);
  });

  it('isolates caches from mutations to results and respects option changes', () => {
    const session = createLocalCompileSession();
    const result = session.compile('first\nline\n\nsecond');
    if (result.ok) result.document.nodes[0].children![0].value = 'corrupted';
    const next = 'first\nline\n\nsecond edit';
    expect(normalize(session.compile(next))).toEqual(normalize(compileLocal(next)));
    expect(normalize(session.compile(next, {markdownBreaks: true}))).toEqual(normalize(compileLocal(next, {markdownBreaks: true})));
    expect(session.stats.mode).toBe('full');
    session.clear();
    session.compile(next);
    expect(session.stats.mode).toBe('full');
    session.dispose();
    expect(() => session.compile(next)).toThrow('disposed');
  });

  it.each([
    ['one\n\ntwo', '[link][ref]\n\none\n\ntwo\n\n[ref]: /target'],
    ['one\n\ntwo', 'one[^a]\n\ntwo\n\n[^a]: note'],
    ['one\n\ntwo\n\nthree', '```\none\n\ntwo\n\nthree'],
    [`${slider}\n\none\n\ntwo`, `\`\`\`\n${slider}\n\none\n\ntwo`],
    [`${slider}\n\nValue {{ n }}`, `${slider}\n\nValue {{ unknown }}`],
  ])('preserves full semantics when an edit changes scope or diagnostics', (before, after) => {
    const session = createLocalCompileSession();
    session.compile(before);
    expect(normalize(session.compile(after))).toEqual(normalize(compileLocal(after)));
  });

  it('enforces the cumulative whole-document node budget on cached blocks', () => {
    const session = createLocalCompileSession();
    session.compile('one\n\ntwo', {limits: {maxSyntaxNodes: 4}});
    const source = 'one\n\ntwo\n\nthree';
    expect(session.compile(source, {limits: {maxSyntaxNodes: 4}})).toEqual(compileLocal(source, {limits: {maxSyntaxNodes: 4}}));
  });

  it('relocates declaration metadata and anonymous bindings with unchanged context', () => {
    for (const control of [slider, '<slider label="anonymous" initial="2">']) {
      const session = createLocalCompileSession();
      const initial = `<!-- reactive-md: local-draft-3 -->\n\n<theme name="default">\n\nIntroduction\n\n${control}\n\n<computed name="twice" value="{{ 2 * 2 }}">\n\nValue {{ twice }}\n\nLast **paragraph**`;
      session.compile(initial);
      const source = initial.replace('Introduction', 'A much longer introduction');
      expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
      expect(session.stats.mode).toBe('incremental');
      expect(session.stats.compiledBlocks).toBe(1);
    }
  });

  it('keeps whole-document budget decisions equivalent through changing structures', () => {
    const sources = [`${slider}\n\none\n\ntwo`, `${slider}\n\none **bold**\n\ntwo`, `${slider}\n\none **bold**\n\n- one\n- two`, `${slider}\n\none\n\ntwo`];
    for (let budget = 1; budget < 24; budget++) {
      const session = createLocalCompileSession();
      for (const source of sources) expect(normalize(session.compile(source,{limits:{maxSyntaxNodes:budget}}))).toEqual(normalize(compileLocal(source,{limits:{maxSyntaxNodes:budget}})));
    }
  });

  it('reuses unchanged container metadata, including table shapes and selection bindings', () => {
    const session = createLocalCompileSession();
    const source = '<table label="Items" bind="selected" key="ID">\n| ID | Value |\n| --- | --- |\n| a | 1 |\n</table>\n\nFirst **paragraph**\n\nLast paragraph';
    session.compile(source);
    const next = source + ' edited';
    expect(normalize(session.compile(next))).toEqual(normalize(compileLocal(next)));
    expect(session.stats).toMatchObject({mode:'incremental',compiledBlocks:1,reusedBlocks:1});
  });

  it('preserves file-level normalization and indentation boundaries', () => {
    const session = createLocalCompileSession();
    for (const middle of ['plain','   plain','    code','\tcode','- item\n- next','> quote','\ufefftext','normal again']) {
      const source = `first\n\n${middle}\n\n${slider}\n\nlast`;
      expect(normalize(session.compile(source))).toEqual(normalize(compileLocal(source)));
    }
  });

  it('matches fresh compilation for transitions among independent block grammars', {timeout: 30_000}, () => {
    const blocks = ['plain text', '# Heading', 'setext\n---', '---', '- one\n- two', '1. one\n2. two', '> quoted\n> text', '    indented code', '   ordinary text', '```js\ncode\n```', '`inline code` and text', 'a  \nb', '&amp; text', '[link](/path)', '$x^2$', 'Value {{ n * 2 }}'];
    for (const before of blocks) for (const after of blocks) {
      const session = createLocalCompileSession();
      const wrap = (block: string) => `${slider}\n\nPrefix\n\n${block}\n\nSuffix`;
      session.compile(wrap(before));
      expect(normalize(session.compile(wrap(after))),JSON.stringify({before,after})).toEqual(normalize(compileLocal(wrap(after))));
    }
  });

  it('matches fresh compilation over deterministic edit sequences', {timeout: 30_000}, () => {
    const documents = [
      'First **paragraph**\n\nSecond _paragraph_\n\nLast paragraph',
      `${slider}\n\n# Heading\n\nValue {{ n * 2 }}\n\n- one\n- two`,
      'first\r\nline\r\n\r\nsecond\r\n\r\nthird',
      'first\r\rsecond\r\rthird',
      'Before\n\n```md\ncode\n```\n\nAfter',
      'Before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter',
      'First\n\n> quoted\n> text\n\nLast',
      'first\n\n[link][ref]\n\n[ref]: /target',
    ];
    const inserts = ['x', 'text', '\n', '\n\n', '**', '`', '```\n', '[ref]: /target\n', '{{ n }}', '> ', '- ', '  ', '&amp;', '<br>'];
    let seed = 42;
    const next = (n: number) => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed%n; };
    for (const doc of documents) {
      for (const options of [undefined,{markdownBreaks:true}]) {
        const session = createLocalCompileSession();
        let source = doc;
        session.compile(source,options);
        for (let i=0;i<35;i++) {
          const from = next(source.length+1), remove = next(Math.min(4,source.length-from)+1);
          source = source.slice(0,from)+inserts[next(inserts.length)]+source.slice(from+remove);
          expect(normalize(session.compile(source,options)), JSON.stringify({source,options})).toEqual(normalize(compileLocal(source,options)));
        }
      }
    }
  });
});
