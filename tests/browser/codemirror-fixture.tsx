import {StrictMode,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactiveMarkdownCodeEditor,type ReactiveMarkdownCodeEditorHandle,type EditorTransaction} from 'reactive-md/editor/codemirror';
import {ReactiveMarkdownEditor,type ReactiveMarkdownEditorHandle} from 'reactive-md/editor';
import {useLocalCompilation} from '../../demo/src/use-local-compilation';
import {LocalPreview} from '../../demo/src/App';
import {PreviewStateSession} from '../../demo/src/preview-state';
import '../../src/theme.css';
import '../../src/local/local.css';
import 'reactive-md/editor/codemirror/styles.css';
const cm=new URLSearchParams(location.search).get('engine')!=='textarea';
const privateAnalysis=new URLSearchParams(location.search).has('private');
const probe:any={events:[],transactions:[],commits:[],errors:[],responses:[],workers:0};
(window as any).cmProbe=probe;
const originalError=console.error.bind(console);
console.error=(...args)=>{
  probe.errors.push({message:args.map(String).join(' '),hostLength:probe.hostSource?.length,
    transactions:probe.transactions.slice(-5).map((tr:any)=>({before:tr.previousSource.length,after:tr.source.length,changes:tr.changes})),
    commits:probe.commits.slice(-5).map((commit:any)=>({at:commit.at,length:commit.source.length}))});
  originalError(...args);
};
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{
  constructor(...args:ConstructorParameters<typeof Worker>){super(...args);probe.workers++;}
  set onmessage(handler:any){super.onmessage=handler?event=>{probe.responses.push({at:performance.now(),metrics:event.data.metrics,hasAnalysis:!!event.data.analysis,patch:!!event.data.patch});handler.call(this,event);}:null;}
  get onmessage(){return super.onmessage;}
};
const options={limits:{maxSyntaxNodes:100000}};
const report=(diagnostics:any[])=>{if(diagnostics.some(d=>d.severity==='error'))probe.errors.push(diagnostics);};
const images:any[]=[];
function Fixture(){
  const [source,setSource]=useState('Ready'),[key,setKey]=useState('a'),[readOnly,setReadOnly]=useState(false),[disabled,setDisabled]=useState(false);
  const [mounted,setMounted]=useState(true),[locale,setLocale]=useState<'en'|'zh'>('en'),[view,setView]=useState<'edit'|'split'|'preview'>('split');
  const [theme,setTheme]=useState<'light'|'dark'|'auto'>('light');
  const [toolbar,setToolbar]=useState(true);
  const [session]=useState(()=>new PreviewStateSession());
  const [deferred,setDeferred]=useState(false),pending=useRef<string[]>([]);
  const handle=useRef<ReactiveMarkdownCodeEditorHandle|ReactiveMarkdownEditorHandle|null>(null);
  const compilation=useLocalCompilation(source,options,cm&&!privateAnalysis);
  const sourceRef=useRef(source);sourceRef.current=source;
  const update=(next:string)=>{probe.events.push({at:performance.now(),name:'change',source:next});if(deferred)pending.current.push(next);else setSource(next);};
  useEffect(()=>{
    probe.install=(value:string)=>setSource(value);probe.reset=(key:string)=>setKey(key);
    probe.lock=setReadOnly;probe.disable=setDisabled;probe.locale=setLocale;probe.view=setView;probe.theme=setTheme;probe.mount=setMounted;
    probe.toolbar=setToolbar;
    probe.defer=setDeferred;probe.ack=()=>{const value=pending.current.shift();if(value!==undefined)setSource(value);};
    probe.focus=(start:number,end=start)=>handle.current?.focus({start,end});
    probe.insert=(text:string)=>handle.current?.insertText(text);probe.undo=()=>handle.current?.undo();probe.redo=()=>handle.current?.redo();
    probe.source=()=>{const current=handle.current;return current&&'getSource'in current?current.getSource():sourceRef.current;};
    probe.selection=()=>handle.current?.getSelection();probe.handle=()=>handle.current;
    probe.ready=true;
  });
  useLayoutEffect(()=>{probe.hostSource=source;probe.commits.push({at:performance.now(),source});probe.previewSource=compilation.previewDocument?.source;},[source,compilation.previewDocument]);
  useEffect(()=>{
    const record=(event:KeyboardEvent)=>{if(event.target instanceof HTMLElement&&event.target.closest('.editor-shell')){
      const at=performance.now();requestAnimationFrame(()=>probe.events.push({name:'input-frame',key:event.key,duration:performance.now()-at}));}};
    document.addEventListener('keydown',record,true);return()=>document.removeEventListener('keydown',record,true);
  },[]);
  const Component=cm?ReactiveMarkdownCodeEditor:ReactiveMarkdownEditor;
  return mounted?<Component ref={(node:ReactiveMarkdownCodeEditorHandle|ReactiveMarkdownEditorHandle|null)=>{handle.current=node;}} id="source-editor" value={source} onChange={update} onTransaction={(transaction:EditorTransaction)=>probe.transactions.push(transaction)}
    documentKey={key} compileOptions={options} analysis={privateAnalysis?undefined:compilation.analysis}
    readOnly={readOnly} disabled={disabled} toolbar={toolbar} locale={locale} theme={theme} height={660} ariaLabel="Source"
    viewMode={view} onViewModeChange={setView} document={compilation.result?.ok?compilation.result.document:null}
    diagnostics={compilation.result?.diagnostics} preview={compilation.previewDocument?<LocalPreview document={compilation.previewDocument} session={session} images={images} onDiagnostics={report}/>:null}/>:<button id="unmounted">Unmounted</button>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('strict')?<StrictMode><Fixture/></StrictMode>:<Fixture/>);
