import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
import {cpus} from 'node:os';
const arg=(name,fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const root=resolve(arg('output','artifacts/performance-overview')),baseline=arg('baseline',null);
const only=arg('only','').split(',').filter(Boolean),skip=arg('skip','').split(',');
await mkdir(root,{recursive:true});
const steps=[
  ['compiler','benchmark-compiler-stress.mjs',['--samples','15','--warmups','3','--timeout','120000','--output',root+'/compiler-stress.json']],
  ['blocks','benchmark-block-types.mjs',['--iterations','15','--output',root+'/blocks.json']],
  ['parser','benchmark-parser-pipeline.mjs',['--iterations','15','--output',root+'/parser.json']],
  ['fast','benchmark-fast-blocks.mjs',['--iterations','15','--edits','200','--output',root+'/fast.json']],
  ['incremental','benchmark-incremental.mjs',[],{},['artifacts/benchmark-incremental.json','incremental.json']],
  ['memory','benchmark-editing-memory.mjs',[],{EDITING_MEMORY_REPORT:root+'/memory.json'}],
  ...(baseline?[['rows-before','benchmark-row-reuse.mjs',[`--module=${resolve(baseline)}/reactive-md.js`,`--out=${root}/rows-before.json`]]]:[]),
  ['rows','benchmark-row-reuse.mjs',[`--out=${root}/rows.json`]],
  ['worker','benchmark-compiler-browser.mjs',['--output',root+'/worker.json']],
  ['protocol','benchmark-editing-pipeline.mjs',[],{},['artifacts/editing-completion/recovery.json','recovery.json']],
  ...(baseline?[
    ['editing','benchmark-editing-comparison.mjs',[],{EDITING_BEFORE:resolve(baseline),EDITING_COMPARISON_REPORT:root+'/editing.json'}],
    ['editing-dynamic','benchmark-editing-comparison.mjs',[],{EDITING_BEFORE:resolve(baseline),EDITING_DYNAMIC_ROWS:'1',EDITING_CASES:'list,table',EDITING_COMPARISON_REPORT:root+'/editing-dynamic.json'}],
  ]:[]),
  ['render','benchmark-render-pipeline.mjs',['--variants','after','--editor','full','--cases','paragraphs800,paragraphs2400,table1000,controls1000,controls5000','--samples','15','--output',root+'/render.json']],
  ['cm6','verify-codemirror-browser.mjs',['--demo','--memory','--edits=2000'],{},['artifacts/cm6/memory-results.json','cm6.json']],
  ['stages','benchmark-stages.mjs',['--iterations','15','--output',root+'/stages.json']],
];
for(const name of only)assert.ok(steps.some(step=>step[0]===name),`Unknown stage ${name}`);
const manifest={startedAt:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,platform:process.platform,baseline,results:[]};
if(only.length){
  try{const previous=JSON.parse(await readFile(root+'/run-manifest.json','utf8'));manifest.results=previous.results.filter(result=>!only.includes(result.name));}catch{}
}
for(const [name,script,args,env={},copy] of steps){
  if(skip.includes(name)||only.length&&!only.includes(name))continue;
  console.log('START '+name);const started=Date.now(),log=createWriteStream(root+'/'+name+'.log');
  const status=await new Promise(done=>{
    const child=spawn(process.execPath,['scripts/'+script,...args],{windowsHide:true,env:{...process.env,...env}});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    child.once('error',error=>done({error:error.message}));child.once('close',(code,signal)=>done({code,signal}));
  });
  await new Promise(done=>log.end(done));
  if(status.code===0&&copy)await copyFile(copy[0],root+'/'+copy[1]);
  const result={name,script,args,environment:env,...status,seconds:(Date.now()-started)/1000};
  manifest.results.push(result);await writeFile(root+'/run-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(result));
}
if(manifest.results.some(result=>result.code!==0))process.exitCode=1;
