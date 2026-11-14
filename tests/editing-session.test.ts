import {describe,it,expect} from 'vitest';
import {createLocalCompileSession} from '../src/local/session/incremental';
import {compileLocal} from '../src/local/compilation/compiler';
import type {LocalCompileResult,LocalNode} from '../src/local/contracts/types';

/** Incremental blocks carry renamed node ids; compare everything else exactly. */
function canonical(result:LocalCompileResult):unknown {
  const ids=new Map<string,string>();
  const visit=(nodes:readonly LocalNode[]|undefined)=>{for(const node of nodes??[]){ids.set(node.id,`node-${ids.size}`);visit(node.children);}};
  if(result.ok)visit(result.document.nodes);
  return JSON.parse(JSON.stringify(result),(_key,value)=>{
    if(typeof value==='string')return ids.get(value)??value;
    if(value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[ids.get(k)??k,v]));
    return value;
  });
}

describe('persistent editing sessions',()=>{
  const source=(n:number)=>`<slider bind="n" label="N" initial="${n}">\n\nFirst paragraph\n\nValue {{ n * 2 }}\n\nLast paragraph`;
  it('shares unchanged nodes internally and keeps public results independent',()=>{
    const session=createLocalCompileSession();
    const one=session.compileShared(source(2));
    const two=session.compileShared(source(3));
    expect(two).toEqual(compileLocal(source(3)));
    if(one.ok&&two.ok)expect(two.document.nodes[1]).toBe(one.document.nodes[1]);
    const publicResult=session.compile(source(3));
    if(publicResult.ok)publicResult.document.nodes[1].children![0].value='corrupted';
    expect(session.compileShared(source(3))).toEqual(compileLocal(source(3)));
    expect(session.stats.sharedNodes).toBeGreaterThan(0);session.dispose();
  });
  it('prepares an index during idle work without changing the visible result',async()=>{
    const session=createLocalCompileSession();session.compileShared(source(2));session.compileShared(source(3));
    expect(session.hasPendingPreparation).toBe(true);
    const before=session.compileShared(source(3));
    expect(await session.prepareAsync(undefined,()=>Promise.resolve())).toBe(true);
    expect(session.hasPendingPreparation).toBe(false);
    expect(session.compileShared(source(3))).toBe(before);
    session.compileShared(source(3).replace('Last paragraph','Last paragraph edited'));
    expect(session.stats).toMatchObject({mode:'incremental',compiledBlocks:1,cacheBuilds:0});session.dispose();
  });
  it('revokes older preparation after edits, cancellation and disposal',async()=>{
    for(const action of ['edit','cancel','clear','dispose']) {
      const session=createLocalCompileSession();session.compileShared(source(2));session.compileShared(source(3));
      const signal={aborted:false};let released!:()=>void;
      const pending=session.prepareAsync(signal,()=>new Promise(resolve=>{released=resolve;}));
      if(action==='edit')session.compileShared(source(4));
      if(action==='cancel')signal.aborted=true;
      if(action==='clear')session.clear();
      if(action==='dispose')session.dispose();
      released();expect(await pending).toBe(false);
      if(action!=='dispose'){expect(session.compileShared(source(5))).toEqual(compileLocal(source(5)));session.dispose();}
    }
  });
  it('matches a full compile when list lazy continuation crosses Markdown block boundaries',()=>{
    const session=createLocalCompileSession();
    const before='p\n\n* one\n  * x',after='p\n\n* one\n  *\n x';
    expect(canonical(session.compile(before))).toEqual(canonical(compileLocal(before)));
    expect(canonical(session.compile(after))).toEqual(canonical(compileLocal(after)));
    const edited=after.replace('p','q');
    expect(canonical(session.compile(edited))).toEqual(canonical(compileLocal(edited)));
    session.dispose();
  });
  it('matches a full compile when a lone carriage return separates lines',()=>{
    const session=createLocalCompileSession();
    const before='a\n\nb\n\nc',after='a\n\nb\r\n\r=\nc';
    expect(canonical(session.compile(before))).toEqual(canonical(compileLocal(before)));
    expect(canonical(session.compile(after))).toEqual(canonical(compileLocal(after)));
    const edited=after.replace('a','z');
    expect(canonical(session.compile(edited))).toEqual(canonical(compileLocal(edited)));
    session.dispose();
  });
  it('matches a full compile when a table line becomes a lazy continuation of a list item',()=>{
    const session=createLocalCompileSession();
    const before='* one\n  x\n\n中文 😀\n\n* one\n  * x\n\np\n* q\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',after=before.replace('q\n\n|','q\n|');
    expect(canonical(session.compile(before))).toEqual(canonical(compileLocal(before)));
    expect(canonical(session.compile(after))).toEqual(canonical(compileLocal(after)));
    const edited=after.replace('中文','中文段落');
    expect(canonical(session.compile(edited))).toEqual(canonical(compileLocal(edited)));
    session.dispose();
  });
  it('matches a full compile when a component line runs into the following Markdown',()=>{
    const session=createLocalCompileSession();
    const before='<slider bind="n" label="N" initial="2">\n1. first\n* one\n\n    indented\npara one\n\n---\n\n## Heading';
    const after=before.replace('indented','inden{{ n * 2 }}ted');
    expect(canonical(session.compile(before))).toEqual(canonical(compileLocal(before)));
    expect(canonical(session.compile(after))).toEqual(canonical(compileLocal(after)));
    session.dispose();
  });
});
