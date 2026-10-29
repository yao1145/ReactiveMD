import {describe, expect, it} from 'vitest';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {parseFastMarkdown, planFastMarkdown, type FastMarkdownCache} from '../src/local/fast-markdown';
import {parseLocal} from '../src/local/parser';

const markdown = unified().use(remarkParse).use(remarkGfm);
function comparable(node: any): any {
  const result: any = {type: node.type};
  if (node.type !== 'root') result.position = {start: {offset: node.position.start.offset}, end: {offset: node.position.end.offset}};
  for (const key of ['value', 'ordered', 'start', 'checked', 'align']) if (node[key] !== undefined) result[key] = node[key];
  if (node.children) result.children = node.children.map(comparable);
  return result;
}

/** Emit a plan with the same id/range shape parseLocal's transform produces. */
function emitPlan(source: string): any[] {
  const plan = planFastMarkdown(source);
  expect(plan).toBeDefined();
  let serial = 0;
  return plan!.emit((type, start, end, extra) => {
    const node: any = {type, id: `local-${serial++}`, range: {start, end}};
    for (const key of ['value', 'ordered', 'start', 'checked', 'align']) {
      const value = extra ? (extra as any)[key] : undefined;
      if (value !== undefined) node[key] = value;
    }
    if (extra?.children !== undefined) node.children = extra.children;
    return node;
  });
}

/** Children-first order, matching the old remark transform's construction. */
function postOrder(nodes: any[], order: any[] = []): any[] {
  for (const node of nodes) {
    postOrder(node.children ?? [], order);
    order.push(node);
  }
  return order;
}

/** Convert emitted `LocalNode`s into the shape `comparable` returns. */
function planComparable(node: any): any {
  const result: any = {type: node.type};
  if (node.type !== 'root') result.position = {start: {offset: node.range.start}, end: {offset: node.range.end}};
  for (const key of ['value', 'ordered', 'start', 'checked', 'align']) if (node[key] !== undefined) result[key] = node[key];
  if (node.children) result.children = node.children.map(planComparable);
  return result;
}
describe('conservative list and table scanning', () => {
  it.each([
    '- one\n- two', '+ one\n+ two', '* one\n* two', '3) one\n4) two', '01. one\n02. two',
    '- Item with **formatting** and value.\n- **中文** 🙂',
    'Introduction\n\n- **one**\n- two\n\nAfter',
    '| A | B |\n| --- | :---: |\n| x | y |', '|a||\n|:-|-:|\n||🙂|',
    '| **A** | B |\n| --- | --- |\n| x **two** | 3 |',
    'Before\n\n|A|\n|-|\n| x |\n\nAfter', '|a|b|\n|-|-|',
  ])('matches the existing Markdown tree for %j', source => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const text = source.replace(/\n/g, ending);
      const fast = parseFastMarkdown(text);
      expect(fast).toBeDefined();
      expect(comparable(fast)).toEqual(comparable(markdown.parse(text)));
    }
  });

  it.each([
    '- one\n\n- two', '- one\n  - nested', '- one\ncontinued', '- [x] done', '- # heading',
    '- one\n+ two', 'one\n- two', '- a\\*b', '- a_underscore', '- ***nested***', '- *emphasis*',
    '| A | B |\n| --- | --- |\n| x |', '| A | B |\n| --- | --- |\n| x | y | z |',
    '| A |\n|---|\n| `a\\|b` |', '| A |\n|---|\n| [link](/path) |',
    '| A |\n|---|\n| &amp; |', '| A |\n|---|\n| {{ n }} |', 'A\n---', '- a@b.com',
    '- www.example.com', '- ** open**', '- **closed **', '- **a**b', '- a**b**',
    '- a\tvalue', '- one  \n- two', '- one\n \n- two', '\ufeff- one',
  ])('delegates ambiguous syntax to remark for %j', source => {
    expect(parseFastMarkdown(source)).toBeUndefined();
  });

  it('matches generated mixed blocks and preserves compiler IDs and budgets', () => {
    for (let i = 1; i <= 60; i++) {
      const list = Array.from({length: 1 + i % 10}, (_,n) => `${i % 2 ? '-' : `${n+1}.`} Item ${n} with **bold**.`).join('\n');
      const table = '|A|B|\n|:-|-:|\n' + Array.from({length: i % 8 + 1}, (_,n) => `| ${n} | **value** ${i} |`).join('\n');
      const source = `Before ${i}\n\n${list}\n\n${table}\n\nAfter ${i}`;
      expect(comparable(parseFastMarkdown(source))).toEqual(comparable(markdown.parse(source)));
      // The transform creates children first and enforces the same cumulative budget.
      const expected: any[] = [];
      let serial = 0;
      const transform = (raw: any): any => {
        const children = raw.children?.map(transform);
        const n: any = {type: raw.type, id: `local-${serial++}`, range: {start: raw.position.start.offset, end: raw.position.end.offset}};
        for (const k of ['value','ordered','start','checked','align']) if(raw[k] !== undefined) n[k] = raw[k];
        if(children) n.children = children;
        expected.push(n); return n;
      };
      const roots = markdown.parse(source).children.map(transform);
      expect(parseLocal(source).nodes).toEqual(roots);
      for (const budget of [1, 3, 10]) expect(parseLocal(source, {limits: {maxSyntaxNodes: budget}}).diagnostics[0].range).toEqual(expected[budget].range);
    }
  });

  it('agrees with remark whenever the scanner accepts adversarial block combinations', () => {
    const blocks = ['plain', '**bold**.', '***', '- one\n- two', '1. **word**\n2. next', '- one\n\n- two',
      '---', 'title\n===', '    code', '|A|B|\n|-|-|\n|a|b|', '|A|\n|-|', '|a|b|',
      '> quote', '- # heading', 'one\ntwo', '- * * *', '- **a**--', '- **a**🙂', 'empty\n ',
      '- 中文\n- 🙂', '|**a**|\n|:-:|\n| **b** |'];
    for (const first of blocks) for (const second of blocks) for (const gap of ['\n', '\n\n']) {
      const source = first + gap + second, fast = parseFastMarkdown(source);
      if (fast) expect(comparable(fast)).toEqual(comparable(markdown.parse(source)));
    }
  });
});

describe('fast markdown plan', () => {
  it.each([
    'Just plain words.',
    'A **bold** phrase.',
    'Plain **bold** text.',
    'A **中文** 🙂',
    '- one\n- two',
    '3) **one**\n4) two',
    '| A | B |\n| --- | :---: |\n| x | **y** |',
    '|a||\n|:-|-:|\n||🙂|',
    'Before\n\n- **one**\n- two\n\n|A|B|\n|-|-|\n| x | **y** |\n\nAfter',
  ])('emits the remark tree children-first for %j', source => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const text = source.replace(/\n/g, ending);
      const nodes = emitPlan(text);
      expect(planComparable({type: 'root', range: {start: 0, end: text.length}, children: nodes}))
        .toEqual(comparable(markdown.parse(text)));
      expect(nodes).toEqual(parseLocal(text).nodes);
    }
  });

  it('constructs every node children-first without an intermediate tree', () => {
    const source = '- **one**\n- two';
    const order: string[] = [];
    const plan = planFastMarkdown(source)!;
    plan.emit((type, start, end, extra) => {
      order.push(`${type}:${start}-${end}`);
      return {type, id: `${order.length - 1}`, range: {start, end}, ...(extra ?? {})} as any;
    });
    expect(order).toEqual([
      'text:4-7', 'strong:2-9', 'paragraph:2-9', 'listItem:0-9',
      'text:12-15', 'paragraph:12-15', 'listItem:10-15', 'list:0-15',
    ]);
  });

  it('reports exact counts and the budget overflow position', () => {
    const source = 'Before\n\n- **one**\n- two\n\n|A|B|\n|-|-|\n| x | **y** |\n\nAfter';
    const plan = planFastMarkdown(source)!;
    const emitted = emitPlan(source);
    const order = postOrder(emitted);
    expect(plan.nodeCount).toBe(order.length);
    expect(plan.blockCount).toBe(emitted.length);
    for (let remaining = 0; remaining < order.length; remaining++) {
      expect(plan.overflowAt(remaining)).toEqual(order[remaining].range);
    }
    expect(plan.overflowAt(order.length)).toBeUndefined();
    expect(plan.overflowAt(order.length + 5)).toBeUndefined();
    // The legacy transform enforces the same cumulative budget and range.
    for (const budget of [1, 3, 7, 10]) {
      expect(plan.overflowAt(budget)).toEqual(parseLocal(source, {limits: {maxSyntaxNodes: budget}}).diagnostics[0].range);
    }
  });

  it('plans single-line prose the legacy scanner deliberately leaves to remark', () => {
    for (const source of ['Just plain words.', 'A **bold** phrase.']) {
      expect(parseFastMarkdown(source)).toBeUndefined();
      const plan = planFastMarkdown(source);
      expect(plan).toBeDefined();
      expect(plan!.nodeCount).toBeGreaterThan(0);
      expect(plan!.blockCount).toBe(1);
      expect(plan!.overflowAt(0)?.start).toBe(0);
      expect(plan!.overflowAt(plan!.nodeCount)).toBeUndefined();
    }
  });

  it.each([
    '- one\n\n- two', '- one\n  - nested', '- one\ncontinued', '- [x] done', '- # heading',
    'one\n- two', 'A *emphasis* line.', 'x < y', 'a | b', '{{ n }}', '$x$',
    '# heading', 'line  ', '    code', '- a\\*b', '- a_underscore', 'a\tvalue',
  ])('never exposes a plan for unsupported syntax %j', source => {
    expect(planFastMarkdown(source)).toBeUndefined();
  });
});

/** Minimal cache with explicit hit/miss bookkeeping for reuse assertions. */
function fakeCache(): { cache: FastMarkdownCache; counters: {
  planHits: number; planMisses: number; inlineHits: number; inlineMisses: number;
  blocks: number; rows: number; items: number;
} } {
  const plans = new Map<string, {value: any}>();
  const inline = new Map<string, {value: any}>();
  const counters = {
    planHits: 0, planMisses: 0, inlineHits: 0, inlineMisses: 0, blocks: 0, rows: 0, items: 0,
  };
  const cache: FastMarkdownCache = {
    readPlan(text) {
      const entry = plans.get(text);
      if (!entry) { counters.planMisses += 1; return {hit: false}; }
      counters.planHits += 1;
      return {hit: true, value: entry.value};
    },
    writePlan(text, value) { plans.set(text, {value}); },
    readInline(text) {
      const entry = inline.get(text);
      if (!entry) { counters.inlineMisses += 1; return {hit: false}; }
      counters.inlineHits += 1;
      return {hit: true, value: entry.value};
    },
    writeInline(text, value) { inline.set(text, {value}); },
    notePlanReuse() { counters.blocks += 1; },
    noteInlineReuse(kind) { if (kind === 'row') counters.rows += 1; else counters.items += 1; },
  };
  return {cache, counters};
}

describe('fast markdown session reuse', () => {
  it('reuses a whole plan for identical block text without changing emission', () => {
    const {cache, counters} = fakeCache();
    const source = '|A|B|\n|-|-|\n|x|**y**|';
    const first = planFastMarkdown(source, cache)!;
    const second = planFastMarkdown(source, cache)!;
    expect(second).toBe(first);
    expect(counters.planHits).toBe(1);
    expect(counters.blocks).toBe(1);
    let serial = 0;
    const emitted = second.emit((type, start, end, extra) => {
      const node: any = {type, id: `local-${serial++}`, range: {start, end}};
      for (const key of ['value', 'ordered', 'start', 'checked', 'align']) {
        const value = extra ? (extra as any)[key] : undefined;
        if (value !== undefined) node[key] = value;
      }
      if (extra?.children !== undefined) node.children = extra.children;
      return node;
    });
    expect(emitted).toEqual(parseLocal(source).nodes);
  });

  it('reuses unchanged table rows when one row changes', () => {
    const {cache, counters} = fakeCache();
    planFastMarkdown('|A|B|\n|-|-|\n|one|two|\n|one|two|', cache);
    const before = counters.rows;
    planFastMarkdown('|A|B|\n|-|-|\n|one|two|\n|one|**two**|', cache);
    expect(counters.rows).toBeGreaterThan(before);
  });

  it('reuses unchanged list items when one item changes', () => {
    const {cache, counters} = fakeCache();
    planFastMarkdown('- one\n- two', cache);
    const before = counters.items;
    planFastMarkdown('- one\n- **two**', cache);
    expect(counters.items).toBeGreaterThan(before);
  });

  it('caches rejected plans instead of rescanning unsupported text', () => {
    const {cache, counters} = fakeCache();
    expect(planFastMarkdown('x < y', cache)).toBeUndefined();
    expect(planFastMarkdown('x < y', cache)).toBeUndefined();
    expect(counters.planHits).toBe(1);
    expect(counters.blocks).toBe(0);
  });
});
