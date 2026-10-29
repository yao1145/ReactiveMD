import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {chromium} from 'playwright';
import {build} from 'vite';

const root=resolve('dist-library'),output=resolve('artifacts/dynamic-depth/deep-browser.json');
const previewRoot=resolve('artifacts/dynamic-depth/preview-dist'),preview=process.argv.includes('--preview');
if(preview)await build({configFile:false,base:'./',logLevel:'error',worker:{format:'es'},build:{outDir:previewRoot,rollupOptions:{input:resolve('tests/browser/codemirror-fixture.html')}}});
const server=createServer(async(request,response)=>{
  if(request.url==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Deep Worker verification</title>');return;}
  const pathname=new URL(request.url,'http://localhost').pathname;
  const path=pathname.startsWith('/preview/')?resolve(previewRoot,'.'+pathname.slice(8)):resolve('.'+pathname);
  if(!path.startsWith(root+sep)&&!(preview&&path.startsWith(previewRoot+sep))){response.writeHead(404).end();return;}
  try{response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream');response.end(await readFile(path));}
  catch{response.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/`;
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??'msedge'});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  const results=[],previewResults=[];
  for(const corrupt of [false,true]){
    const result=await page.evaluate(async({base,corrupt})=>{
      const api=await import(base+'dist-library/reactive-md.js');
      const url=URL.createObjectURL(new Blob([`import {startLocalCompileWorker} from '${base}dist-library/reactive-md.js';startLocalCompileWorker();`],{type:'text/javascript'}));
      const native=new Worker(url,{type:'module'}),requests=[],frames=[],outcomes=[];
      let damaged=false,complete,reject,timer;
      const proxy={onmessage:null,onerror:null,onmessageerror:null,terminate(){native.terminate();},postMessage(request){requests.push({patch:'edit'in request,flatResults:request.flatResults});native.postMessage(request);}};
      native.onerror=event=>reject?.(new Error(event.message));
      native.onmessage=({data})=>{
        frames.push({flat:'flatResult'in data,patch:'patch'in data,ok:data.ok});
        if(corrupt&&!damaged&&'flatResult'in data){damaged=true;data={...data,flatResult:{version:'flat-v1',records:[[2,[['cycle',0]]]]}};}
        proxy.onmessage?.({data});
      };
      const scheduler=new api.LocalCompileScheduler({createWorker:()=>proxy,delay:0,includeAuthorAnalysis:true,onResult(outcome){complete?.(outcome);}});
      async function run(source,depth,kind='quote'){
        const start=performance.now();
        const result=await new Promise((resolve,rejectRun)=>{complete=resolve;reject=rejectRun;timer=setTimeout(()=>rejectRun(new Error('Deep compile timed out')),30000);scheduler.schedule(source);});
        clearTimeout(timer);
        let measuredDepth=0,leaf;
        if(result.result.ok){leaf=result.result.document.nodes[0];while(leaf?.children?.length){if(leaf.type==='blockquote'||leaf.type==='list')measuredDepth++;leaf=leaf.children[0];}}
        const row={kind,depth,mode:result.mode,ok:result.result.ok,measuredDepth,leafType:leaf?.type,leafValue:leaf?.value,diagnostics:result.result.diagnostics.map(d=>d.messageKey??d.message),compileMs:result.duration,totalMs:performance.now()-start,metrics:result.metrics,analysis:!!result.analysis};
        outcomes.push(row);return row;
      }
      try{
        for(const depth of [100,500,1000,1000,1001,0]){
          const source=depth?'> '.repeat(depth)+(outcomes.length===3?'{{ 3 + 4 }}':'{{ 1 + 2 }}'):'ordinary text';
          await run(source,depth);
        }
        await run('- '.repeat(1000)+'{{ 1 + 2 }}',1000,'list');
        const edited=await run('- '.repeat(1000)+'{{ 3 + 4 }}',1000,'list');
        if(edited.leafValue!=='3 + 4')throw new Error('Stale list compile: '+JSON.stringify(edited));
        await run('> - '.repeat(500)+'{{ 1 + 2 }}',1000,'mixed');
        return {corrupt,requests,frames,outcomes};
      }finally{clearTimeout(timer);scheduler.dispose();URL.revokeObjectURL(url);}
    },{base,corrupt});
    for(const row of result.outcomes){
      assert.equal(row.mode,'worker');
      if(row.depth===1001){assert.equal(row.ok,false);assert.ok(row.diagnostics.includes('local.budget.markdown-depth'));}
      else{assert.equal(row.ok,true,JSON.stringify(row));assert.equal(row.measuredDepth,row.depth);assert.equal(row.analysis,true);}
    }
    assert.equal(result.requests.length,corrupt?10:9);
    assert.equal(result.frames.filter(frame=>frame.flat).length,corrupt?8:7);
    assert.equal(result.outcomes[3].leafValue,'3 + 4');
    results.push(result);console.log(JSON.stringify(result.outcomes));
  }
  if(preview){
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(base+'preview/tests/browser/codemirror-fixture.html');
    await page.waitForFunction(()=>window.cmProbe?.ready);
    for(const [kind,depth,prefix]of [['quote',500,'> '.repeat(500)],['quote',1000,'> '.repeat(1000)],['list',1000,'- '.repeat(1000)],['ordered',1000,'1. '.repeat(1000)],['mixed',1000,'> - '.repeat(500)]]){
      const source='<number bind="n" label="N" initial="2">\n\n'+prefix+'value {{ n * 2 }}';
      await page.evaluate(source=>window.cmProbe.install(source),source);
      await page.waitForFunction(source=>window.cmProbe.previewSource===source,source,{timeout:30000});
      assert.equal(await page.locator('article blockquote, article ul, article ol').count(),depth);
      const input=page.getByRole('textbox',{name:'N',exact:true});
      await input.fill('13');await input.dispatchEvent('change');
      const changed=source.replace('n * 2','n * 3');
      await page.evaluate(source=>window.cmProbe.install(source),changed);
      await page.waitForFunction(source=>window.cmProbe.previewSource===source,changed,{timeout:30000});
      await page.waitForFunction(()=>document.querySelector('article')?.textContent?.includes('39'),undefined,{timeout:10000}).catch(async error=>{
        const evidence=await page.evaluate(()=>{
          const document=window.cmProbe.document(),stack=[...document.nodes],values=[];
          while(stack.length){const node=stack.pop();if(node.type==='interpolation')values.push(node.value);if(node.children)stack.push(...node.children);}
          return {values,errors:window.cmProbe.errors,responses:window.cmProbe.responses.slice(-2),sourceEnd:document.source.slice(-50)};
        });throw new Error(`${kind}: ${error.message}; ${JSON.stringify(evidence)}`);
      });
      assert.equal(await input.inputValue(),'13');
      const previewText=await page.locator('article').textContent();
      assert.ok(previewText.includes('39'),JSON.stringify({kind,depth,previewText:previewText.slice(-200),errors:await page.evaluate(()=>window.cmProbe.errors)}));
      previewResults.push({kind,depth,containerCount:await page.locator('article blockquote, article ul, article ol').count(),parameter:await input.inputValue(),workers:await page.evaluate(()=>window.cmProbe.workers)});
    }
    assert.deepEqual(await page.evaluate(()=>window.cmProbe.errors),[]);
    await page.screenshot({path:resolve('artifacts/dynamic-depth/deep-preview.png')});
  }
  assert.deepEqual(errors,[]);
  await mkdir(resolve(output,'..'),{recursive:true});
  await writeFile(output,JSON.stringify({generatedAt:new Date().toISOString(),browser:browser.version(),methodology:'Production ESM, real module Worker and public scheduler with author analysis. 100/500/1000 quote levels, deep edits, 1001 budget rejection, ordinary recovery, 1000 nested lists and 500 quote/list pairs; repeat with one forged cyclic flat response. --preview additionally verifies CM6 plus React preview at 500/1000 quote levels, 1000 unordered/ordered lists and mixed containers, parameter retention and recomputed interpolation. Timings are verification samples, not benchmark percentiles.',results,previewResults,errors},null,2)+'\n');
}finally{await browser?.close();await new Promise(done=>server.close(done));}
