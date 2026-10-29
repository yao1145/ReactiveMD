import {describe, expect, it} from 'vitest';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {parseLocal} from '../src/local/parser';
import type {LocalCompileOptions, LocalNode} from '../src/local/types';

const markdown=unified().use(remarkParse).use(remarkGfm);
function ordinary(source: string): {nodes:LocalNode[];order:LocalNode[]} {
  let serial=0;const order:LocalNode[]=[];
  const transform=(raw:any):LocalNode=>{
    const children=raw.children?.map(transform);
    const node:any={type:raw.type,id:`local-${serial++}`,range:{start:raw.position.start.offset,end:raw.position.end.offset}};
    for(const key of ['value','depth','ordered','start','checked','url','title','alt','lang','align'])if(raw[key]!==undefined)node[key]=raw[key];
    if(children)node.children=children;order.push(node);return node;
  };
  return {nodes:markdown.parse(source).children.map(transform),order};
}
describe('hybrid Markdown pipeline',()=>{
  it('keeps most blocks fast when only one independent block contains a link',()=>{
    const blocks=Array.from({length:80},(_,i)=>i%2?`- Item ${i} with **bold**.\n- next`:`|A|B|\n|-|-|\n|${i}|value|`);
    blocks.splice(40,0,'A [link](/path) with \\*escaped\\* text.');
    const source=blocks.join('\n\n'),parsed=parseLocal(source);
    expect(parsed.nodes).toEqual(ordinary(source).nodes);
    expect(parsed.work!.fastBlocks).toBeGreaterThanOrEqual(80);
    expect(parsed.work!.generalBlocks).toBe(1);
    expect(parsed.work!.generalCharacters).toBeLessThan(source.length/10);
  });
  it('reports exact preflight budget ranges without building a generic tree',()=>{
    const source=Array.from({length:100},(_,i)=>`- Item ${i} with **bold**.`).join('\n');
    const expected=ordinary(source);
    for(const budget of [1,2,3,5,99,300]) {
      const parsed=parseLocal(source,{limits:{maxSyntaxNodes:budget}});
      expect(parsed.nodes).toEqual([]);
      expect(parsed.diagnostics).toContainEqual(expect.objectContaining({code:'local.budget',range:expected.order[budget].range}));
      expect(parsed.work!.generalBlocks).toBe(0);
    }
  });
  it('keeps mapping storage proportional to fragments in an indented container',()=>{
    const source='<panel>\n    '+ 'plain words '.repeat(5000)+'\n</panel>';
    const parsed=parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes[0].name).toBe('panel');
    expect(parsed.work!.mappingSegments).toBeLessThan(15);
    const texts:LocalNode[]=[];
    const visit=(nodes:LocalNode[])=>{for(const n of nodes){if(n.type==='text')texts.push(n);if(n.children)visit(n.children);}};visit(parsed.nodes);
    expect(texts[0].range.start).toBe(source.indexOf('plain'));
    expect(texts[0].value).toBe('plain words '.repeat(5000).trimEnd());
  });
  it('preserves budgets after lexical tokens have already consumed nodes',()=>{
    const source='<slider bind="n" label="N">\n\n- One\n- Two\n\nValue {{ n }}';
    for(let budget=1;budget<16;budget++) {
      const parsed=parseLocal(source,{limits:{maxSyntaxNodes:budget}});
      if(parsed.diagnostics.length)expect(parsed.nodes).toEqual([]);
      else expect(parsed.syntaxNodes).toBeLessThanOrEqual(budget);
    }
  });
});

describe('deterministic parse budgets',()=>{
  it('rejects deep Markdown nesting before parsing, with an inclusive limit',()=>{
    const atLimit='> '.repeat(1000)+'text';
    const accepted=parseLocal(atLimit);
    expect(accepted.diagnostics).toEqual([]);
    expect(accepted.work!.maxMarkdownDepth).toBe(1000);

    const deep='> '.repeat(1001)+'text';
    const rejected=parseLocal(deep);
    expect(rejected.nodes).toEqual([]);
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
      code:'local.budget',
      messageKey:'local.budget.markdown-depth',
      params:{limit:1000},
    }));
    expect(parseLocal(deep,{limits:{maxMarkdownDepth:2000}}).diagnostics).toEqual([]);
  });
  it('never mistakes fenced, indented or inline code for Markdown containers',()=>{
    const source=[
      '```',
      '> '.repeat(1200)+'quoted looking code',
      '- '.repeat(1200)+'list looking code',
      '```',
      '',
      '    > indented code',
      '    - indented code',
      '',
      '`> '+' > '.repeat(1200)+'`',
    ].join('\n');
    expect(parseLocal(source).diagnostics).toEqual([]);
  });
  it('enforces a configurable parse-work budget and allows raising it',()=>{
    const source='hello world';
    const rejected=parseLocal(source,{limits:{maxParseWork:1}});
    expect(rejected.nodes).toEqual([]);
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
      code:'local.budget',
      messageKey:'local.budget.parse-work',
      params:{limit:1},
    }));
    expect(parseLocal(source,{limits:{maxParseWork:1_000_000}}).nodes).toEqual(parseLocal(source).nodes);
  });
  it('validates the new limit values and rejects unknown limit keys',()=>{
    for(const value of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'5',null,true]) {
      const parsed=parseLocal('hello',{limits:{maxParseWork:value}} as unknown as LocalCompileOptions);
      expect(parsed.nodes).toEqual([]);
      expect(parsed.diagnostics[0]).toEqual(expect.objectContaining({code:'local.options.invalid'}));
      expect(parsed.diagnostics[0].message).toContain('maxParseWork');
      const depth=parseLocal('hello',{limits:{maxMarkdownDepth:value}} as unknown as LocalCompileOptions);
      expect(depth.diagnostics[0]).toEqual(expect.objectContaining({code:'local.options.invalid'}));
      expect(depth.diagnostics[0].message).toContain('maxMarkdownDepth');
    }
    expect(parseLocal('hello',{limits:{maxParseWork:10,maxMarkdownDepth:10}}).diagnostics).toEqual([]);
    const unknown=parseLocal('hello',{limits:{maxParseWork:10,bogus:1}} as unknown as LocalCompileOptions);
    expect(unknown.nodes).toEqual([]);
    expect(unknown.diagnostics[0]).toEqual(expect.objectContaining({
      code:'local.options.invalid',
      messageKey:'local.options.invalid.limits-unknown',
      params:{detail:'bogus'},
    }));
  });
});
