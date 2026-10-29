import {describe,expect,it} from 'vitest';
import {plainCompiledData} from '../src/local/compiled-data';
import {cloneLocalCompileResult} from '../src/local/compile-patch';
import {shareCompiledData} from '../src/local/shared-data';
import {parseLocal} from '../src/local/parser';
import {walkLocalNodes} from '../src/local/node-walk';
import {compileLocal} from '../src/local/compiler';
import {createLocalRuntime,updateLocalRuntime} from '../src/local/runtime';
import {projectAnchors,projectFootnotes} from '../src/local/view-revision';
import {collectLocalFootnotes} from '../src/local/footnotes';

function chain(depth:number){let node:any={value:'leaf',missing:undefined};for(let i=0;i<depth;i++)node={children:[node]};return node;}
function leaf(value:any,depth:number){for(let i=0;i<depth;i++)value=value.children[0];return value;}
describe('deep plain compiler data',()=>{
  it('indexes and adopts deep runtime and view documents without recursion',()=>{
    const result=compileLocal('');expect(result.ok).toBe(true);if(!result.ok)return;
    const root=chain(6000);let index=0;
    for(const node of walkLocalNodes([root]))Object.assign(node,{id:`deep-${index++}`,type:'blockquote',range:{start:0,end:0}});
    const document={...result.document,nodes:[root]};
    const runtime=createLocalRuntime(document);
    try{
      expect(updateLocalRuntime(runtime,{...document,source:'next'}).ok).toBe(true);
      expect(projectAnchors(document).nodes).toEqual([]);
      expect(projectFootnotes(document).nodes).toEqual([]);
      expect(collectLocalFootnotes(document,'test').entries).toEqual([]);
    }finally{runtime.dispose();}
  });
  it('walks 6000 levels in both source and children-first order',()=>{
    const root=chain(6000);
    const preorder=Array.from(walkLocalNodes([root])),postorder=Array.from(walkLocalNodes([root],true));
    expect(preorder.length).toBe(6001);expect(postorder.length).toBe(6001);
    expect(preorder[0]).toBe(root);expect(postorder.at(-1)).toBe(root);
    expect(preorder.at(-1)).toBe(leaf(root,6000));expect(postorder[0]).toBe(leaf(root,6000));
  });
  it.each(['- '.repeat(1000),'> - '.repeat(500)])('compiles a thousand nested list/quote containers',prefix=>{
    const result=compileLocal(prefix+'{{ 1 + 2 }}');
    expect(result.ok).toBe(true);
    if(result.ok){
      const nodes=Array.from(walkLocalNodes(result.document.nodes));
      expect(nodes.filter(node=>node.type==='list'||node.type==='blockquote').length).toBe(1000);
      expect(nodes.at(-1)!.value).toBe('1 + 2');
    }
  },30000);
  it('does not reparse each plain container body to discover absent inline syntax',()=>{
    const parsed=parseLocal('<panel>\n'.repeat(20)+'text\n'+'</panel>\n'.repeat(20));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.work!.markdownCalls).toBeLessThanOrEqual(23);
  });
  it('stops over-deep component parsing before converting partial containers',()=>{
    const parsed=parseLocal('<panel>\n'.repeat(1000)+'text\n'+'</panel>\n'.repeat(1000));
    expect(parsed.nodes).toEqual([]);
    expect(parsed.diagnostics.map(d=>d.messageKey)).toEqual(['local.budget.nesting']);
    expect(parsed.work!.maxComponentDepth).toBe(101);
  });
  it.each([['publication',plainCompiledData],['snapshot',cloneLocalCompileResult]] as const)('%s copies 6000 levels without recursion',(_name,copy)=>{
    const original=chain(6000),result=copy(original);
    expect(leaf(result,6000).value).toBe('leaf');
    expect(leaf(result,6000)).not.toBe(leaf(original,6000));
    expect(Object.hasOwn(leaf(result,6000),'missing')).toBe(true);
  });
  it('shares an equivalent deep revision without recursive comparisons',()=>{
    const before=chain(6000),after=chain(6000);
    expect(shareCompiledData(before,after).value).toBe(before);
  });
});
