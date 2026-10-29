import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const flag=(name,fallback)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const modulePath=resolve(flag('module','dist-library/reactive-md.js'));
const output=resolve(flag('out','artifacts/next-editing/row-benchmark.json'));
const filter=new RegExp(flag('case','.*'));
const samples=Number(flag('samples','15')),warmups=3;
assert.ok(Number.isSafeInteger(samples)&&samples>0);
const api=await import(pathToFileURL(modulePath).href);
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {median:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]};};
const flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children??[])]);
const cases=['list','table','dynamic-list','dynamic-table'].flatMap(kind=>['equal','shift'].map(edit=>({kind,edit})))
  .concat([{kind:'paragraphs',edit:'equal'},{kind:'list',edit:'rewrite'}]);
const results=[];
for(const {kind,edit} of cases){
  if(!filter.test(`${kind}-${edit}`))continue;
  const size=kind==='paragraphs'?800:kind.endsWith('table')?500:1000;
  const source=revision=>{
    const suffix=String(1000+revision);
    const marker=i=>edit==='rewrite'?suffix:i===Math.floor(size/2)?suffix+(edit==='shift'&&revision%2?(kind.startsWith('dynamic-')?' + 0':' extra'):''):'1000';
    const dynamic=kind.startsWith('dynamic-');
    const value=i=>dynamic?`{{ n * ${marker(i)} }}`:marker(i);
    const body=kind.endsWith('table')?'| Name | Value | Note |\n| --- | --- | --- |\n'+Array.from({length:size},(_,i)=>`| Row ${i} | ${value(i)} | Fixed ${i} |`).join('\n')
      :Array.from({length:size},(_,i)=>kind==='paragraphs'?`Paragraph ${i} stable text ${value(i)}.`:`- Item ${i} with **formatting** value ${value(i)}.`).join(kind==='paragraphs'?'\n\n':'\n');
    return `${dynamic?'<slider bind="n" label="N" initial="2">\n\n':''}Before\n\n${body}\n\nAfter`;
  };
  const scope={onmessage:null,postMessage(response){this.response=response;}};
  const control=api.startLocalCompileWorker(scope,{preparationDelay:60000});
  let previousSource=source(0),base;
  scope.onmessage({data:{id:1,revision:1,protocol:api.LOCAL_RESULT_PATCH_PROTOCOL,source:previousSource,options:{limits:{maxSyntaxNodes:50000}}}});
  assert.ok(scope.response.ok&&scope.response.result?.ok);
  base=structuredClone(scope.response.result);
  const measurements=[];
  try{
    for(let round=1;round<=warmups+samples;round++){
      const nextSource=source(round),started=performance.now();
      scope.onmessage({data:{id:round+1,revision:round+1,baseRevision:round,protocol:api.LOCAL_RESULT_PATCH_PROTOCOL,
        edit:api.diffSourceEdit(previousSource,nextSource),targetLength:nextSource.length}});
      const response=scope.response,workerMs=performance.now()-started;
      assert.ok(response.ok&&!response.retryFull);
      const cloneStarted=performance.now(),cloned=structuredClone(response),cloneMs=performance.now()-cloneStarted,applyStarted=performance.now();
      const next=cloned.patch?api.applyLocalResultPatch(base,cloned.patch):cloned.result;
      const applyMs=performance.now()-applyStarted;
      assert.ok(next?.ok);assert.equal(next.document.source,nextSource);
      if(round>warmups){
        const before=new Set(flatten(base.document.nodes));
        measurements.push({workerMs,compileMs:response.metrics.compileMs,encodeMs:response.metrics.patchEncodeMs??0,cloneMs,applyMs,
          bytes:Buffer.byteLength(JSON.stringify(response)),shared:flatten(next.document.nodes).filter(n=>before.has(n)).length,
          transport:cloned.patch?'patch':'full',fallback:response.metrics.patchFallback,incremental:response.incremental});
      }
      base=next;previousSource=nextSource;
    }
  }finally{control.dispose();}
  const metrics=Object.fromEntries(['workerMs','compileMs','encodeMs','cloneMs','applyMs','bytes','shared'].map(key=>[key,summary(measurements.map(m=>m[key]))]));
  const row={kind,edit,size,...metrics,patches:measurements.filter(m=>m.transport==='patch').length,last:measurements.at(-1),samples:measurements};
  results.push(row);console.log(JSON.stringify({kind,edit,...metrics,patches:row.patches}));
}
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({modulePath,warmups,samples,results,notes:[
  'Production bundle, in-process Worker handler: no browser rendering, scheduling delay or thread message latency.',
  'Every response crosses structuredClone before application. UTF-8 JSON bytes estimate payload size, not structured-clone size.',
  'P95 is exploratory with 15 measured edits. Each case has one persistent compiler session.',
]},null,2)+'\n');
