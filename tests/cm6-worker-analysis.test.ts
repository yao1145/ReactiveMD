import {afterEach,expect,it,vi} from 'vitest';
import {LocalCompileScheduler,startLocalCompileWorker,type LocalCompileWorker,type LocalCompileWorkerRequest,type LocalCompileWorkerScope,type LocalCompileOutcome} from '../src/local/worker';
import {localCompileOptionsKey} from '../src/local/options';
import {compileLocal} from '../src/local/compiler';

afterEach(()=>vi.useRealTimers());
function bridge(includeAuthorAnalysis=true){
  vi.useFakeTimers();
  const messages:LocalCompileWorkerRequest[]=[],results:LocalCompileOutcome[]=[];
  const scope:LocalCompileWorkerScope={onmessage:null,postMessage:response=>worker.onmessage?.({data:structuredClone(response)})};
  const worker:LocalCompileWorker={onmessage:null,onerror:null,onmessageerror:null,terminate:()=>{},postMessage(request){messages.push(request);scope.onmessage?.({data:request});}};
  const control=startLocalCompileWorker(scope);
  const scheduler=new LocalCompileScheduler({createWorker:()=>worker,includeAuthorAnalysis,delay:0,onResult:result=>results.push(result)});
  return{scheduler,results,messages,dispose(){scheduler.dispose();control.dispose();}};
}
it('reuses the compiled document for full and patched author analysis',()=>{
  const b=bridge();
  const source='<number bind="n" label="N" initial="2">\n\n{{ n }}';
  b.scheduler.schedule(source);vi.advanceTimersByTime(0);
  expect(b.results[0].analysis?.bindings.find(item=>item.name==='n')?.references).toHaveLength(1);
  expect(b.results[0].metrics?.worker?.analysisMs).toBeGreaterThanOrEqual(0);
  const next=source+' and {{ n }}';
  b.scheduler.schedule(next,undefined,{baseSource:source,edit:{from:source.length,to:source.length,insert:' and {{ n }}'}});vi.advanceTimersByTime(0);
  expect(b.messages[1]).toMatchObject({baseRevision:1,includeAuthorAnalysis:true,edit:{from:source.length,to:source.length,insert:' and {{ n }}'}});
  expect(b.results[1].source).toBe(next);
  expect(b.results[1].analysis?.bindings[0].references).toHaveLength(2);
  b.dispose();
});
it('keeps analysis optional and respects syntax budgets',()=>{
  const b=bridge(false);b.scheduler.schedule('hello');vi.advanceTimersByTime(0);
  expect(b.messages[0]).not.toHaveProperty('includeAuthorAnalysis');expect(b.results[0]).not.toHaveProperty('analysis');b.dispose();
  const limited=bridge();limited.scheduler.schedule('hello',{limits:{maxSyntaxNodes:1}});vi.advanceTimersByTime(0);
  expect(limited.results[0].result.ok).toBe(false);expect(limited.results[0].analysis).toEqual({tokens:[],bindings:[],diagnostics:[]});limited.dispose();
});
it('keeps syntax highlighting available while an expression has a semantic error',()=>{
  const b=bridge();
  const source='<const name="budgets" value="{{ [1, 2] }}">\n<computed name="total" value="{{ sum(missing) }}">\n\n<div align="center">Budget</div>';
  b.scheduler.schedule(source);vi.advanceTimersByTime(0);
  expect(b.results[0].result.ok).toBe(false);
  const tags=b.results[0].analysis?.tokens.filter(token=>token.kind==='tag').map(token=>source.slice(token.range.start,token.range.end));
  expect(tags).toEqual(expect.arrayContaining(['const','computed','div']));b.dispose();
});
it('drops stale analysis and falls back to source diff when a hint has a different baseline',()=>{
  const b=bridge();b.scheduler.schedule('base');vi.advanceTimersByTime(0);
  b.scheduler.schedule('latest',undefined,{baseSource:'other',edit:{from:0,to:5,insert:'latest'}});vi.advanceTimersByTime(0);
  expect(b.messages[1]).toMatchObject({edit:{from:0,to:4,insert:'latest'}});expect(b.results[1].source).toBe('latest');b.dispose();
});
it('ignores malformed author ranges without losing a valid compile result',()=>{
  vi.useFakeTimers();let sent:LocalCompileWorkerRequest|undefined;const results:LocalCompileOutcome[]=[];
  const worker:LocalCompileWorker={onmessage:null,onerror:null,onmessageerror:null,terminate(){},postMessage(message){sent=message;}};
  const scheduler=new LocalCompileScheduler({createWorker:()=>worker,includeAuthorAnalysis:true,delay:0,onResult:r=>results.push(r)});
  scheduler.schedule('hello');vi.advanceTimersByTime(0);
  worker.onmessage?.({data:{id:sent!.id,ok:true,result:compileLocal('hello'),duration:1,analysis:{tokens:[{kind:'tag',range:{start:0,end:100}}],bindings:[],diagnostics:[]}}});
  expect(results[0].result.ok).toBe(true);expect(results[0].analysis).toBeUndefined();scheduler.dispose();
});
