import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalCompileSession } from '../src/local/incremental';
import { reuseFlatRows } from '../src/local/row-reuse';
import type { LocalCompileResult, LocalNode } from '../src/local/types';

/** Session IDs may stay stable while a fresh compilation renumbers them. */
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

function rows(nodes: LocalNode[], type: string): LocalNode[] {
  const out: LocalNode[] = [];
  const walk = (items: LocalNode[]) => { for (const node of items) { if (node.type === type) out.push(node); if (node.children) walk(node.children); } };
  walk(nodes);
  return out;
}
const rowIds = (result: LocalCompileResult) => result.ok ? rows(result.document.nodes, 'tableRow').map(n => n.id) : [];

function listDocument(size: number, change: (index: number) => string, ending = '\n'): string {
  return Array.from({length: size}, (_, i) => `- ${change(i)}`).join(ending);
}
function tableDocument(size: number, change: (index: number, column: number) => string): string {
  const header = '| A | B | C |\n| --- | --- | --- |';
  return header + '\n' + Array.from({length: size}, (_, i) => `| ${change(i, 0)} | ${change(i, 1)} | ${change(i, 2)} |`).join('\n');
}

describe('flat row node reuse', () => {
  function item(id: string, start: number, text: string): LocalNode {
    const paragraphStart = start + 2;
    return {
      type: 'listItem', id, range: {start, end: start + text.length}, checked: null,
      children: [{
        type: 'paragraph', id: id + '-p', range: {start: paragraphStart, end: start + text.length},
        children: [{type: 'text', id: id + '-t', range: {start: paragraphStart, end: start + text.length}, value: text.slice(2)}],
      }],
    };
  }
  function listBlock(text: string, ids: string[]): {text: string; origin: number; nodes: LocalNode[]} {
    const lines = text.split('\n');
    let at = 0;
    const children = lines.map((line, index) => {
      const node = item(ids[index], at, line);
      at += line.length + 1;
      return node;
    });
    return {text, origin: 0, nodes: [{type: 'list', id: 'list-' + ids.join('-'), range: {start: 0, end: text.length}, ordered: false, children}]};
  }

  it('shares unchanged rows and shifts cloned rows with stable ids', () => {
    const before = listBlock('- a\n- b\n- c', ['one', 'two', 'three']);
    const after = listBlock('- a\n- longer\n- c', ['n1', 'n2', 'n3']);
    const outcome = reuseFlatRows(before, after)!;
    expect(outcome).toBeDefined();
    expect(outcome.kind).toBe('item');
    expect(outcome.reused).toBe(2);
    const children = outcome.nodes[0].children!;
    // Same position: the exact previous object is reused.
    expect(children[0]).toBe(before.nodes[0].children![0]);
    // Changed row: fresh parse.
    expect(children[1]).toBe(after.nodes[0].children![1]);
    // Shifted unchanged row: cloned with its previous id and new range.
    expect(children[2]).not.toBe(before.nodes[0].children![2]);
    expect(children[2].id).toBe('three');
    expect(children[2].range).toEqual({start: 13, end: 16});
    expect(children[2].children![0].range).toEqual({start: 15, end: 16});
    expect(outcome.reusedIds.has('three')).toBe(true);
    expect(outcome.reusedIds.has('three-t')).toBe(true);
  });

  it('handles duplicate rows, insertions at the front and emoji', () => {
    const before = listBlock('- same\n- same\n- 🙂 end', ['a', 'b', 'c']);
    const after = (text: string) => listBlock(text, ['x', 'y', 'z', 'w']);
    // Front insertion: the previous rows shift and keep their ids.
    const inserted = reuseFlatRows(before, after('- new\n- same\n- same\n- 🙂 end'))!;
    expect(inserted.reused).toBe(3);
    const ids = inserted.nodes[0].children!.map(n => n.id);
    expect(ids[0]).toBe('x');
    expect(ids.slice(1)).toEqual(['a', 'b', 'c']);
    for (const node of inserted.nodes[0].children!.slice(1)) {
      expect(node.range.end - node.range.start).toBeGreaterThan(0);
    }
    // The emoji row keeps an exact UTF-16 range after the insertion.
    const emoji = inserted.nodes[0].children!.at(-1)!;
    expect(emoji.range.end - emoji.range.start).toBe('- 🙂 end'.length);
    // All rows identical: every row reuses, in order.
    const same = reuseFlatRows(before, after('- same\n- same\n- same'))!;
    expect(same.reused).toBe(2);
  });

  it('refuses multi-line, nested and non-row blocks', () => {
    const flat = listBlock('- a\n- b', ['a', 'b']);
    expect(reuseFlatRows(flat, {text: '- a\n  - nested', origin: 0, nodes: [{type: 'list', id: 'l', range: {start: 0, end: 12}, children: [
      {type: 'listItem', id: 'n', range: {start: 0, end: 12}, children: [{type: 'paragraph', id: 'p', range: {start: 2, end: 12}, children: []}]},
    ]}]})).toBeUndefined();
    expect(reuseFlatRows(flat, {text: 'plain', origin: 0, nodes: [{type: 'paragraph', id: 'p', range: {start: 0, end: 5}}]})).toBeUndefined();
  });
});

describe('incremental session row identity', () => {
  it('keeps unchanged item ids, shares unshifted objects and shifts the rest accurately', () => {
    const session = createLocalCompileSession();
    const initial = listDocument(1000, i => `Item ${i} with **formatting**`);
    const first = session.compileShared(initial);
    expect(first.ok).toBe(true);
    expect(session.stats.mode).toBe('full');

    // Equal-length middle edit: every other row keeps both its id and object.
    const equalEdit = initial.replace('Item 500 with **formatting**', 'Item 500 with **equivalent**');
    const equalResult = session.compileShared(equalEdit);
    expect(normalize(equalResult)).toEqual(normalize(compileLocal(equalEdit)));
    expect(session.stats.mode).toBe('incremental');
    const beforeItems = first.ok ? rows(first.document.nodes, 'listItem') : [];
    const afterItems = equalResult.ok ? rows(equalResult.document.nodes, 'listItem') : [];
    expect(afterItems.length).toBe(1000);
    expect(afterItems[0].id).toBe(beforeItems[0].id);
    expect(afterItems[0]).toBe(beforeItems[0]);
    expect(afterItems[999].id).toBe(beforeItems[999].id);
    expect(afterItems[500].id).not.toBe(beforeItems[500].id);
    expect((session.stats.parse?.reusedItemNodes ?? 0)).toBeGreaterThan(900);

    // Variable-length edit: later ids stay stable but ranges shift and objects
    // are necessarily cloned.
    const variable = equalEdit.replace('Item 500 with **equivalent**', 'Item 500 with **much longer value**');
    const variableResult = session.compileShared(variable);
    expect(normalize(variableResult)).toEqual(normalize(compileLocal(variable)));
    const shifted = variableResult.ok ? rows(variableResult.document.nodes, 'listItem') : [];
    expect(shifted.length).toBe(1000);
    expect(shifted[999].id).toBe(beforeItems[999].id);
    expect(shifted[999]).not.toBe(beforeItems[999]);
    // UTF-16 ranges still point at the actual rows.
    expect(variable.slice(shifted[999].range.start, shifted[999].range.end)).toBe('- Item 999 with **formatting**');
    expect(session.stats.parse?.reusedItemNodes ?? 0).toBeGreaterThan(900);
  });

  it('does not let a 1000-row sequential scan thrash the inline plans', () => {
    const session = createLocalCompileSession();
    let source = listDocument(1000, i => `Item ${i} shared text`);
    let result = session.compile(source);
    for (let round = 1; round <= 4; round += 1) {
      source = source.replace(`Item ${round * 100} shared text`, `Item ${round * 100} shared text ${round}`);
      result = session.compile(source);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.document.source).toBe(source);
      // Rows came from the previous revision's row plans, not a cold scan.
      expect(session.stats.parse?.reusedItemNodes ?? 0).toBeGreaterThan(900);
      expect(session.stats.parse?.reusedItems ?? 0).toBeGreaterThan(900);
    }
    // Check accumulated edits against a fresh compile once. Per-round checks
    // above exercise the working-set reuse without repeating a large tree diff.
    expect(normalize(result)).toEqual(normalize(compileLocal(source)));
  });

  it('reuses table rows and keeps metadata and shapes equivalent', () => {
    const session = createLocalCompileSession();
    const initial = tableDocument(500, (i, c) => `cell ${i}-${c}`);
    session.compile(initial);
    const edited = initial.replace('cell 250-1', 'cell 250-1 changed');
    const result = session.compile(edited);
    expect(normalize(result)).toEqual(normalize(compileLocal(edited)));
    expect(session.stats.parse?.reusedRowNodes ?? 0).toBeGreaterThan(400);
    const ids = rowIds(result);
    expect(ids.length).toBe(501); // header + 500 rows
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reuses rows that contain dynamic interpolations through the general parser', () => {
    const session = createLocalCompileSession();
    const prefix = '<slider bind="n" label="N" initial="2">';
    const build = (changed: number) => `${prefix}\n\n` + Array.from({length: 300}, (_, i) =>
      `- Row ${i} value {{ n * ${i === changed ? 7 : 3} }}`).join('\n') + '\n\nTrailing paragraph';
    const initial = build(-1);
    const first = session.compileShared(initial);
    const edited = build(150);
    const result = session.compileShared(edited);
    expect(normalize(result)).toEqual(normalize(compileLocal(edited)));
    expect(session.stats.mode).toBe('incremental');
    expect(session.stats.parse?.reusedItemNodes ?? 0).toBeGreaterThan(250);
    const items = rows(result.ok ? result.document.nodes : [], 'listItem');
    const before = rows(first.ok ? first.document.nodes : [], 'listItem');
    expect(items.length).toBe(300);
    // Same absolute offset, unchanged row: id (and object) survive.
    expect(items[0].id).toBe(before[0].id);
    expect(items[0]).toBe(before[0]);
  });

  it('refreshes container dependencies when the changed row changes its reads', () => {
    const session = createLocalCompileSession();
    const prefix = '<slider bind="n" label="N" initial="2">';
    const make = (row: string) => `${prefix}\n\n- kept row\n- ${row}\n- tail row\n\nTrailing paragraph`;
    session.compile(make('value {{ n }}'));
    const result = session.compile(make('value {{ 41 }}'));
    expect(normalize(result)).toEqual(normalize(compileLocal(make('value {{ 41 }}'))));
    expect(session.stats.parse?.reusedItemNodes ?? 0).toBeGreaterThan(0);
  });

  it('handles CRLF list rows and front deletion', () => {
    const session = createLocalCompileSession();
    const initial = listDocument(200, i => `Line ${i}`, '\r\n');
    session.compile(initial);
    const removed = initial.split('\r\n').slice(1).join('\r\n');
    const result = session.compile(removed);
    expect(normalize(result)).toEqual(normalize(compileLocal(removed)));
    const items = rows(result.ok ? result.document.nodes : [], 'listItem');
    expect(items.length).toBe(199);
    expect(removed.slice(items[0].range.start, items[0].range.end)).toBe('- Line 1');
    expect(session.stats.parse?.reusedItemNodes ?? 0).toBeGreaterThan(150);
  });

  it('stays budget-equivalent and clears reuse state on option changes', () => {
    const source = listDocument(60, i => `Budget item ${i}`);
    const edited = source.replace('Budget item 30', 'Budget item thirty');
    for (const budget of [10, 50, 120, 400]) {
      const session = createLocalCompileSession();
      session.compile(source, {limits: {maxSyntaxNodes: budget}});
      expect(normalize(session.compile(edited, {limits: {maxSyntaxNodes: budget}})))
        .toEqual(normalize(compileLocal(edited, {limits: {maxSyntaxNodes: budget}})));
    }
    const session = createLocalCompileSession();
    session.compile(source);
    session.compile(edited);
    expect(session.stats.parse?.reusedItemNodes ?? 0).toBeGreaterThan(0);
    const changed = session.compile(edited, {markdownBreaks: true});
    expect(normalize(changed)).toEqual(normalize(compileLocal(edited, {markdownBreaks: true})));
    expect(session.stats.mode).toBe('full');
    expect(session.stats.parse?.reusedItemNodes ?? 0).toBe(0);
  });

  it('keeps public snapshots isolated from session mutations', () => {
    const session = createLocalCompileSession();
    const source = listDocument(100, i => `Snapshot ${i}`);
    const result = session.compile(source);
    if (result.ok) result.document.nodes[0].children![0].children![0].children![0].value = 'corrupted';
    const edited = source.replace('Snapshot 50', 'Snapshot fifty');
    expect(normalize(session.compile(edited))).toEqual(normalize(compileLocal(edited)));
  });
});
