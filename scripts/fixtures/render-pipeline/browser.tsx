import React,{Profiler,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactiveMarkdownEditor} from 'reactive-md/editor';
import {LocalPreview} from '../../../demo/src/App';
import {useLocalCompilation} from '../../../demo/src/use-local-compilation';
import {PreviewStateSession} from '../../../demo/src/preview-state';
import '../../../src/theme.css';
import '../../../src/local/local.css';
import 'reactive-md/editor/styles.css';

const probe:any={ready:false,events:[],reactPhases:[],reactRenders:[],editorRenders:[],outcomes:[],responses:[],mutations:[],renderedSource:'',articleReplacements:0,errors:[]};
(window as any).renderProbe=probe;
(globalThis as any).__rmdReactPhase=(name:string,start:number,duration:number)=>probe.reactPhases.push({name,start,duration});
function mark(name:string,detail:any={}){const at=performance.now();probe.events.push({name,at,...detail});performance.mark('rmd:'+name,{detail});return at;}
const NativeWorker=window.Worker;
class MeasuredWorker extends NativeWorker{
  set onmessage(handler:any){super.onmessage=handler?event=>{const at=mark('received',{id:event.data.id});probe.responses.push({at,duration:event.data.duration,metrics:event.data.metrics,stats:event.data.incremental});handler.call(this,event);mark('received-end');}:null;}
  get onmessage(){return super.onmessage;}
  postMessage(message:any,options?:any){if(typeof message.id==='number')mark('posted',{id:message.id});super.postMessage(message,options);}
}
(window as any).Worker=MeasuredWorker;
const images:any[]=[];const report=(diagnostics:any[])=>{if(diagnostics.some(d=>d.severity==='error'))probe.errors.push(diagnostics);};
const compileOptions={limits:{maxSyntaxNodes:100000}};
function App(){
  const [source,setSource]=useState('Ready');
  const fullEditor=new URLSearchParams(location.search).get('editor')==='full';
  const compilation=useLocalCompilation(source,compileOptions,fullEditor);
  const [session,setSession]=useState(()=>new PreviewStateSession());
  const document=compilation.previewDocument;
  const input=useRef({source:'',at:0}),preview=useRef<HTMLDivElement>(null);
  const lastArticle=useRef<Element|null>(null);
  useEffect(()=>{
    probe.install=(next:string)=>{input.current={source:next,at:mark('input')};setSource(next);};
    probe.newSession=()=>setSession(new PreviewStateSession());
    probe.ready=true;
  },[]);
  useEffect(()=>{mark('scheduled');},[source]);
  useLayoutEffect(()=>{
    const target=preview.current;if(!target)return;
    const observer=new MutationObserver(records=>{
      const article=target.querySelector('article');
      if(article){if(lastArticle.current&&lastArticle.current!==article)probe.articleReplacements++;lastArticle.current=article;}
      probe.mutations.push({at:performance.now(),added:records.reduce((n,r)=>n+r.addedNodes.length,0),removed:records.reduce((n,r)=>n+r.removedNodes.length,0)});
      const expected=document?.source.match(/RMD-END-\d+/)?.[0];
      if(expected&&target.textContent?.includes(expected)){
        const source=document!.source;mark('dom-ready');
        requestAnimationFrame(()=>requestAnimationFrame(()=>{if(input.current.source===source){probe.renderedSource=source;mark('frame-ready');}}));
      }
    });
    observer.observe(target,{subtree:true,childList:true,characterData:true});return()=>observer.disconnect();
  },[document]);
  const update=(value:string)=>{input.current={source:value,at:mark('input')};setSource(value);};
  const view=<div id="preview" ref={preview}><Profiler id="preview" onRender={(_id,phase,actualDuration,_base,start,commit)=>probe.reactRenders.push({phase,actualDuration,start,commit})}>
    {document?<LocalPreview document={document} session={session} onDiagnostics={report} images={images}/>:null}
  </Profiler></div>;
  return fullEditor
    ?<Profiler id="editor" onRender={(_id,phase,actualDuration,_base,start,commit)=>probe.editorRenders.push({phase,actualDuration,start,commit})}><ReactiveMarkdownEditor id="source-editor" value={source} onChange={update} compileOptions={compileOptions} analysis={compilation.analysis} document={compilation.result?.ok?compilation.result.document:null} viewMode="split" height={720} ariaLabel="Source" preview={view}/></Profiler>
    :<><textarea aria-label="Source" value={source} onChange={e=>update(e.target.value)}/>{view}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);
