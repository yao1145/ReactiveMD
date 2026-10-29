import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {cpus} from 'node:os';

const self=fileURLToPath(import.meta.url);
const output=resolve(process.env.EDITING_MEMORY_REPORT??'artifacts/editing-completion/memory.json');
const round=value=>Number(value.toFixed(3));
const mib=value=>round(value/1048576);
function memory(){global.gc();const usage=process.memoryUsage();return{...usage,heapUsedMiB:mib(usage.heapUsed),rssMiB:mib(usage.rss),maxRssBytes:process.resourceUsage().maxRSS*1024,maxRssMiB:mib(process.resourceUsage().maxRSS*1024)};}
function sourceFixture(size=250){
  return '<slider bind="n" label="N" initial="2" min="0" max="100">\n\n'
    +Array.from({length:size},(_,i)=>`Paragraph ${i} revision 0 with **bold** and {{ n * 2 }}.`).join('\n\n')
    +'\n\n'+Array.from({length:600},(_,i)=>`- Item ${i} revision 0 with **bold**.`).join('\n')
    +'\n\n|A|B|\n|-|-|\n'+Array.from({length:200},(_,i)=>`|row ${i}|cell ${i} revision 0|`).join('\n');
}
async function longEdit(){
  const {createLocalCompileSession}=await import('reactive-md'),session=createLocalCompileSession(),checkpoints=[];
  const before=memory(),base=sourceFixture();let source=base,result=null;
  for(let i=1;i<=500;i++){
    source=base.replace(/Paragraph 100 revision \d+/,`Paragraph 100 revision ${i}`).replace(/Item 300 revision \d+/,`Item 300 revision ${i}`).replace(/cell 100 revision \d+/,`cell 100 revision ${i}`);
    result=session.compileShared(source);assert.ok(result.ok);
    if(i%50===0)checkpoints.push({iteration:i,...memory(),parseEntries:session.stats.parse?.entries,semanticEntries:session.stats.semantic?.entries,sharedNodes:session.stats.sharedNodes});
  }
  const retained=memory();result=null;const resultReleased=memory();session.dispose();const disposed=memory();
  const first=checkpoints[0].heapUsed,last=checkpoints.at(-1).heapUsed;
  return{iterations:500,before,checkpoints,retained,resultReleased,disposed,heapGrowthAfterWarmupBytes:last-first,heapGrowthAfterWarmupMiB:mib(last-first)};
}
async function cacheEviction(){
  const {createLocalCompileSession}=await import('reactive-md'),session=createLocalCompileSession(),before=memory(),base=sourceFixture(30);let result=null;
  for(let i=1;i<=260;i++){
    const source=base.replaceAll('revision 0',`revision ${i}`)+`\n\nUnique cache key ${i} ${'x'.repeat(i)}`;
    result=session.compileShared(source);assert.ok(result.ok);
  }
  const stats=session.stats;assert.ok((stats.parse?.entries??0)<=672);assert.ok((stats.semantic?.entries??0)<=16384);
  const retained=memory();result=null;session.dispose();const disposed=memory();
  return{iterations:260,before,retained,disposed,parseEntries:stats.parse?.entries,semanticEntries:stats.semantic?.entries};
}
async function rapidCancel(){
  const {createLocalCompileSession}=await import('reactive-md'),session=createLocalCompileSession(),before=memory(),base=sourceFixture(80);let result=null;
  for(let i=0;i<120;i++){
    const controller=new AbortController();
    const preparation=session.prepareAsync(controller.signal,()=>new Promise(resolveYield=>setTimeout(resolveYield,0)));
    controller.abort();
    if(i%3===0){result=session.compileShared(base+`\n\nRevision ${i}`);assert.ok(result.ok);}
    assert.equal(await preparation,false);
  }
  const retained=memory();result=null;session.dispose();const disposed=memory();
  return{iterations:120,before,retained,disposed};
}
async function longText(){
  const {createLocalCompileSession,compileLocal}=await import('reactive-md'),session=createLocalCompileSession(),before=memory();
  const source='普通文字 abc '.repeat(Math.ceil(1_000_000/9)).slice(0,1_000_000);
  const input=memory();let result=session.compileShared(source);assert.ok(result.ok);
  const retained=memory();result=null;session.dispose();const disposed=memory();
  const rejected=compileLocal(source+'x');assert.equal(rejected.ok,false);assert.equal(rejected.diagnostics[0].code,'local.budget');
  return{characters:source.length,before,input,retained,disposed,overLimitDiagnostic:rejected.diagnostics[0].code};
}
async function manyComponents(){
  const {createLocalCompileSession}=await import('reactive-md'),session=createLocalCompileSession(),before=memory();
  const source=Array.from({length:5000},(_,i)=>`<slider bind="v${i}" label="Value ${i}" initial="2" min="0" max="100">`).join('\n');
  const options={limits:{maxSyntaxNodes:250_000}};let result=session.compileShared(source,options);assert.ok(result.ok);
  const retained=memory();result=null;session.dispose();const disposed=memory();
  return{components:5000,characters:source.length,before,retained,disposed};
}
async function deepContainers(){
  const {compileLocal}=await import('reactive-md'),before=memory(),accepted=compileLocal('> '.repeat(1000)+'text'),rejected=compileLocal('> '.repeat(1001)+'text');
  assert.equal(accepted.ok,true);assert.equal(rejected.ok,false);assert.equal(rejected.diagnostics[0].code,'local.budget');
  const disposed=memory();return{acceptedDepth:1000,rejectedDepth:1001,before,disposed,diagnostic:rejected.diagnostics[0].code};
}
const cases={longEdit,cacheEviction,rapidCancel,longText,manyComponents,deepContainers};
async function runChild(name){
  const started=performance.now(),result=await cases[name]();process.send({name,status:'completed',wallMs:round(performance.now()-started),...result});
}
async function main(){
  const results=[];
  for(const name of Object.keys(cases)){
    console.log(`START ${name}`);
    const result=await new Promise(resolveCase=>{
      const child=fork(self,['--child',name],{execArgv:['--expose-gc','--max-old-space-size=1024'],silent:true});let report=null,stderr='';
      child.stdout.resume();child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});child.on('message',message=>{report=message;});
      const timer=setTimeout(()=>child.kill(),240000);
      child.on('close',(code,signal)=>{clearTimeout(timer);resolveCase(report??{name,status:'failed',code,signal,stderr});});
    });
    results.push(result);await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({generatedAt:new Date().toISOString(),module:pathToFileURL(resolve('dist-library/reactive-md.js')).href,environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,childOldSpaceLimitMiB:1024},methodology:'Isolated production-package processes with explicit GC before every memory snapshot. Long edits retain the previous preview until its replacement exists. RSS peak covers the entire child; heapUsed is a post-GC snapshot, not total allocations. No hard real-time or cross-machine memory threshold is inferred.',results},null,2)+'\n');
    console.log(JSON.stringify({name,status:result.status,retainedMiB:result.retained?.heapUsedMiB,disposedMiB:result.disposed?.heapUsedMiB,peakMiB:result.retained?.maxRssMiB??result.disposed?.maxRssMiB}));
    assert.equal(result.status,'completed',JSON.stringify(result));
  }
  console.log(`Report: ${output}`);
}
if(process.argv[2]==='--child')await runChild(process.argv[3]);
else await main();
