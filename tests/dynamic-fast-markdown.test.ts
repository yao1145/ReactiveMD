import {afterEach,describe,expect,it,vi} from 'vitest';
import * as fast from '../src/local/fast-markdown';
import {compileLocal} from '../src/local/compiler';
import {parseLocal} from '../src/local/parser';
import {createLocalCompileSession} from '../src/local/incremental';
import {LocalParseSession} from '../src/local/parse-session';

afterEach(()=>vi.restoreAllMocks());
const prefix='<slider bind="n" label="N" initial="2">\n\n';
const fixtures=[
  '- value {{ n }}\n- next **bold** {{ n * 2 }}',
  '- {{ n }}\n- {{ n + 1 }}',
  '| Name | Value |\n| --- | ---: |\n| A | {{ n }} |\n| B | text {{ n + 1 }} |',
  '- value {{ n > 1 ? "x" : "y" }}\n- next {{ [1, 2][0] }}',
  '- 中文😀 {{ n + 1 }}\n- text {{ "` * [x](url)" }}',
];
describe('trusted interpolation fast blocks',()=>{
  it('revalidates cached placeholders against the current parse and offset',()=>{
    const cache=new LocalParseSession(),marker='\ue0000\ue001',image=`![${marker}](rmd-internal:placeholder)`,source='- '+image;
    const placeholders=new Map([[2,{marker,end:source.length}]]);
    expect(fast.planFastMarkdown(source,cache,undefined,{placeholders})).toBeDefined();
    expect(fast.planFastMarkdown(source,cache,undefined,{placeholders:new Map()})).toBeUndefined();
    expect(fast.planFastMarkdown(source,cache,undefined,{placeholders,offset:1})).toBeUndefined();
    expect(fast.planFastMarkdown(source,cache)).toBeUndefined();
  });
  it('also avoids remark during the advisory scan of a simple dynamic list',()=>{
    const source=Array.from({length:1000},(_,i)=>`- Row ${i} **bold** {{ ${i} * 2 }}`).join('\n');
    const parsed=parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.work!.generalBlocks).toBe(0);
    expect(parsed.work!.fastBlocks).toBeGreaterThanOrEqual(2);
  });
  it.each(fixtures)('retains complete general-parser output and budgets for %s',body=>{
    for(const ending of ['\n','\r\n','\r'])for(const limits of [undefined,1,3,8,20]){
      const source=(prefix+body).replace(/\n/g,ending);
      const options=limits===undefined?undefined:{limits:{maxSyntaxNodes:limits}};
      const optimized=compileLocal(source,options);
      const spy=vi.spyOn(fast,'planFastMarkdown').mockReturnValue(undefined);
      const general=compileLocal(source,options);spy.mockRestore();
      expect(optimized).toEqual(general);
    }
  });
  it('scans dynamic rows without submitting their placeholders to remark',()=>{
    const source=prefix+Array.from({length:1000},(_,i)=>`- Row ${i} value {{ n * ${i} }}`).join('\n');
    const parsed=parseLocal(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.work!.fastBlocks).toBeGreaterThan(0);
    // The original-source shielding pass may still use remark (e.g. `*` in an
    // expression). The much larger generated image placeholders must not.
    expect(parsed.work!.fastCharacters).toBeGreaterThan(source.length);
    expect(parsed.work!.generalCharacters).toBeLessThan(source.length+512);
  });
  it('refreshes expression values and dependencies across repeated edits',()=>{
    const session=createLocalCompileSession();
    const initial=prefix+'- value {{ n }}\n- tail {{ n + 1 }}';session.compile(initial);
    for(const value of ['n * 3','42','n + 5']){
      const source=initial.replace('{{ n }}',`{{ ${value} }}`);
      const result=session.compile(source);expect(result.ok).toBe(true);
      if(result.ok){
        const row=result.document.nodes.find(node=>node.type==='list')!.children![0];
        const expression=row.children![0].children!.find(node=>node.type==='interpolation')!;
        expect(expression.value?.trim()).toBe(value);
        expect(result.document.dependencies?.[expression.id]).toEqual(value==='42'?[]:['n']);
      }
    }
  });
  it.each([
    '- [link](/x) {{ n }}\n- tail',
    '- `{{ n }}`\n- **{{ n }}**',
    '- value \\{{ n }}\n- next {{ n }}',
    '- ![\ue0000\ue001](rmd-internal:placeholder) {{ n }}\n- next',
    '- {{ n }}\n  - nested {{ n }}',
    '| A | B |\n| - | - |\n| a\\|b | {{ n }} |',
  ])('keeps unsupported syntax and forged markers equivalent: %s',body=>{
    const source=prefix+body,optimized=compileLocal(source);
    vi.spyOn(fast,'planFastMarkdown').mockReturnValue(undefined);
    expect(optimized).toEqual(compileLocal(source));
  });
});
