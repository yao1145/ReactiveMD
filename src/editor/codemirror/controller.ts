import {Annotation,Compartment,EditorSelection,EditorState,StateEffect,StateField,type Extension,type TransactionSpec} from '@codemirror/state';
import {Decoration,EditorView,ViewPlugin,keymap,lineNumbers,drawSelection,highlightActiveLine,highlightActiveLineGutter,placeholder,type DecorationSet,type ViewUpdate} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,invertedEffects,isolateHistory,undo,redo,undoDepth,redoDepth,indentWithTab} from '@codemirror/commands';
import {syntaxHighlighting} from '@codemirror/language';
import {sourceHighlightStyle} from './highlighting';
import {markdown} from '@codemirror/lang-markdown';
import {searchKeymap} from '@codemirror/search';
import {lintGutter,setDiagnostics,setDiagnosticsEffect} from '@codemirror/lint';
import type {AuthorAnalysis,Diagnostic} from '../../local';
import type {EditorSurface} from '../surface';
import type {EditorEdit,EditorSelection as SourceSelection} from '../types';
import {SourceCoordinates,type SourceChange} from './source-coordinates';
import type {EditorTransaction} from './types';

const rawSource=StateEffect.define<string>();
const analysisChanged=StateEffect.define<null>();
const programmatic=Annotation.define<boolean>();
export interface ControllerOptions {
  value:string;readOnly:boolean;disabled:boolean;label:string;locale:string;placeholder?:string;id?:string;
  onChange(value:string,transaction:EditorTransaction):void;
  onUpdate():void;
}
function difference(before:string,after:string):SourceChange[]{
  let from=0,to=before.length,end=after.length;
  while(from<to&&from<end&&before[from]===after[from])from++;
  while(to>from&&end>from&&before[to-1]===after[end-1]){to--;end--;}
  return from===to&&from===end?[]:[{from,to,insert:after.slice(from,end)}];
}

/** Owns one EditorView. React configures it; CodeMirror owns its content DOM. */
export class CodeEditorController {
  readonly view:EditorView;
  readonly surface:EditorSurface;
  private options:ControllerOptions;
  private seed:SourceCoordinates;
  private revision=0;
  private disposed=false;
  private suppressed=false;
  private escapeTab=false;
  private listeners=new Set<()=>void>();
  private readonly configuration=new Compartment();
  private analysis:{source:string;value:AuthorAnalysis}|null=null;
  private readonly coordinates:StateField<SourceCoordinates>;
  constructor(parent:HTMLElement,options:ControllerOptions){
    this.options=options;this.seed=new SourceCoordinates(options.value);
    this.coordinates=StateField.define<SourceCoordinates>({
      create:()=>this.seed,
      update:(previous,tr)=>{
        const replacements=tr.effects.filter(effect=>effect.is(rawSource));
        if(replacements.length){
          const text=tr.newDoc.toString();
          for(let i=replacements.length-1;i>=0;i--){
            const candidate=new SourceCoordinates(replacements[i].value as string,previous.preferredLineBreak);
            if(candidate.text===text)return candidate;
          }
        }
        if(!tr.docChanged)return previous;
        const changes:SourceChange[]=[];
        tr.changes.iterChanges((from,to,_fromB,_toB,insert)=>changes.push({from,to,insert:insert.toString()}));
        return new SourceCoordinates(previous.apply(changes).source,previous.preferredLineBreak);
      },
    });
    const controller=this;
    const visibleAnalysis=ViewPlugin.fromClass(class{
      decorations:DecorationSet;
      constructor(view:EditorView){this.decorations=controller.decorations(view);}
      update(update:ViewUpdate){if(update.docChanged||update.viewportChanged||update.transactions.some(tr=>tr.effects.some(e=>e.is(analysisChanged))))this.decorations=controller.decorations(update.view);}
    },{decorations:value=>value.decorations});
    this.extensions=[
      this.coordinates,
      lineNumbers(),drawSelection(),highlightActiveLine(),highlightActiveLineGutter(),
      history({minDepth:120,newGroupDelay:700}),
      invertedEffects.of(tr=>{
        if(!tr.docChanged&&!tr.effects.some(e=>e.is(rawSource)))return [];
        const previous=tr.startState.field(this.coordinates),next=tr.state.field(this.coordinates);
        const inverse:SourceChange[]=[];
        tr.changes.invert(tr.startState.doc).iterChanges((from,to,_a,_b,insert)=>inverse.push({from,to,insert:insert.toString()}));
        // Native CM history already stores text changes. Retain a raw snapshot
        // only when undo would otherwise lose a noncanonical line ending.
        return next.apply(inverse).source===previous.source?[]:[rawSource.of(previous.source)];
      }),
      EditorState.transactionExtender.of(tr=>tr.docChanged?{effects:setDiagnosticsEffect.of([])}:null),
      keymap.of([{key:'Mod-Shift-z',run:redo,preventDefault:true},
        {key:'Escape',run:view=>{
          if(view.dom.querySelector('.cm-search')||!view.dom.closest('.reactive-md-editor')?.querySelector('.editor-toolbar [tabindex="0"]:not(:disabled)'))return false;
          this.escapeTab=true;return true;
        }},
        {key:'Tab',run:view=>{
          if(!this.escapeTab)return false;this.escapeTab=false;view.setTabFocusMode(false);
          const target=view.dom.closest('.reactive-md-editor')?.querySelector<HTMLButtonElement>('.editor-toolbar [tabindex="0"]:not(:disabled)');
          if(!target)return false;target.focus({preventScroll:true});return true;
        }},indentWithTab,...defaultKeymap,...historyKeymap,...searchKeymap]),
      markdown(),syntaxHighlighting(sourceHighlightStyle),EditorView.lineWrapping,lintGutter(),visibleAnalysis,
      EditorView.updateListener.of(update=>this.updated(update)),
      EditorView.domEventHandlers({keydown:event=>{if(event.key!=='Escape'&&event.key!=='Tab')this.escapeTab=false;return false;},focus:()=>{this.emit();return false;},blur:()=>{this.escapeTab=false;this.emit();return false;},compositionstart:()=>{this.escapeTab=false;return false;},compositionend:()=>{queueMicrotask(()=>{if(!this.disposed)this.emit();});return false;}}),
      EditorView.theme({
        '&':{height:'100%',backgroundColor:'var(--code-bg)',color:'var(--code-ink)'},
        '.cm-scroller':{fontFamily:'var(--font-mono, ui-monospace, monospace)',lineHeight:'var(--leading-normal, 1.6)',overflow:'auto'},
        '.cm-content':{padding:'12px 0',minHeight:'100%'},
        '.cm-line':{padding:'0 14px'},'.cm-gutters':{backgroundColor:'var(--code-bg-deep)',color:'var(--code-muted)',border:'none'},
        '.cm-activeLine':{backgroundColor:'var(--surface-hover)'},'.cm-activeLineGutter':{backgroundColor:'var(--surface-active)'},
        '.cm-cursor':{borderLeftColor:'var(--ink)'},'&.cm-focused':{outline:'none'},
        '.cm-panels, .cm-tooltip':{backgroundColor:'var(--surface)',color:'var(--ink)',borderColor:'var(--line)'},
        '.cm-textfield, .cm-button':{background:'var(--surface)',color:'var(--ink)',borderColor:'var(--line)'},
      }),
    ];
    this.view=new EditorView({parent,state:this.createState()});
    this.view.dispatch(setDiagnostics(this.view.state,[]));
    this.surface={
      read:()=>({value:this.model.source,selection:this.selection()}),element:()=>this.disposed?null:this.view.contentDOM,
      subscribe:listener=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};},
      listenKeyDown:listener=>{this.view.contentDOM.addEventListener('keydown',listener,true);return()=>this.view.contentDOM.removeEventListener('keydown',listener,true);},
    };
  }
  private extensions:Extension[];
  private createState(){return EditorState.create({doc:this.seed.text,extensions:[this.configuration.of(this.config()),this.extensions]});}
  private config():Extension[]{return[
    EditorState.readOnly.of(this.options.readOnly||this.options.disabled),
    EditorView.editable.of(!this.options.readOnly&&!this.options.disabled),
    placeholder(this.options.placeholder??''),
    EditorView.contentAttributes.of({id:this.options.id??'','aria-label':this.options.label,'aria-multiline':'true','aria-readonly':String(this.options.readOnly),'aria-disabled':String(this.options.disabled),role:'textbox',tabindex:this.options.disabled?'-1':'0',lang:this.options.locale==='zh'?'zh-CN':'en',spellcheck:'false'}),
  ];}
  get model(){return this.view.state.field(this.coordinates);}
  get source(){return this.model.source;}
  get canUndo(){return undoDepth(this.view.state)>0;}
  get canRedo(){return redoDepth(this.view.state)>0;}
  get composing(){return this.view.compositionStarted;}
  private emit(){for(const listener of this.listeners)listener();this.options.onUpdate();}
  private updated(update:ViewUpdate){
    if(this.disposed||this.suppressed)return;
    const previous=update.startState.field(this.coordinates),next=update.state.field(this.coordinates);
    if(previous.source!==next.source){
      const baseRevision=this.revision++;
      const changes=update.transactions.some(tr=>tr.effects.some(e=>e.is(rawSource)))?difference(previous.source,next.source):(()=>{
        const normalized:SourceChange[]=[];update.changes.iterChanges((from,to,_a,_b,insert)=>normalized.push({from,to,insert:insert.toString()}));return previous.apply(normalized).changes;
      })();
      this.options.onChange(next.source,{previousSource:previous.source,baseRevision,revision:this.revision,source:next.source,changes,selection:this.selection(update.state),composing:update.view.compositionStarted});
    }
    if(update.docChanged||update.selectionSet||update.focusChanged)this.emit();
  }
  selection(state=this.view.state):SourceSelection{
    const model=state.field(this.coordinates),range=state.selection.main;
    return{start:model.toSource(range.from),end:model.toSource(range.to)};
  }
  setOptions(options:ControllerOptions){
    const changed=this.options.readOnly!==options.readOnly||this.options.disabled!==options.disabled||this.options.label!==options.label||this.options.locale!==options.locale||this.options.placeholder!==options.placeholder||this.options.id!==options.id;
    this.options=options;if(changed&&!this.disposed)this.view.dispatch({effects:this.configuration.reconfigure(this.config())});
  }
  setExternal(value:string,reset=false){
    if(this.disposed||!reset&&value===this.source)return;
    this.seed=new SourceCoordinates(value);this.analysis=null;this.suppressed=true;
    try{this.view.setState(this.createState());this.view.dispatch(setDiagnostics(this.view.state,[]));this.view.scrollDOM.scrollTop=0;}finally{this.suppressed=false;}
    this.emit();
  }
  edit(edit:EditorEdit){
    if(this.options.disabled||this.options.readOnly||this.disposed)return;
    const next=new SourceCoordinates(edit.value),changes=difference(this.model.text,next.text);
    this.view.dispatch({changes:changes.length?changes:undefined,effects:rawSource.of(edit.value),selection:EditorSelection.single(next.toView(edit.selection.start),next.toView(edit.selection.end)),annotations:[programmatic.of(true),isolateHistory.of('full')]});
    this.view.focus();
  }
  focus(selection?:SourceSelection){
    if(this.disposed||this.options.disabled)return;
    if(selection)this.view.dispatch({selection:EditorSelection.single(this.model.toView(selection.start),this.model.toView(selection.end)),effects:EditorView.scrollIntoView(this.model.toView(selection.start),{y:'center'})});
    this.view.focus();
  }
  undo(){if(!this.options.disabled&&!this.options.readOnly)undo(this.view);}
  redo(){if(!this.options.disabled&&!this.options.readOnly)redo(this.view);}
  setAnalysis(value:AuthorAnalysis|null,source:string,diagnostics:readonly Diagnostic[]=[]){
    if(this.disposed)return;
    this.analysis=value&&source===this.source?{source,value}:null;
    const model=this.model;
    const lint=source===model.source?diagnostics.map(d=>({from:model.toView(d.range.start),to:model.toView(d.range.end),severity:d.severity,message:d.message})):[];
    this.view.dispatch({effects:analysisChanged.of(null)});
    this.view.dispatch(setDiagnostics(this.view.state,lint));
  }
  private decorations(view:EditorView):DecorationSet{
    const model=view.state.field(this.coordinates),analysis=this.analysis;
    if(!analysis||analysis.source!==model.source)return Decoration.none;
    const tokens=analysis.value.tokens,ranges=[];
    for(const visible of view.visibleRanges){
      const from=model.toSource(visible.from),to=model.toSource(visible.to);let low=0,high=tokens.length;
      while(low<high){const mid=(low+high)>>>1;if(tokens[mid].range.end<=from)low=mid+1;else high=mid;}
      for(let i=low;i<tokens.length&&tokens[i].range.start<to;i++){
        const token=tokens[i],start=model.toView(Math.max(from,token.range.start)),end=model.toView(Math.min(to,token.range.end));
        if(end>start)ranges.push(Decoration.mark({class:'author-token author-token-'+token.kind.replace(/[^a-z0-9_-]/gi,'').slice(0,40)}).range(start,end));
      }
    }
    return Decoration.set(ranges,true);
  }
  destroy(){if(this.disposed)return;this.disposed=true;this.listeners.clear();this.view.destroy();}
}
