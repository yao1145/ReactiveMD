import {build} from 'vite';
import {fileURLToPath} from 'node:url';

let bundle;
/** Browser-test adapter using CM6's documented DOM lookup, never private React state. */
export async function installEditorProbe(page) {
  if(await page.evaluate(()=>Boolean(window.rmdEditorProbe)))return;
  bundle??=build({configFile:false,root:fileURLToPath(new URL('../../',import.meta.url)),logLevel:'silent',
    plugins:[{name:'editor-probe',resolveId:id=>id.endsWith('editor-probe-entry.mjs')?id:null,load:id=>id.endsWith('editor-probe-entry.mjs')?`
      import {EditorView} from '@codemirror/view';
      const view = element => EditorView.findFromDOM(element.closest('.cm-editor') || element);
      export {view};
      export function read(element) { const editor=view(element); return editor ? editor.state.doc.toString() : element.value; }
      export function selection(element) { const editor=view(element);return editor ? {start:editor.state.selection.main.from,end:editor.state.selection.main.to} : {start:element.selectionStart,end:element.selectionEnd}; }
      export function select(element,start,end=start,reveal=false) {const editor=view(element);if(editor){editor.dispatch({selection:{anchor:start,head:end},...(reveal?{effects:EditorView.scrollIntoView(start,{y:'center'})}:{})});editor.focus();}else{element.focus();element.setSelectionRange(start,end);}}
      export function scrollElement(element) {return view(element)?.scrollDOM || element;}
      export function lineCount(element) {return view(element)?.state.doc.lines || read(element).split('\\n').length;}
      export function snapshot(element) {const editor=view(element),range=selection(element);return {value:read(element),start:range.start,end:range.end,scrollTop:scrollElement(element).scrollTop,viewport:editor?.viewport};}
    `:null}],build:{write:false,minify:true,lib:{entry:fileURLToPath(new URL('editor-probe-entry.mjs',import.meta.url)),formats:['iife'],name:'rmdEditorProbe'}}});
  const result=await bundle;
  const content=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
  // CM6's feature probes need documentElement. Reinstall after each navigation
  // through openWorkbench/readEditor instead of executing during document creation.
  await page.addScriptTag({content});
}

export async function readEditorSource(page,selector='#source-editor') {
  await installEditorProbe(page);
  return page.locator(selector).evaluate(element=>window.rmdEditorProbe.read(element));
}
export async function selectEditorRange(page,start,end=start,selector='#source-editor') {
  await installEditorProbe(page);
  await page.locator(selector).evaluate((element,range)=>window.rmdEditorProbe.select(element,range.start,range.end),{start,end});
}
