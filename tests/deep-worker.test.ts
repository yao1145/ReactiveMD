import {describe,expect,it,vi} from 'vitest';
import {LocalCompileScheduler,startLocalCompileWorker,type LocalCompileWorker,type LocalCompileWorkerResponse} from '../src/local/worker';

describe('deep worker results',()=>{
  it.each([false,true])('delivers deep edits and recovers from invalid flat frames (corrupt=%s)',async corrupt=>{
    vi.useFakeTimers();
    const frames:LocalCompileWorkerResponse[]=[],requests:unknown[]=[],results:any[]=[];
    let damaged=false;
    const scope={onmessage:null as any,postMessage(frame:any){
      frames.push(frame);
      if(corrupt&&'flatResult'in frame&&!damaged){frame={...frame,flatResult:{version:'flat-v1',records:[[2,[['bad',0]]]]}};damaged=true;}
      const copy=structuredClone(frame);
      queueMicrotask(()=>worker.onmessage?.({data:copy}));
    }};
    const control=startLocalCompileWorker(scope,{preparationDelay:60000});
    const worker:LocalCompileWorker={onmessage:null,onerror:null,onmessageerror:null,terminate(){},postMessage(request){requests.push(request);scope.onmessage({data:request});}};
    const scheduler=new LocalCompileScheduler({createWorker:()=>worker,onResult:result=>results.push(result),delay:0});
    try{
      for(const [index,source]of ['> '.repeat(1000)+'{{ 1 + 2 }}','> '.repeat(1000)+'{{ 3 + 4 }}','> '.repeat(1001)+'text','ordinary text'].entries()){
        scheduler.schedule(source);await vi.advanceTimersByTimeAsync(0);
        expect(results.length).toBe(index+1);
        expect(results[index].source).toBe(source);
        expect(results[index].mode).toBe('worker');
        if(index===2)expect(results[index].result.diagnostics[0].messageKey).toBe('local.budget.markdown-depth');
        else expect(results[index].result.ok).toBe(true);
      }
      expect(frames.filter(frame=>'flatResult'in frame).length).toBe(corrupt?3:2);
      expect(requests.length).toBe(corrupt?5:4);
    }finally{scheduler.dispose();control.dispose();vi.useRealTimers();}
  });
  it('keeps unnegotiated peers on classic frames',()=>{
    const frames:any[]=[],scope={onmessage:null as any,postMessage(frame:any){frames.push(frame);}};
    const control=startLocalCompileWorker(scope,{preparationDelay:60000});
    try{
      scope.onmessage({data:{id:1,source:'> '.repeat(500)+'text'}});
      expect(frames[0].result.ok).toBe(true);
      expect('flatResult'in frames[0]).toBe(false);
    }finally{control.dispose();}
  });
});
