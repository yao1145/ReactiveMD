import {forwardRef,useEffect,useId,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {LocalCompileScheduler,localCompileOptionsKey} from 'reactive-md';
import type {AuthorAnalysis} from '../../local';
import type {EditorSurface} from '../surface';
import type {EditorEdit,EditorSelection,EditorViewMode} from '../types';
import {EDITOR_CHROME_COPY} from '../editor-i18n';
import {EditorLocaleProvider} from '../locale';
import {EditorToolbar} from '../editor-toolbar';
import {EditorViewBar} from '../editor-view-bar';
import {AuthoringPanel} from '../source-authoring';
import {CodeEditorController,type ControllerOptions} from './controller';
import type {EditorAuthorAnalysis,ReactiveMarkdownCodeEditorHandle,ReactiveMarkdownCodeEditorProps} from './types';
import type {SourceChange} from './source-coordinates';

const EMPTY:AuthorAnalysis={tokens:[],bindings:[],diagnostics:[]};
const cssSize=(size:number|string)=>typeof size==='number'?`${size}px`:size;

/** Viewport-rendered source editor. One mounted EditorView owns its DOM and history. */
export const ReactiveMarkdownCodeEditor=forwardRef<ReactiveMarkdownCodeEditorHandle,ReactiveMarkdownCodeEditorProps>(function ReactiveMarkdownCodeEditor(props,ref){
  const {value,locale='en',theme='auto',preview,viewMode,defaultViewMode='edit',height=560,minHeight=280,
    readOnly=false,disabled=false,toolbar=true,authoring=true}=props;
  const generatedId=useId(),id=props.id??`reactive-md-code-editor-${generatedId.replace(/:/g,'')}`;
  const copy=EDITOR_CHROME_COPY[locale];
  const frame=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null),controller=useRef<CodeEditorController|null>(null);
  const latest=useRef(props);latest.current=props;
  const [source,setSource]=useState(value),sourceRef=useRef(source);sourceRef.current=source;
  const [status,setStatus]=useState({undo:false,redo:false,composing:false});
  const statusRef=useRef(status);
  const [narrow,setNarrow]=useState(false),[internalView,setInternalView]=useState<EditorViewMode>(defaultViewMode);
  const [workerAnalysis,setWorkerAnalysis]=useState<EditorAuthorAnalysis|null>(null);
  const scheduler=useRef<LocalCompileScheduler|null>(null);
  const optionsKey=localCompileOptionsKey(props.compileOptions),keyRef=useRef(optionsKey);keyRef.current=optionsKey;
  const previous=useRef({value,documentKey:props.documentKey});
  // Pending acknowledgements retain inverse edits, not a full document per key.
  const acknowledgements=useRef<SourceChange[][]>([]);
  const surfaceListeners=useRef(new Set<()=>void>());
  const surface=useMemo<EditorSurface>(()=>({
    read:()=>controller.current?.surface.read()??{value:sourceRef.current,selection:{start:0,end:0}},
    element:()=>controller.current?.surface.element()??null,
    subscribe(listener){surfaceListeners.current.add(listener);return()=>{surfaceListeners.current.delete(listener);};},
    listenKeyDown(listener){return controller.current?.surface.listenKeyDown(listener)??(()=>{});},
  }),[]);
  const config=():ControllerOptions=>({value:latest.current.value,readOnly:latest.current.readOnly??false,disabled:latest.current.disabled??false,
    label:latest.current.ariaLabel??EDITOR_CHROME_COPY[latest.current.locale??'en'].sourceLabel,locale:latest.current.locale??'en',
    placeholder:latest.current.placeholder,id,
    onChange(next,transaction){
      sourceRef.current=next;setSource(next);
      let delta=0;
      acknowledgements.current.push(transaction.changes.map(change=>{
        const from=change.from+delta;delta+=change.insert.length-(change.to-change.from);
        return {from,to:from+change.insert.length,insert:transaction.previousSource.slice(change.from,change.to)};
      }));
      if(acknowledgements.current.length>120)acknowledgements.current.shift();
      latest.current.onTransaction?.(transaction);latest.current.onChange(next);
    },
    onUpdate(){
      const view=controller.current;
      if(view){const previous=statusRef.current,next={undo:view.canUndo,redo:view.canRedo,composing:view.composing};
        if(previous.undo!==next.undo||previous.redo!==next.redo||previous.composing!==next.composing){statusRef.current=next;setStatus(next);}}
      for(const listener of surfaceListeners.current)listener();
    },
  });
  useLayoutEffect(()=>{
    if(!host.current)return;
    const view=new CodeEditorController(host.current,config());controller.current=view;
    return()=>{controller.current=null;view.destroy();};
  },[]);
  useLayoutEffect(()=>{controller.current?.setOptions(config());});
  useLayoutEffect(()=>{
    const before=previous.current;previous.current={value,documentKey:props.documentKey};
    const reset=before.documentKey!==props.documentKey;
    if(!reset&&before.value===value)return;
    if(!reset){
      let candidate=controller.current?.source??sourceRef.current;
      if(candidate===value){acknowledgements.current=[];return;}
      for(let index=acknowledgements.current.length-1;index>=0;index--){
        const pieces:string[]=[];let cursor=0;
        for(const edit of acknowledgements.current[index]){pieces.push(candidate.slice(cursor,edit.from),edit.insert);cursor=edit.to;}
        pieces.push(candidate.slice(cursor));candidate=pieces.join('');
        if(candidate===value){acknowledgements.current.splice(0,index);return;}
      }
    }
    acknowledgements.current=[];
    controller.current?.setExternal(value,reset);sourceRef.current=value;setSource(value);
  },[value,props.documentKey]);
  useLayoutEffect(()=>{
    const element=frame.current;if(!element)return;
    const measure=()=>setNarrow(element.clientWidth<=600);measure();
    if(typeof ResizeObserver==='undefined'){window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);}
    const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[]);
  const privateAnalysis=authoring&&props.analysis===undefined;
  useEffect(()=>{
    if(!privateAnalysis)return;
    const worker=new LocalCompileScheduler({
      createWorker:()=>latest.current.createAnalysisWorker?.()??new Worker(new URL('./analysis-worker.ts',import.meta.url),{type:'module'}),
      includeAuthorAnalysis:true,shareResults:true,delay:20,
      onResult(outcome){
        const key=localCompileOptionsKey(outcome.options);
        if(outcome.source===sourceRef.current&&key===keyRef.current)setWorkerAnalysis({source:outcome.source,optionsKey:key,analysis:outcome.analysis??EMPTY});
      },
    });
    scheduler.current=worker;worker.schedule(sourceRef.current,latest.current.compileOptions);
    return()=>{scheduler.current=null;worker.dispose();};
  },[privateAnalysis,optionsKey,props.createAnalysisWorker,props.documentKey]);
  useEffect(()=>{scheduler.current?.schedule(source,latest.current.compileOptions);},[source]);
  const envelope=props.analysis===undefined?workerAnalysis:props.analysis;
  const analysis=authoring&&envelope?.source===source&&envelope.optionsKey===optionsKey?envelope.analysis:EMPTY;
  useEffect(()=>{controller.current?.setAnalysis(analysis,source,props.diagnostics);},[analysis,source,props.diagnostics,props.documentKey]);
  const applyEdit=(edit:EditorEdit)=>controller.current?.edit(edit);
  const locate=(selection:EditorSelection)=>controller.current?.focus(selection);
  useImperativeHandle(ref,()=>({
    focus:selection=>controller.current?.focus(selection),selectRange:locate,
    getSelection:()=>controller.current?.selection()??{start:0,end:0},getSource:()=>controller.current?.source??sourceRef.current,
    getEditorElement:()=>controller.current?.view.contentDOM??null,
    getVisibleRanges:()=>{const view=controller.current;return view?view.view.visibleRanges.map(range=>({start:view.model.toSource(range.from),end:view.model.toSource(range.to)})):[];},
    insertText(text){const view=controller.current;if(!view)return;const selection=view.selection(),next=view.source.slice(0,selection.start)+text+view.source.slice(selection.end),at=selection.start+text.length;view.edit({value:next,selection:{start:at,end:at}});},
    undo:()=>controller.current?.undo(),redo:()=>controller.current?.redo(),
  }),[]);
  const hasPreview=preview!==undefined&&preview!==null,requested=hasPreview?viewMode??internalView:'edit';
  const currentView=narrow&&requested==='split'?'edit':requested;
  useLayoutEffect(()=>{if(currentView!=='preview')controller.current?.view.requestMeasure();},[currentView]);
  const changeView=(mode:EditorViewMode)=>{if(viewMode===undefined)setInternalView(mode);props.onViewModeChange?.(mode);};
  const locked=readOnly||disabled;
  return <EditorLocaleProvider locale={locale}><div className={`reactive-md-editor rmd-cm6${props.className?` ${props.className}`:''}`}
    data-editor-theme={theme} lang={locale==='zh'?'zh-CN':'en'} style={props.style} role="group" aria-label={copy.region} aria-disabled={locked||undefined} inert={disabled||undefined}>
    <div className="editor-frame" ref={frame} data-editor-view={currentView} style={{height:cssSize(height),minHeight:cssSize(minHeight)}}>
      {toolbar?<EditorToolbar editorSurface={surface} onEdit={applyEdit} onUndo={()=>controller.current?.undo()} onRedo={()=>controller.current?.redo()}
        canUndo={status.undo} canRedo={status.redo} onExport={props.onExport} showExport={typeof props.onExport==='function'} disabled={locked}/>:null}
      <div className="editor-workspace" data-view={currentView}>
        <div id={`${id}-source`} hidden={currentView==='preview'} className={`editor-shell${status.composing?' is-composing':''}`}>
          <div className="rmd-cm6-host" ref={host}/>
        </div>
        {hasPreview?<div id={`${id}-preview`} className="editor-preview" role="region" aria-label={copy.previewRegion} hidden={currentView==='edit'}>{preview}</div>:null}
      </div>
      <EditorViewBar source={source} mode={currentView} onModeChange={changeView} sourceId={`${id}-source`} previewId={`${id}-preview`} hasPreview={hasPreview} allowSplit={!narrow} toolbar={toolbar&&!locked}/>
    </div>
    {authoring?<div hidden={currentView==='preview'}><AuthoringPanel source={source} analysis={analysis} bindingDocument={props.document??null}
      compileOptions={props.compileOptions} editorSurface={surface} pageSize={50} onEdit={applyEdit} onLocate={locate} disabled={locked}/></div>:null}
  </div></EditorLocaleProvider>;
});
