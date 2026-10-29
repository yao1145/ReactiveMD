import {expect,it} from 'vitest';
import {analyzeLocalSource,compileLocal} from '../src/local';

const source=[
  '<theme name="default">',
  '<const name="budgets" value="{{ [150, 200, 220, 120] }}">',
  '<computed name="budget" value="{{ sum(budgets) }}">',
  '',
  '<div align="center"># 一份预算，多种观察方式</div>',
  '',
  '<details open><summary>Read <strong>more</strong></summary>\n\n{{ budget }}\n\n</details>',
].join('\r\n');
function texts(kind:string,cached=false){
  const compiled=compileLocal(source);expect(compiled.ok).toBe(true);
  if(!compiled.ok)throw Error('Invalid fixture');
  const analysis=analyzeLocalSource(source,undefined,cached?{document:compiled.document,diagnostics:false}:{diagnostics:false});
  return analysis.tokens.filter(token=>token.kind===kind).map(token=>source.slice(token.range.start,token.range.end));
}
it('highlights metadata declarations and their references when reusing a compiled document',()=>{
  expect(texts('tag',true)).toEqual(expect.arrayContaining(['theme','const','computed']));
  expect(texts('binding',true)).toEqual(expect.arrayContaining(['budgets','budget']));
  expect(texts('expression',true)).toEqual(expect.arrayContaining(['{{ [150, 200, 220, 120] }}','{{ sum(budgets) }}','{{ budget }}']));
  const result=compileLocal(source);if(!result.ok)throw Error('Invalid fixture');
  expect(analyzeLocalSource(source,undefined,{document:result.document,diagnostics:false}))
    .toEqual(analyzeLocalSource(source,undefined,{diagnostics:false}));
});
it('highlights supported HTML tags and attributes without treating them as local bindings',()=>{
  for(const cached of [false,true]){
    expect(texts('tag',cached)).toEqual(expect.arrayContaining(['div','details','summary','strong']));
    expect(texts('attribute',cached)).toEqual(expect.arrayContaining(['align','open']));
    expect(texts('string',cached)).toContain('center');
  }
});
it('preserves literal shields and ordered token ranges around HTML and metadata',()=>{
  const literal='`<div align="left">`\n\n```\n<const name="ghost" value="{{ 1 }}">\n```\n\n<!-- <div>ignored</div> -->\n\n<widget><const name="hidden" value="{{ 1 }}"></widget>';
  const data=analyzeLocalSource(literal,undefined,{diagnostics:false});
  expect(data.tokens.filter(token=>token.kind==='tag')).toEqual([]);
  expect(data.bindings).toEqual([]);
  const result=compileLocal(source);if(!result.ok)throw Error('Invalid fixture');
  const tokens=analyzeLocalSource(source,undefined,{document:result.document,diagnostics:false}).tokens;
  for(let i=0;i<tokens.length;i++){
    expect(tokens[i].range.end).toBeGreaterThan(tokens[i].range.start);
    if(i)expect(tokens[i].range.start).toBeGreaterThanOrEqual(tokens[i-1].range.end);
  }
});
