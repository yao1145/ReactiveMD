import assert from 'node:assert/strict';
import {build} from 'vite';
import {createServer} from 'node:http';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';

const root=resolve('artifacts/editing-completion/browser-dist');
await build({configFile:false,logLevel:'error',resolve:{alias:{'react-dom/client':'react-dom/profiling','decode-named-character-reference':fileURLToPath(import.meta.resolve('decode-named-character-reference'))}},build:{outDir:root,rollupOptions:{input:resolve('scripts/fixtures/editing-pipeline/browser.html')}}});
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
const port=server.address().port,base=`http://127.0.0.1:${port}`;
const source=(revision=0)=>'<slider bind="n" label="N" initial="2" min="0" max="100">\n\n'
  +Array.from({length:200},(_,i)=>`## Section ${i}\n\nParagraph ${i} with **formatting**, value {{ n * 2 }}.\n\n- First item\n- Second item`).join('\n\n')
  +'\n\n<panel title="Example">\n\nPanel content BASE\n\n</panel>\n\n|A|B|\n|-|-|\n'
  +Array.from({length:200},(_,i)=>`|row ${i}|value ${i}|`).join('\n')+`\n\nEdit marker BASE${revision}`;
const median=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length/2)-1];
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`${base}/scripts/fixtures/editing-pipeline/browser.html`);
  await page.waitForFunction(()=>window.editingPipeline?.ready,undefined,{timeout:60000}).catch(error=>{throw new Error(`${error.message}\nPage errors: ${JSON.stringify(errors)}\nPage: ${page.url()}`);});
  let text=source();
  await page.evaluate(value=>window.editingPipeline.installSource(value),text);
  const wait=async()=>page.waitForFunction(value=>window.editingPipeline.renderedSource===value,text,{timeout:120000});
  await wait();await page.evaluate(()=>window.editingPipeline.parameter(13));
  const editor=page.getByRole('textbox',{name:'Pipeline source'});
  for(let i=1;i<=8;i++){text=source(i);await editor.fill(text);await wait();assert.equal(await page.evaluate(()=>window.editingPipeline.parameter()),13);}
  for(let i=0;i<3;i++){text=text.replace(/Panel content BASE\d*/,`Panel content BASE${i+1}`);await editor.fill(text);await wait();assert.equal(await page.evaluate(()=>window.editingPipeline.parameter()),13);}
  text=text.replace('value 199','edited 199');await editor.fill(text);await wait();
  text=text.replace('initial="2"','initial="3"');await editor.fill(text);await wait();assert.equal(await page.evaluate(()=>window.editingPipeline.parameter()),3);
  const probe=await page.evaluate(()=>{
    const p=window.editingPipeline;
    return{requests:p.requests.map(x=>({bytes:x.bytes,patch:'edit'in x.data,sourceLength:x.data.source?.length})),responses:p.responses.map(x=>({bytes:x.bytes,patch:'patch'in x.data,stats:x.data.incremental,metrics:x.data.metrics})),commits:p.commits,inputToFrame:p.inputToFrame,inputToPreview:p.inputToPreview,outcomes:p.outcomes,modes:p.modes,workerErrors:p.workerErrors,longTasks:p.longTasks,runtimeCreations:p.runtimeCreations};
  });
  assert.deepEqual(errors,[]);assert.equal(probe.runtimeCreations,1);
  assert.ok(probe.requests.some(x=>x.patch),`Expected negotiated source edit: ${JSON.stringify({requests:probe.requests,outcomes:probe.outcomes,modes:probe.modes,workerErrors:probe.workerErrors})}`);assert.ok(probe.responses.some(x=>x.patch),`Expected result patch: ${JSON.stringify(probe.responses)}`);
  const full=probe.responses.reduce((largest,x)=>!largest||x.bytes>largest.bytes?x:largest,null),patches=probe.responses.filter(x=>x.patch);
  assert.ok(patches.some(x=>x.bytes<full.bytes*.2),`Expected small result patches: ${JSON.stringify({full:full?.bytes,patches:patches.map(x=>x.bytes)})}`);
  const report={generatedAt:new Date().toISOString(),browser:browser.version(),methodology:'Local production Vite build with react-dom/profiling. Real Edge module Worker, negotiated source/result patches, 20ms scheduler delay, React Profiler render actualDuration and two requestAnimationFrame callbacks after commit. Input-to-preview is a frame opportunity after commit, not proof of finished paint. JSON UTF8 lengths estimate message size and are not structured-clone byte counts. Warm startup excluded from input samples. Console/page errors must be empty. State retained during prose/panel/row edits, author initial resets, runtime identity reused.',inputToFrameMedianMs:median(probe.inputToFrame),inputToPreviewMedianMs:median(probe.inputToPreview),reactRenderMedianMs:median(probe.commits.slice(3).map(c=>c.actualDuration)),...probe,errors};
  await page.screenshot({path:'artifacts/editing-completion/browser.png',fullPage:false});
  await mkdir('artifacts/editing-completion',{recursive:true});await writeFile('artifacts/editing-completion/browser.json',JSON.stringify(report,null,2)+'\n');
  const recovery=[];
  for(const behavior of ['legacy','stale-response','stale-base','corrupt-patch']){
    await page.goto(`${base}/scripts/fixtures/editing-pipeline/browser.html?behavior=${behavior}`);
    await page.waitForFunction(()=>window.editingPipeline?.ready,undefined,{timeout:60000});
    let value='<slider bind="n" label="N" initial="2" min="0" max="100">\n\nBase prose';
    await page.evaluate(source=>window.editingPipeline.installSource(source),value);
    await page.waitForFunction(source=>window.editingPipeline.renderedSource===source,value,{timeout:60000});
    value=value.replace('Base prose','Edited prose');
    await page.getByRole('textbox',{name:'Pipeline source'}).fill(value);
    await page.waitForFunction(source=>window.editingPipeline.renderedSource===source,value,{timeout:60000});
    const result=await page.evaluate(()=>{
      const p=window.editingPipeline;
      return{requests:p.requests.map(x=>({id:x.data.id,patch:'edit'in x.data,source:x.data.source})),responses:p.responses.map(x=>({id:x.data.id,patch:'patch'in x.data,code:x.data.code})),outcomes:p.outcomes.map(x=>({sourceLength:x.sourceLength,mode:x.mode})),injections:p.injections??[],modes:p.modes,runtimeSource:p.runtimeSource(),renderedSource:p.renderedSource};
    });
    assert.equal(result.runtimeSource,value);assert.equal(result.renderedSource,value);
    if(behavior==='legacy'){assert.ok(result.requests.every(x=>!x.patch));assert.ok(result.responses.every(x=>!x.patch));}
    else{
      assert.ok(result.requests.some(x=>x.patch));assert.ok(result.injections.includes(behavior));
      if(behavior==='stale-base'||behavior==='corrupt-patch')assert.ok(result.requests.filter(x=>!x.patch).length>=2,`${behavior} did not retry a full source`);
      if(behavior==='stale-response')assert.equal(result.responses.filter(x=>x.id===result.requests[0].id).length,2);
    }
    recovery.push({behavior,...result});
  }
  await page.goto(`${base}/scripts/fixtures/editing-pipeline/browser.html`);
  await page.waitForFunction(()=>window.editingPipeline?.ready,undefined,{timeout:60000});
  let value='<slider bind="n" label="N" initial="2">\n\nLine one\nline two';
  await page.evaluate(source=>window.editingPipeline.installSource(source),value);
  await page.waitForFunction(source=>window.editingPipeline.renderedSource===source,value,{timeout:60000});
  await page.evaluate(()=>window.editingPipeline.cancelPreparation());
  await page.waitForTimeout(350);
  value+='\n\nAfter cancellation';await page.getByRole('textbox',{name:'Pipeline source'}).fill(value);
  await page.waitForFunction(source=>window.editingPipeline.renderedSource===source,value,{timeout:60000});
  assert.equal(await page.evaluate(()=>window.editingPipeline.responses.at(-1).data.metrics?.preparationMs),undefined);
  await page.evaluate(()=>window.editingPipeline.installOptions({markdownBreaks:true}));
  await page.waitForFunction(source=>{const p=window.editingPipeline;return p.compiledSource===source&&p.requests.at(-1).data.source===source&&p.responses.at(-1).data.id===p.requests.at(-1).data.id;},value,{timeout:60000});
  const optionRequest=await page.evaluate(()=>window.editingPipeline.requests.at(-1).data);
  assert.equal(optionRequest.source,value);assert.equal(optionRequest.options.markdownBreaks,true);
  const concurrentValues=[1,2,3,4,5].map(index=>`${value}\n\nConcurrent ${index}`);
  await page.evaluate(values=>{for(const source of values)window.editingPipeline.installConcurrent(source);},concurrentValues);
  const concurrentTarget=concurrentValues.at(-1);
  await page.waitForFunction(source=>window.editingPipeline.renderedSource===source&&window.editingPipeline.runtimeSource()===source,concurrentTarget,{timeout:60000});
  assert.deepEqual(errors,[]);
  const lifecycle={cancelPreparation:true,optionChange:{source:value,markdownBreaks:true},concurrent:{target:concurrentTarget,runtimeSource:await page.evaluate(()=>window.editingPipeline.runtimeSource())}};
  await page.goto(`${base}/scripts/fixtures/editing-pipeline/browser.html?direct=1`);
  await page.waitForFunction(()=>window.editingPipeline?.ready,undefined,{timeout:60000});
  const amount=page.getByLabel('Amount',{exact:true});await amount.fill('13');
  const paused='<number label="Amount" bind="amount" initial="2" min="0" max="20">\n\nPAUSE interrupted render';
  await page.evaluate(source=>window.editingPipeline.installConcurrent(source),paused);
  await page.waitForFunction(()=>window.editingPipeline.suspended,undefined,{timeout:60000});
  assert.equal(await amount.inputValue(),'13');assert.ok(await page.getByText('Committed base',{exact:true}).isVisible());
  const resumed='<number label="Amount" bind="amount" initial="2" min="0" max="20">\n\nFinal concurrent commit';
  await page.evaluate(source=>window.editingPipeline.installConcurrent(source),resumed);
  await page.getByText('Final concurrent commit',{exact:true}).waitFor({timeout:60000});
  assert.equal(await amount.inputValue(),'13');
  await page.evaluate(()=>window.editingPipeline.resumeSuspended?.());
  const directConcurrent={interruptedRetainedValue:13,finalRetainedValue:13,finalText:'Final concurrent commit'};
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/editing-completion/recovery.json',JSON.stringify({generatedAt:new Date().toISOString(),recovery,lifecycle,directConcurrent,errors},null,2)+'\n');
  console.log(JSON.stringify({inputToFrameMedianMs:report.inputToFrameMedianMs,inputToPreviewMedianMs:report.inputToPreviewMedianMs,reactRenderMedianMs:report.reactRenderMedianMs,requests:probe.requests.length,resultPatches:patches.length,runtimeCreations:probe.runtimeCreations,recovery:recovery.map(x=>x.behavior)}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
