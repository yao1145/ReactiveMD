import {describe,it,expect} from 'vitest';
import {createLocalCompileSession} from '../src/local/incremental';
import {compileLocal} from '../src/local/compiler';

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
});
