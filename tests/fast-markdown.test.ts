import {describe, expect, it} from 'vitest';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {parseFastMarkdown} from '../src/local/fast-markdown';
import {parseLocal} from '../src/local/parser';

const markdown = unified().use(remarkParse).use(remarkGfm);
function comparable(node: any): any {
  const result: any = {type: node.type};
  if (node.type !== 'root') result.position = {start: {offset: node.position.start.offset}, end: {offset: node.position.end.offset}};
  for (const key of ['value', 'ordered', 'start', 'checked', 'align']) if (node[key] !== undefined) result[key] = node[key];
  if (node.children) result.children = node.children.map(comparable);
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
