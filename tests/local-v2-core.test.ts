import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { isLocalColor } from '../src/local/colors';
import { createLocalRuntime } from '../src/local/runtime';
import type { LocalDocument, LocalNode } from '../src/local/types';

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function find(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = all(document.nodes).filter((node) => node.type === 'component' && node.name === name);
  if (!matches[index]) throw new Error(`Missing <${name}> #${index}`);
  return matches[index];
}

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function codes(source: string): string[] {
  return compileLocal(source).diagnostics.map((diagnostic) => diagnostic.code);
}

const tableSource = (key = '', rows = '| a | Alpha |\n| b | Beta |') =>
  `<table label="Items" key="id"${key ? ` bind="${key}"` : ''}>\n| id | name |\n| --- | --- |\n${rows}\n</table>`;

describe('local-draft-2 colors', () => {
  it('accepts only named CSS colors and #RGB/#RRGGBB', () => {
    for (const value of ['red', 'RebeccaPurple', '#abc', '#A1B2C3']) expect(isLocalColor(value)).toBe(true);
    for (const value of [
      'red;display:none', 'rgb(1,2,3)', 'rgba(0,0,0,0.5)', 'var(--brand)', 'url(x)',
      '#abcd', '#12345', 'transparent', ' currentColor', '', '#xgx',
    ]) expect(isLocalColor(value)).toBe(false);
  });

  it('rejects unsafe colors at compile time and accepts them on color-capable controls', () => {
    expect(codes('<text color="red;display:none">Hidden</text>')).toContain('local.attribute.color');
    expect(codes('<section color="var(--x)">Body</section>')).toContain('local.attribute.color');
    expect(codes('<slider label="N" color="rgba(0,0,0,0.5)">')).toContain('local.attribute.color');
    expect(codes('<progress label="P" value="1" color="url(x)">')).toContain('local.attribute.color');
    expect(compile('<slider label="N" color="#2563eb">').nodes.length).toBeGreaterThan(0);
    expect(compile('<badge color="red">Hot</badge>').nodes.length).toBeGreaterThan(0);
    expect(compile('<text color="red">A</text>\n<section color="blue">\nB\n</section>').nodes.length).toBeGreaterThan(0);
  });

  it('requires color on text and section', () => {
    expect(codes('<text>Missing</text>')).toContain('local.attribute.required');
    expect(codes('<section>Missing</section>')).toContain('local.attribute.required');
  });
});

describe('jump and anchor navigation', () => {
  it('resolves jumps to heading slugs and explicit anchors without a hash', () => {
    const source = [
      '## Result',
      '',
      '<jump to="result">View result</jump>',
      '',
      '<anchor id="details">',
      '',
      '<jump to="details" appearance="button" color="#2563eb">Details</jump>',
      '',
      '<text color="#2563eb">**inline** {{ 1 + 1 }}</text>',
    ].join('\n');
    const document = compile(source);
    const jumps = all(document.nodes).filter((node) => node.name === 'jump');
    expect(jumps).toHaveLength(2);
    expect(jumps[0].attrs?.appearance).toBeUndefined();
    expect(jumps[1].attrs?.appearance).toBe('button');
  });

  it('rejects missing targets, hashes, whitespace and duplicate/colliding anchors', () => {
    expect(codes('<jump to="missing">Go</jump>')).toContain('local.jump.target');
    expect(codes('<jump to="#result">Go</jump>')).toContain('local.jump.target');
    expect(codes('<jump to="two words">Go</jump>')).toContain('local.jump.target');
    expect(codes('<anchor id="dup">\n<anchor id="dup">')).toContain('local.anchor.duplicate');
    expect(codes('## Result\n\n<anchor id="result">')).toContain('local.anchor.duplicate');
    expect(codes('<anchor id="1bad">')).toContain('local.anchor.id');
  });

  it('keeps jump bodies inline and non-interactive', () => {
    expect(codes('<jump to="x"><toggle label="Open"></jump>')).toContain('local.structure.children');
    expect(codes('<text color="red"><slider label="N"></text>')).toContain('local.structure.children');
  });
});

describe('multi-select', () => {
  const source = (attrs = '') =>
    `<multi-select label="Subjects"${attrs}>\n<option value="math">Math</option>\n<option value="physics">Physics</option>\n<option value="art">Art</option>\n</multi-select>`;

  it('initializes to an empty array and normalizes writes to source order', () => {
    const document = compile(source(' bind="subjects" max-selected="2"'));
    expect(document.bindings.subjects.type).toBe('array');
    expect(document.bindings.subjects.initial).toEqual([]);
    expect(document.bindings.subjects.options).toEqual(['math', 'physics', 'art']);
    expect(document.bindings.subjects.maxItems).toBe(2);
    const runtime = createLocalRuntime(document);
    try {
      const node = find(document, 'multi-select');
      expect(runtime.set(node, ['art', 'math'])).toEqual([]);
      expect(runtime.snapshot().state.subjects).toEqual(['math', 'art']);
      const rejected = runtime.set(node, ['math', 'physics', 'art']);
      expect(rejected[0]?.code).toBe('local.runtime.value');
      expect(runtime.snapshot().state.subjects).toEqual(['math', 'art']);
    } finally {
      runtime.dispose();
    }
  });

  it('parses comma-separated initial values and rejects unknown or excessive selections', () => {
    expect(compile(source(' bind="s" initial="physics, math"')).initialState.s).toEqual(['math', 'physics']);
    expect(codes(source(' bind="s" initial="chemistry"'))).toContain('local.initial.option');
    expect(codes(source(' bind="s" max-selected="1" initial="math,art"'))).toContain('local.initial.range');
  });

  it('rejects commas in option values and shared bindings', () => {
    expect(
      codes('<multi-select label="S">\n<option value="a,b">AB</option>\n</multi-select>'),
    ).toContain('local.option.value');
    expect(
      codes('<multi-select bind="s" label="A">\n<option value="a">A</option>\n</multi-select>\n<multi-select bind="s" label="B">\n<option value="b">B</option>\n</multi-select>'),
    ).toContain('local.binding.exclusive');
  });
});

describe('range-slider slots', () => {
  it('applies start and end defaults, binds both slots and resets atomically', () => {
    const document = compile('<range-slider label="Range" bind-start="lo" bind-end="hi" initial-end="60">');
    const node = find(document, 'range-slider');
    expect(document.initialState.lo).toBe(0);
    expect(document.initialState.hi).toBe(60);
    expect(document.bindingSlots?.[node.id]).toEqual({ start: 'lo', end: 'hi' });
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.get(node, 'start')).toBe(0);
      expect(runtime.get(node, 'end')).toBe(60);
      expect(runtime.set(node, 20, 'start')).toEqual([]);
      expect(runtime.set(node, 80, 'end')).toEqual([]);
      expect(runtime.snapshot().state.lo).toBe(20);
      expect(runtime.snapshot().state.hi).toBe(80);
      runtime.reset(node);
      expect(runtime.get(node, 'start')).toBe(0);
      expect(runtime.get(node, 'end')).toBe(60);
    } finally {
      runtime.dispose();
    }
  });

  it('snaps the default end down to the step grid and validates initial values', () => {
    const document = compile('<range-slider label="R" max="97" step="10">');
    const node = find(document, 'range-slider');
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.get(node, 'end')).toBe(90);
    } finally {
      runtime.dispose();
    }
    expect(codes('<range-slider label="R" initial-start="80" initial-end="20">')).toContain('local.initial.range');
    expect(codes('<range-slider label="R" initial-start="5" min="0" max="10" step="2">')).toContain('local.initial.step');
  });

  it('rejects crossings, bad slots and non-atomic multi-slot writes', () => {
    const document = compile('<range-slider label="R" bind-start="lo" bind-end="hi" initial-start="20" initial-end="60">');
    const node = find(document, 'range-slider');
    const runtime = createLocalRuntime(document);
    try {
      const before = runtime.snapshot();
      expect(runtime.set(node, 70, 'start')[0]?.code).toBe('local.runtime.value');
      expect(runtime.snapshot()).toBe(before);
      expect(runtime.setMany(node, { start: 90, end: 10 })[0]?.code).toBe('local.runtime.value');
      expect(runtime.snapshot().revision).toBe(before.revision);
      expect(runtime.setMany(node, { nope: 1 })[0]?.code).toBe('local.runtime.binding');
      expect(runtime.set(node, 30)[0]?.code).toBe('local.runtime.binding');
      expect(runtime.setMany(node, { start: 30, end: 40 })).toEqual([]);
      expect(runtime.snapshot().state.lo).toBe(30);
      expect(runtime.snapshot().state.hi).toBe(40);
      expect(runtime.snapshot().revision).toBe(before.revision + 1);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps omitted slot bindings internal and marks slots exclusive', () => {
    const document = compile('<range-slider label="R">');
    const node = find(document, 'range-slider');
    expect(Object.keys(document.bindings).every((key) => key.startsWith('@'))).toBe(true);
    expect(document.bindingSlots?.[node.id]?.start).toBe(`@${node.id}:start`);
    expect(codes('<range-slider label="R" bind-start="same" bind-end="same">')).toContain('local.binding.exclusive');
    expect(
      codes('<range-slider label="R" bind-start="lo">\n<slider label="S" bind="lo">'),
    ).toContain('local.binding.exclusive');
    expect(codes('<range-slider label="R" bind-start="x">')).toContain('local.binding.reserved');
  });
});

describe('coordinate slots', () => {
  it('defaults each axis to the nearest legal zero and updates x/y atomically', () => {
    const document = compile('<coordinate label="Point" bind-x="px" bind-y="py" initial-x="-2" initial-y="3">');
    const node = find(document, 'coordinate');
    expect(document.initialState.px).toBe(-2);
    expect(document.initialState.py).toBe(3);
    const runtime = createLocalRuntime(document);
    try {
      const before = runtime.snapshot().revision;
      expect(runtime.setMany(node, { x: 1, y: 2 })).toEqual([]);
      expect(runtime.snapshot().state.px).toBe(1);
      expect(runtime.snapshot().state.py).toBe(2);
      expect(runtime.snapshot().revision).toBe(before + 1);
      expect(runtime.setMany(node, { x: 99, y: 2 })[0]?.code).toBe('local.runtime.value');
      expect(runtime.snapshot().state.px).toBe(1);
      expect(runtime.set(node, 6, 'y')[0]?.code).toBe('local.runtime.value');
    } finally {
      runtime.dispose();
    }
    expect(compile('<coordinate label="P">')).toBeDefined();
  });

  it('validates ranges, steps and reserved slot names', () => {
    expect(codes('<coordinate label="P" x-min="5" x-max="1">')).toContain('local.constraint');
    expect(codes('<coordinate label="P" initial-x="0.5" step="1">')).toContain('local.initial.step');
    expect(codes('<coordinate label="P" bind-x="x">')).toContain('local.binding.reserved');
    const wide = compile('<coordinate label="P" x-min="1" x-max="10">');
    expect(wide.bindings).toHaveProperty('@' + find(wide, 'coordinate').id + ':x');
  });
});

describe('quiz', () => {
  it('accepts choice and numeric quizzes without creating a public binding', () => {
    const choice = compile(
      '<quiz label="Capital" answer="paris">\n<option value="paris">Paris</option>\n<option value="rome">Rome</option>\n</quiz>',
    );
    expect(choice.bindings).toEqual({});
    expect(choice.initialState).toEqual({});

    const numeric = compile(
      '<quiz type="number" label="Sum" answer="3.5" tolerance="0.1" explanation="Hint: {{ 1 + 1 }}">\n</quiz>',
    );
    expect(numeric.bindings).toEqual({});
  });

  it('rejects invalid answers, bodies and tolerances', () => {
    expect(codes('<quiz label="C" answer="london">\n<option value="paris">P</option>\n</quiz>')).toContain('local.quiz.answer');
    expect(codes('<quiz type="number" label="N" answer="abc">\n</quiz>')).toContain('local.quiz.answer');
    expect(codes('<quiz type="number" label="N" answer="2">Compute it</quiz>')).toContain('local.structure.children');
    expect(codes('<quiz type="number" label="N" answer="2" tolerance="-1">\n</quiz>')).toContain('local.attribute.range');
    expect(codes('<quiz label="C">\n<option value="paris">P</option>\n</quiz>')).toContain('local.attribute.required');
  });
});

describe('steps', () => {
  const source = '<steps bind="stage" label="Flow" initial="two">\n<step label="One">\nFirst\n</step>\n<step label="Two" value="two">\nSecond\n</step>\n</steps>';

  it('generates step values in order and exposes an exclusive string family', () => {
    const document = compile(source);
    expect(document.bindings.stage.type).toBe('string');
    expect(document.bindings.stage.options).toEqual(['step-1', 'two']);
    expect(document.initialState.stage).toBe('two');
    const runtime = createLocalRuntime(document);
    try {
      const node = find(document, 'steps');
      expect(runtime.set(node, 'step-1')).toEqual([]);
      expect(runtime.get(node)).toBe('step-1');
      runtime.reset(node);
      expect(runtime.get(node)).toBe('two');
    } finally {
      runtime.dispose();
    }
  });

  it('enforces step-only children, uniqueness and membership', () => {
    expect(codes('<steps label="F">\n<step label="A">A</step>\n<card title="X">B</card>\n</steps>')).toContain('local.structure.children');
    expect(codes('<steps label="F">\n<step label="A" value="x">A</step>\n<step label="B" value="x">B</step>\n</steps>')).toContain('local.step.value');
    expect(codes('<steps label="F" initial="missing">\n<step label="A">A</step>\n</steps>')).toContain('local.initial.option');
    expect(codes('<steps label="A" bind="s">\n<step label="A">A</step>\n</steps>\n<steps label="B" bind="s">\n<step label="B">B</step>\n</steps>')).toContain('local.binding.exclusive');
  });
});

describe('table and chart selection bindings', () => {
  it('does not add implicit bindings to documents without a key', () => {
    const document = compile('<table label="Items">\n| id | name |\n| --- | --- |\n| a | Alpha |\n</table>');
    expect(document.bindings).toEqual({});
  });

  it('writes stable row keys and restores the initial selection on reset', () => {
    const document = compile(tableSource('selected').replace('key="id"', 'key="id" initial="b"'));
    const node = find(document, 'table');
    expect(document.bindings.selected.options).toEqual(['', 'a', 'b']);
    expect(document.initialState.selected).toBe('b');
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.set(node, 'a')).toEqual([]);
      expect(runtime.get(node)).toBe('a');
      expect(runtime.set(node, 'missing')[0]?.code).toBe('local.runtime.value');
      runtime.reset(node);
      expect(runtime.get(node)).toBe('b');
    } finally {
      runtime.dispose();
    }
  });

  it('shares a selection binding between table and chart only with matching key order', () => {
    const shared = compile(
      '<table label="T" key="id" bind="sel">\n| id | name |\n| --- | --- |\n| a | Alpha |\n| b | Beta |\n</table>\n<chart key="id" bind="sel">\n| id | value |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n</chart>',
    );
    expect(shared.bindings.sel.nodeIds).toHaveLength(2);
    const runtime = createLocalRuntime(shared);
    try {
      expect(runtime.set(find(shared, 'table'), 'a')).toEqual([]);
      expect(runtime.get(find(shared, 'chart'))).toBe('a');
    } finally {
      runtime.dispose();
    }
    expect(
      codes('<table label="T" key="id" bind="sel">\n| id | name |\n| --- | --- |\n| a | Alpha |\n| b | Beta |\n</table>\n<chart key="id" bind="sel">\n| id | value |\n| --- | --- |\n| b | 2 |\n| a | 1 |\n</chart>'),
    ).toContain('local.binding.option');
  });

  it('requires a key for bind/initial and validates key cells', () => {
    expect(codes('<table label="T" bind="s">\n| id | name |\n| --- | --- |\n| a | A |\n</table>')).toContain('local.selection.key');
    expect(codes('<table label="T" initial="a">\n| id | name |\n| --- | --- |\n| a | A |\n</table>')).toContain('local.selection.key');
    expect(codes('<table label="T" key="id">\n| id | name |\n| --- | --- |\n| a | A |\n| a | B |\n</table>')).toContain('local.selection.key');
    expect(codes('<table label="T" key="id">\n| id | name |\n| --- | --- |\n| {{ 1 }} | A |\n</table>')).toContain('local.selection.key');
    expect(codes(tableSource('').replace('key="id"', 'key="id" initial="nope"'))).toContain('local.initial.option');
    expect(codes(tableSource('').replace('key="id"', 'key="missing"'))).toContain('local.selection.key');
  });
});

describe('runtime hardening for v2 slots', () => {
  it('ignores forged node metadata and keeps the whole snapshot on rejection', () => {
    const document = compile('<coordinate label="P" bind-x="px" bind-y="py">');
    const node = find(document, 'coordinate');
    const runtime = createLocalRuntime(document);
    try {
      const forged = { ...node, attrs: { ...node.attrs, 'bind-x': 'evil' } };
      expect(runtime.setMany(forged, { x: 2, y: -1 })).toEqual([]);
      expect(runtime.snapshot().state.px).toBe(2);
      expect(runtime.snapshot().state.evil).toBeUndefined();
      const revision = runtime.snapshot().revision;
      expect(runtime.setMany(node, { x: 1, y: 99 })[0]?.code).toBe('local.runtime.value');
      expect(runtime.snapshot()).toMatchObject({ revision });
      expect(runtime.get({ ...node, id: 'not-canonical' }, 'x')).toBeNull();
    } finally {
      runtime.dispose();
    }
  });
});
