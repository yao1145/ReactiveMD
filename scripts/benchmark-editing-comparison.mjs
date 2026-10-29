import assert from 'node:assert/strict';
import {build} from 'vite';
import {createServer} from 'node:http';
import {resolve,sep,extname,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {cpus} from 'node:os';

const baseline=resolve(process.env.EDITING_BEFORE??'artifacts/parser-pipeline/before');
const current=resolve('dist-library');
const output=resolve(process.env.EDITING_COMPARISON_REPORT??'artifacts/editing-completion/comparison.json');
const dist=resolve('artifacts/editing-completion/comparison-dist');
const decode=fileURLToPath(import.meta.resolve('decode-named-character-reference'));
async function bundle(label,library){
  await build({configFile:false,base:'./',logLevel:'error',worker:{format:'es'},resolve:{alias:[
    {find:'react-dom/client',replacement:'react-dom/profiling'},
    {find:'decode-named-character-reference',replacement:decode},
    {find:/^reactive-md\/react$/,replacement:resolve(library,'reactive-md-react.js')},
    {find:/^reactive-md$/,replacement:resolve(library,'reactive-md.js')},
  ]},build:{outDir:resolve(dist,label),rollupOptions:{input:resolve('scripts/fixtures/editing-pipeline/browser.html')}}});
}
await bundle('before',baseline);
await bundle('after',current);
const server=createServer(async(req,res)=>{
  const path=resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(dist+sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const base=`http://127.0.0.1:${server.address().port}`;
const control='<slider bind="n" label="N" initial="2" min="0" max="100">';
const dynamicRows=process.env.EDITING_DYNAMIC_ROWS==='1';
const fixtures={
  context:()=>control+'\n\n'+Array.from({length:120},(_,i)=>`## Section ${i}\n\nParagraph ${i} with **formatting**, value {{ n * 2 }}.\n\n- First item\n- Second item`).join('\n\n')+'\n\n<panel title="Example">\n\nPanel content revision 0\n\n</panel>\n\n|A|B|\n|-|-|\n'+Array.from({length:100},(_,i)=>`|row ${i}|value ${i}|`).join('\n'),
  body:()=>control+'\n\n'+Array.from({length:120},(_,i)=>`## Section ${i}\n\nParagraph ${i} with **formatting**, value {{ n * 2 }}.`).join('\n\n')+'\n\n<panel title="Example">\n\nPanel content revision 0\n\n</panel>',
  paragraphs:()=>control+'\n\n'+Array.from({length:800},(_,i)=>`Paragraph ${i} revision 0 with **bold**, _emphasis_, and {{ n * 2 }}.`).join('\n\n'),
  list:()=>control+'\n\nBefore list\n\n'+Array.from({length:1000},(_,i)=>`- Item ${i} revision 0 with **bold** and ${dynamicRows?`value {{ n * ${i+1} }}`:'static text'}.`).join('\n')+'\n\nAfter list',
  table:()=>control+'\n\nBefore table\n\n|A|B|C|\n|-|-|-|\n'+Array.from({length:500},(_,i)=>`|row ${i}|cell ${i} revision 0|${dynamicRows?`{{ n * ${i+1} }}`:`value ${i}`}|`).join('\n')+'\n\nAfter table',
};
const edits={
  context:(source,i)=>source.replace(/label="N[^"]*"/,`label="N${i}"`),
  body:(source,i)=>source.replace(/Panel content revision \d+/,`Panel content revision ${i}`),
  paragraphs:(source,i)=>source.replace(/Paragraph 400 revision \d+/,`Paragraph 400 revision ${i}`),
  list:(source,i)=>source.replace(/Item 500 revision \d+/,`Item 500 revision ${i}`),
  table:(source,i)=>source.replace(/cell 250 revision \d+/,`cell 250 revision ${i}`),
};
const round=value=>Number(value.toFixed(3));
function summary(values){
  const sorted=[...values].sort((a,b)=>a-b),pick=f=>round(sorted[Math.ceil(sorted.length*f)-1]);
  return{count:values.length,median:pick(.5),p95:pick(.95),min:pick(.01),max:pick(1),samples:values.map(round)};
}
async function measure(browser,variant,kind){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  let source=fixtures[kind]();
  try{
    await page.goto(`${base}/${variant}/scripts/fixtures/editing-pipeline/browser.html`);
    await page.waitForFunction(()=>window.editingPipeline?.ready,undefined,{timeout:60000}).catch(error=>{throw new Error(`${variant}/${kind}: ${error.message}; errors=${JSON.stringify(errors)}`);});
    await page.evaluate(value=>window.editingPipeline.installSource(value),source);
    await page.waitForFunction(value=>window.editingPipeline.renderedSource===value,source,{timeout:120000});
    const editor=page.getByRole('textbox',{name:'Pipeline source'});
    for(let i=1;i<=3;i++){source=edits[kind](source,i);await editor.fill(source);await page.waitForFunction(value=>window.editingPipeline.renderedSource===value,source,{timeout:120000});}
    await page.evaluate(()=>{
      const p=window.editingPipeline;
      for(const key of ['requests','responses','commits','inputToFrame','inputToPreview','outcomes','longTasks'])p[key]=[];
    });
    for(let i=4;i<=18;i++){
      source=edits[kind](source,i);await editor.fill(source);
      await page.waitForFunction(value=>window.editingPipeline.renderedSource===value,source,{timeout:120000});
    }
    const probe=await page.evaluate(()=>{
      const p=window.editingPipeline;
      return{requests:p.requests.map(x=>({bytes:x.bytes,patch:'edit'in x.data})),responses:p.responses.map(x=>({bytes:x.bytes,patch:'patch'in x.data,duration:x.data.duration,metrics:x.data.metrics,stats:x.data.incremental})),inputToPreview:p.inputToPreview,inputToFrame:p.inputToFrame,commits:p.commits.map(x=>x.actualDuration),outcomes:p.outcomes.map(x=>x.metrics),runtimeCreations:p.runtimeCreations,modes:p.modes};
    });
    assert.deepEqual(errors,[]);assert.equal(probe.inputToPreview.length,15);assert.ok(probe.modes.every(x=>x.mode!=='fallback'));
    const patches=probe.responses.filter(x=>x.patch),full=probe.responses.filter(x=>!x.patch);
    return{variant,kind,characters:source.length,requests:summary(probe.requests.map(x=>x.bytes)),responses:summary(probe.responses.map(x=>x.bytes)),patchResponses:patches.length?summary(patches.map(x=>x.bytes)):null,fullResponses:full.length?summary(full.map(x=>x.bytes)):null,sourceEditRequests:probe.requests.filter(x=>x.patch).length,workerMs:summary(probe.responses.map(x=>x.duration)),inputToPreviewMs:summary(probe.inputToPreview),inputToFrameMs:summary(probe.inputToFrame),reactRenderMs:summary(probe.commits),queueMs:summary(probe.outcomes.map(x=>x?.queueMs??0)),roundTripMs:summary(probe.outcomes.map(x=>x?.roundTripMs??0)),applyMs:summary(probe.outcomes.map(x=>x?.applyMs??0)),lastStats:probe.responses.at(-1).stats,runtimeCreations:probe.runtimeCreations,errors};
  }finally{await page.close();}
}
let browser;
const results=[];
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??'msedge'});
  const kinds=(process.env.EDITING_CASES??Object.keys(fixtures).join(',')).split(',');
  assert.ok(kinds.every(kind=>Object.hasOwn(fixtures,kind)),'Unknown EDITING_CASES entry');
  for(let index=0;index<kinds.length;index++){
    const kind=kinds[index],variants=index%2?['after','before']:['before','after'];
    for(const variant of variants){
      console.log(`START ${kind} ${variant}`);
      const result=await measure(browser,variant,kind);results.push(result);
      await mkdir(dirname(output),{recursive:true});
      await writeFile(output,JSON.stringify({generatedAt:new Date().toISOString(),baseline:pathToFileURL(baseline).href,current:pathToFileURL(current).href,browser:browser.version(),dynamicRows,environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model},methodology:'Production packages built into the same Playwright fixture. Real Edge module Worker, 20ms scheduler delay, react-dom/profiling. Three warmups then fifteen measured textarea edits per scenario; version order alternates by scenario. Median/P95 are descriptive for fifteen samples. Input-to-preview ends at two requestAnimationFrame callbacks after commit, not completed paint. JSON UTF-8 lengths estimate messages, not structured-clone bytes. Before and after are measured sequentially on one machine and are not statistically controlled.',results},null,2)+'\n');
      console.log(JSON.stringify({kind,variant,worker:result.workerMs.median,preview:result.inputToPreviewMs.median,responseBytes:result.responses.median}));
    }
  }
}finally{await browser?.close();await new Promise(resolveClose=>server.close(resolveClose));}
console.log(`Report: ${output}`);
