import assert from 'node:assert/strict';
import {build} from 'vite';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve('artifacts/render-pipeline'),args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const variants=option('--variants','before,after').split(','),kinds=option('--cases','paragraphs800,paragraphs2400,table1000').split(',');
const samples=Number(option('--samples','9'));
const reportPath=resolve(option('--output',root+'/stages.json'));
await mkdir(root,{recursive:true});
function instrumentReact(){return{name:'measure-react-commit',enforce:'pre',transform(code,id){
  if(!id.replaceAll('\\','/').endsWith('/react-dom-profiling.profiling.js'))return;
  const ast=this.parse(code),insertions=[];
  const targets=new Set(['commitRoot','flushMutationEffects','flushLayoutEffects']);
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration'&&targets.has(node.id?.name)&&node.body){
      const name=node.id.name;insertions.push([node.body.start+1,`const __rmdPhaseStart=performance.now();try{`]);
      insertions.push([node.body.end-1,`}finally{globalThis.__rmdReactPhase?.('${name}',__rmdPhaseStart,performance.now()-__rmdPhaseStart);}`]);
    }
    for(const [key,value]of Object.entries(node))if(key!=='parent'){if(Array.isArray(value))for(const child of value)visit(child);else if(value&&typeof value==='object')visit(value);}
  }
  visit(ast);
  assert.equal(insertions.length,6,'React profiling hooks changed; update measurement before using it');
  for(const [at,text]of insertions.sort((a,b)=>b[0]-a[0]))code=code.slice(0,at)+text+code.slice(at);
  return{code,map:null};
}};}
async function bundle(variant){
  const library=resolve(variant==='before'?root+'/before-library':'dist-library');
  await build({configFile:false,base:'./',logLevel:'error',plugins:[{
    name:'baseline-demo-snapshot',enforce:'pre',async load(id){
      const file=id.replaceAll('\\','/');
      if(variant==='before'&&['App.tsx','preview-state.ts','use-local-compilation.ts'].some(name=>file===resolve('demo/src',name).replaceAll('\\','/')))return await readFile(resolve(root,'before-demo',basename(file)),'utf8');
      if(variant==='before'&&file===resolve('src/local/local.css').replaceAll('\\','/'))return await readFile(resolve(root,'before-local.css'),'utf8');
    },
  },instrumentReact()],resolve:{alias:[
    {find:'react-dom/client',replacement:'react-dom/profiling'},
    {find:'decode-named-character-reference',replacement:fileURLToPath(import.meta.resolve('decode-named-character-reference'))},
    {find:/^reactive-md\/react$/,replacement:resolve(library,'reactive-md-react.js')},
    {find:/^reactive-md\/editor$/,replacement:resolve(library,'reactive-md-editor.js')},
    {find:/^reactive-md$/,replacement:resolve(library,'reactive-md.js')},
  ]},build:{outDir:resolve(root,'dist',variant),rollupOptions:{input:resolve('scripts/fixtures/render-pipeline/browser.html')}}});
}
for(const variant of variants)await bundle(variant);
const dist=resolve(root,'dist');
const server=createServer(async(req,res)=>{
  const path=resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(dist+sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`;
const stat=values=>{const a=[...values].sort((a,b)=>a-b);return{median:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],samples:values};};
const fixture=(kind,n)=>{
  const count=Number(kind.match(/\d+/)[0]);
  const marker=` RMD-END-${n} ${'x'.repeat(n)}`;
  const body=kind.startsWith('paragraphs')?Array.from({length:count},(_,i)=>`Paragraph ${i} with **bold** and _emphasis_, value {{ n * 2 }}.${i===Math.floor(count/2)?marker:''}`).join('\n\n')
    :'|Name|Value|Description|\n|-|-|-|\n'+Array.from({length:count},(_,i)=>`|Row ${i}|{{ n * ${i+1} }}|Text ${i}${i===Math.floor(count/2)?marker:''}|`).join('\n');
  return `<slider bind="n" label="N" initial="2">\n\n${body}`;
};
async function traceSession(page,action){
  const cdp=await page.context().newCDPSession(page),events=[];
  cdp.on('Tracing.dataCollected',data=>events.push(...data.value));
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline',options:'record-as-much-as-possible'});
  await action();
  const finished=new Promise(done=>cdp.once('Tracing.tracingComplete',done));await cdp.send('Tracing.end');await finished;await cdp.detach();
  return events;
}
async function measure(browser,variant,kind){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  try{
    await page.goto(`${base}/${variant}/scripts/fixtures/render-pipeline/browser.html?editor=${option('--editor','minimal')}`);
    await page.waitForFunction(()=>window.renderProbe?.ready,undefined,{timeout:60000});
    let previousSource='';
    const install=async(n,native=true)=>{
      const text=fixture(kind,n);
      if(previousSource&&native){
        let from=0,oldTo=previousSource.length,newTo=text.length;
        while(from<oldTo&&from<newTo&&previousSource[from]===text[from])from++;
        while(oldTo>from&&newTo>from&&previousSource[oldTo-1]===text[newTo-1]){oldTo--;newTo--;}
        await page.getByRole('textbox',{name:'Source',exact:true}).evaluate((el,{from,to})=>{el.focus();el.setSelectionRange(from,to);},{from,to:oldTo});
        await page.keyboard.insertText(text.slice(from,newTo));
      }else await page.evaluate(source=>window.renderProbe.install(source),text);
      await page.waitForFunction(source=>window.renderProbe.renderedSource===source,text,{timeout:120000});
      previousSource=text;
    };
    const trace=await traceSession(page,async()=>{for(let n=0;n<samples+3;n++)await install(n);});
    const probe=await page.evaluate(()=>window.renderProbe);
    assert.deepEqual(errors,[]);assert.deepEqual(probe.errors,[]);
    const inputs=probe.events.filter(e=>e.name==='input'),runs=[];
    for(let i=0;i<inputs.length;i++){
      const start=inputs[i].at,end=inputs[i+1]?.at??Infinity;
      const events=probe.events.filter(e=>e.at>=start&&e.at<end),at=name=>events.find(e=>e.name===name)?.at;
      const phases=probe.reactPhases.filter(e=>e.start>=start&&e.start<end);
      const sum=name=>{
        const intervals=phases.filter(e=>e.name===name).map(e=>[e.start,e.start+e.duration]).sort((a,b)=>a[0]-b[0]);
        let total=0,lastEnd=-Infinity;
        for(const [from,to]of intervals){total+=Math.max(0,to-Math.max(from,lastEnd));lastEnd=Math.max(lastEnd,to);}
        return total;
      };
      const responses=probe.responses.filter(e=>e.at>=start&&e.at<end);
      const traceStart=trace.filter(e=>e.name==='rmd:input')[i];
      const traceEnd=trace.filter(e=>e.name==='rmd:input')[i+1];
      const main=traceStart?trace.filter(e=>e.ph==='X'&&e.pid===traceStart.pid&&e.tid===traceStart.tid&&e.ts>=traceStart.ts&&(!traceEnd||e.ts<traceEnd.ts)):[];
      const received=trace.find(e=>e.name==='rmd:received'&&e.ts>=traceStart.ts&&(!traceEnd||e.ts<traceEnd.ts));
      const traceMs=(name,afterResponse=false)=>main.filter(e=>e.name===name&&(!afterResponse||e.ts>=received.ts)).reduce((n,e)=>n+(e.dur??0)/1000,0);
      runs.push({queueMs:at('posted')-start,dispatchWaitMs:at('posted')-at('scheduled'),inputRenderAndEffectsMs:at('scheduled')-start,workerRoundTripMs:at('received')-at('posted'),workerMs:responses.at(-1)?.duration,receiveMs:at('received-end')-at('received'),resultToDomMs:at('dom-ready')-at('received-end'),previewMs:at('frame-ready')-start,editorRenderMs:probe.editorRenders.filter(e=>e.start>=start&&e.start<end).reduce((n,e)=>n+e.actualDuration,0),reactRenderMs:probe.reactRenders.filter(e=>e.start>=start&&e.start<end).reduce((n,e)=>n+e.actualDuration,0),commitRootMs:sum('commitRoot'),mutationMs:sum('flushMutationEffects'),layoutEffectsMs:sum('flushLayoutEffects'),styleMs:traceMs('UpdateLayoutTree'),layoutMs:traceMs('Layout'),prePaintMs:traceMs('PrePaint'),paintMs:traceMs('Paint'),previewStyleMs:traceMs('UpdateLayoutTree',true),previewLayoutMs:traceMs('Layout',true),previewPaintMs:traceMs('Paint',true),added:probe.mutations.filter(e=>e.at>=start&&e.at<end).reduce((n,e)=>n+e.added,0),removed:probe.mutations.filter(e=>e.at>=start&&e.at<end).reduce((n,e)=>n+e.removed,0)});
    }
    assert.equal(runs.length,samples+3);
    assert.ok(trace.some(e=>e.name==='Layout'),'Trace must contain actual browser layout events');
    const measured=runs.slice(3),summary=Object.fromEntries(Object.keys(measured[0]).map(key=>[key,stat(measured.map(r=>r[key]))]));
    await writeFile(resolve(root,`${variant}-${kind}-events.json`),JSON.stringify(probe));
    await writeFile(resolve(root,`${variant}-${kind}-trace.json`),JSON.stringify({traceEvents:trace}));
    await page.screenshot({path:resolve(root,`${variant}-${kind}.png`)});
    if(variant==='after')assert.equal(probe.articleReplacements,0,'Editing must preserve the preview article');
    const checks=[];
    if(variant==='after'){
      await page.evaluate(()=>{window.__savedArticle=document.querySelector('#preview article');window.__savedControl=document.querySelector('#preview input[type=range]');});
      const slider=page.getByRole('slider',{name:'N',exact:true});
      await slider.fill('13');await slider.focus();
      await install(100,false);
      assert.equal(await slider.inputValue(),'13');
      assert.ok(await page.evaluate(()=>document.querySelector('#preview article')===window.__savedArticle&&document.activeElement===window.__savedControl));
      checks.push('article/control identity, focus and parameter retained');
      const reset=fixture(kind,101).replace('initial="2"','initial="3"');
      await page.evaluate(source=>window.renderProbe.install(source),reset);await page.waitForFunction(source=>window.renderProbe.renderedSource===source,reset);
      assert.equal(await slider.inputValue(),'3');checks.push('author initial reset');
      if(kind.startsWith('paragraphs')){
        const count=Number(kind.match(/\d+/)[0]);
        assert.equal(await page.locator('#preview article > p').count(),count);
        assert.equal(await page.locator('#preview article > p').nth(100).evaluate(el=>getComputedStyle(el).contentVisibility),'auto');
        const found=await page.evaluate(text=>{
          const first=document.querySelector('#preview article > p'),range=document.createRange();range.selectNodeContents(first);range.collapse(true);
          const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
          return window.find(text,true,false,false)&&!!selection.anchorNode?.parentElement?.closest('#preview');
        },`Paragraph ${count-1} with`);
        assert.ok(found,'Native find must reach off-screen prose');
        await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('#preview article > p').nth(100).evaluate(el=>getComputedStyle(el).contentVisibility),'visible');
        await page.emulateMedia({media:'screen'});checks.push('all prose in DOM; native find; printing eager');
      }
      const rapid=fixture(kind,140);
      await page.evaluate(async({kind,rapid})=>{for(let n=120;n<=140;n++){window.renderProbe.install(rapid.replace('RMD-END-140',`RMD-END-${n}`));await new Promise(done=>setTimeout(done,5));}},{kind,rapid});
      await page.waitForFunction(source=>window.renderProbe.renderedSource===source,rapid);
      assert.equal(await slider.inputValue(),'2');checks.push('rapid edits settle to latest source');
      await slider.fill('13');await page.evaluate(()=>window.renderProbe.newSession());
      await page.waitForFunction(()=>document.querySelector('#preview input[type=range]')?.value==='2');checks.push('fresh session resets values');
    }
    assert.deepEqual(errors,[]);
    const result={variant,kind,summary,mount:runs[0],articleReplacements:probe.articleReplacements,checks,errors};
    console.log(JSON.stringify({variant,kind,...Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,v.median]))}));return result;
  }finally{await page.close();}
}
let browser;const results=[];
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??'msedge'});
  for(const kind of kinds)for(const variant of variants){results.push(await measure(browser,variant,kind));await writeFile(reportPath,JSON.stringify({generatedAt:new Date().toISOString(),browser:browser.version(),samples,editor:option('--editor','minimal'),edit:'Growing midpoint insertion in paragraph/table cell; later source offsets shift',methodology:'Actual Demo LocalPreview, PreviewStateSession and useLocalCompilation with production packages and react-dom/profiling. React commitRoot/flushMutationEffects/flushLayoutEffects wrapped only in the benchmark build with finally-based wall-clock timing. Each function uses the union of its intervals to avoid counting recursive calls twice; different functions still overlap and must not be summed. Editor render includes preview render. QueueMs is input-to-dispatch, while dispatchWaitMs begins at the scheduling effect. CDP renderer-main-thread Layout, UpdateLayoutTree, PrePaint and Paint event durations per input interval; compositor/GPU completion excluded. First mount recorded separately; two edit warmups and then measured edits. Frame-ready is two requestAnimationFrame callbacks after actual preview DOM mutations, not completed paint. Trace and instrumentation overhead applies to both variants.',results},null,2)+'\n');}
}finally{await browser?.close();await new Promise(done=>server.close(done));}
