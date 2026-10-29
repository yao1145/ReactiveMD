import React,{Profiler,Suspense,startTransition,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as Library from 'reactive-md';
import {LocalDocumentView,LocalReactiveDocument} from 'reactive-md/react';
import type {LocalCompileOutcome,LocalCompileWorker} from 'reactive-md';
import type {LocalCompileOptions,LocalRuntime} from 'reactive-md';
import '../../../src/local/local.css';

const probe:any={requests:[],responses:[],commits:[],inputToFrame:[],inputToPreview:[],outcomes:[],modes:[],longTasks:[],ready:false,compiledSource:null,renderedSource:null,runtimeCreations:0};
(window as any).editingPipeline=probe;
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
class MeasuredWorker implements LocalCompileWorker {
  private worker=new Worker(new URL('./browser-worker.ts',import.meta.url),{type:'module'});
  private behavior=new URLSearchParams(location.search).get('behavior')??'normal';
  private savedResponse:any=null;
  private injected=false;
  onmessage:((event:any)=>void)|null=null;
  onerror:((event:any)=>void)|null=null;
  onmessageerror:((event:any)=>void)|null=null;
  constructor(){
    probe.cancelPreparation=()=>this.worker.postMessage({control:'cancel-preparation'});
    this.worker.onmessage=event=>{
      const data=structuredClone(event.data);
      if(this.behavior==='legacy'&&data.ok&&'result'in data){delete data.protocol;delete data.revision;}
      if(this.behavior==='stale-response'&&data.ok&&'result'in data)this.savedResponse=structuredClone(data);
      if(this.behavior==='stale-response'&&this.savedResponse&&data.ok&&'patch'in data&&!this.injected){
        this.injected=true;probe.injections??=[];probe.injections.push('stale-response');this.deliver(this.savedResponse);
      }
      if(this.behavior==='corrupt-patch'&&data.ok&&'patch'in data&&!this.injected){
        this.injected=true;data.patch.document.roots=['missing-node'];probe.injections??=[];probe.injections.push('corrupt-patch');
      }
      this.deliver(data);
    };
    this.worker.onerror=event=>{probe.workerErrors??=[];probe.workerErrors.push({message:event.message,filename:event.filename,lineno:event.lineno,colno:event.colno});this.onerror?.(event);};
    this.worker.onmessageerror=event=>this.onmessageerror?.(event);
  }
  private deliver(data:any){probe.responses.push({at:performance.now(),bytes:bytes(data),data});this.onmessage?.({data});}
  postMessage(message:any){
    const data=structuredClone(message);
    if(this.behavior==='stale-base'&&'edit'in data&&!this.injected){this.injected=true;data.baseRevision+=1000;probe.injections??=[];probe.injections.push('stale-base');}
    probe.requests.push({at:performance.now(),bytes:bytes(data),data});this.worker.postMessage(data);
  }
  terminate(){this.worker.terminate();}
}
if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>probe.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});

function App(){
  const [source,setSource]=useState('Initial paragraph');
  const [options,setOptions]=useState<LocalCompileOptions|undefined>(undefined);
  const [outcome,setOutcome]=useState<LocalCompileOutcome|null>(null);
  const scheduler=useRef<Library.LocalCompileScheduler|null>(null),runtime=useRef<LocalRuntime|null>(null);
  const input=useRef<{source:string;at:number}|null>(null);
  useEffect(()=>{
    scheduler.current=new Library.LocalCompileScheduler({createWorker:()=>new MeasuredWorker(),shareResults:true,delay:20,onModeChange:(mode:string,detail?:string)=>probe.modes.push({mode,detail}),onResult:value=>{
      probe.compiledSource=value.source;probe.outcomes.push({sourceLength:value.source.length,metrics:value.metrics,duration:value.duration,mode:value.mode});setOutcome(value);
    }});
    probe.installSource=(value:string)=>setSource(value);
    probe.installConcurrent=(value:string)=>startTransition(()=>setSource(value));
    probe.installOptions=(value:LocalCompileOptions|undefined)=>setOptions(value);
    probe.parameter=(value?:number)=>value===undefined?runtime.current?.getParameter('n'):runtime.current?.setParameter('n',value);
    probe.runtimeSource=()=>runtime.current?.document.source;
    probe.runtimeRevision=()=>runtime.current?.snapshot().revision;
    probe.ready=true;
    return()=>{scheduler.current?.dispose();runtime.current?.dispose();};
  },[]);
  useEffect(()=>{scheduler.current?.schedule(source,options);},[source,options]);
  const result=outcome?.result;
  if(result?.ok){
    if(!runtime.current){runtime.current=Library.createLocalRuntime(result.document);probe.runtimeCreations++;}
    else if(runtime.current.document!==result.document){
      if(typeof (Library as any).updateLocalRuntime==='function'){
        const report=(Library as any).updateLocalRuntime(runtime.current,result.document,{notify:false});if(!report.ok)throw new Error('Runtime adoption failed');
      }else{runtime.current.dispose();runtime.current=Library.createLocalRuntime(result.document);probe.runtimeCreations++;}
    }
  }
  useLayoutEffect(()=>{
    if(runtime.current)(Library as any).notifyLocalRuntime?.(runtime.current);
    if(!outcome)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      probe.renderedSource=outcome.source;
      if(input.current?.source===outcome.source){probe.inputToPreview.push(performance.now()-input.current.at);input.current=null;}
    }));
  },[outcome]);
  return <><label>Source<textarea aria-label="Pipeline source" value={source} onChange={event=>{
    const value=event.target.value,at=performance.now();input.current={source:value,at};setSource(value);requestAnimationFrame(()=>probe.inputToFrame.push(performance.now()-at));
  }}/></label><div id="preview"><Profiler id="preview" onRender={(_id,phase,actualDuration,baseDuration,startTime,commitTime)=>probe.commits.push({phase,actualDuration,baseDuration,startTime,commitTime})}>
    {result?.ok&&runtime.current?<LocalDocumentView document={result.document} runtime={runtime.current}/>:null}
  </Profiler></div></>;
}
function PauseOnRequest({source}:{source:string}){
  if(source.includes('PAUSE')){
    probe.suspended=true;
    throw new Promise<void>(resolve=>{probe.resumeSuspended=()=>{probe.suspended=false;resolve();};});
  }
  return null;
}
function DirectApp(){
  const initial='<number label="Amount" bind="amount" initial="2" min="0" max="20">\n\nCommitted base';
  const [source,setSource]=useState(initial);
  useEffect(()=>{
    probe.installConcurrent=(value:string)=>startTransition(()=>setSource(value));
    probe.ready=true;
  },[]);
  return <><textarea aria-label="Pipeline source" value={source} onChange={event=>setSource(event.target.value)}/><Suspense fallback={<p>Concurrent fallback</p>}><LocalReactiveDocument source={source}/><PauseOnRequest source={source}/></Suspense></>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('direct')?<DirectApp/>:<App/>);
