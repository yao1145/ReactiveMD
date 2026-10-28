import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const self = fileURLToPath(import.meta.url);
function fixture(kind, size, revision) {
  const table = kind === 'table' || kind === 'component-table';
  const text = table
    ? '| A | B | C | D |\n| --- | :--- | ---: | :---: |\n' + Array.from({length:size},(_,i)=>`| row ${i} | ${i} | ${i+1} | ${i===size-1?revision:i+2} |`).join('\n')
    : Array.from({length:size},(_,i)=>`- Item ${i} with **formatting** and value ${i===size-1?revision:i}.`).join('\n');
  return kind === 'component-table' ? '<table label="Data">\n' + text + '\n</table>' : text;
}
const summary = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return {medianMs:sorted[Math.ceil(sorted.length/2)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],samples:values};
};
function memory() {global.gc();return process.memoryUsage();}

async function child(spec) {
  assert.ok(global.gc, 'Child requires --expose-gc');
  const {compileLocal,createLocalCompileSession} = await import(spec.module);
  const before = memory();
  if (spec.kind === 'context') {
    const session = createLocalCompileSession();
    const background = Array.from({length:1000},(_,i)=>`Background paragraph ${i}.`).join('\n\n');
    const source = n => `<slider bind="n" label="N" initial="${n}" min="0" max="10000">\n\n${background}\n\nValue {{ n }}`;
    const checkpoints=[], times=[];
    let result, builds=spec.label==='after'?0:null;
    for (let i=0;i<spec.edits;i++) {
      const text=source(1000+i),start=performance.now();
      result=session.compile(text); const duration=performance.now()-start;
      assert.ok(result.ok); assert.equal(result.diagnostics.length,0);
      assert.equal(result.document.initialState.n,1000+i);
      if(i>0) {times.push(duration);if(builds!==null)builds+=session.stats.cacheBuilds??0;}
      if((i+1)%20===0)checkpoints.push({iteration:i+1,...memory()});
    }
    if(spec.label==='after')assert.equal(builds,0);
    const recoverySource=source(1000+spec.edits-1).replace('Background paragraph 999.','Edited final paragraph.'),start=performance.now();
    const recovered=session.compile(recoverySource),recoveryMs=performance.now()-start;
    assert.ok(recovered.ok);assert.equal(session.stats.mode,'incremental');
    if(spec.label==='after')assert.equal(session.stats.cacheBuilds,1);
    const recoveryStats=session.stats;
    result=null; const retained=memory(); session.dispose(); const disposed=memory();
    return {id:'context',label:spec.label,edits:spec.edits,before,checkpoints,retained,disposed,editTimes:summary(times),builds,recoveryMs,recoveryStats};
  }
  const times=[];
  let result;
  for(let i=0;i<spec.warmups+spec.iterations;i++) {
    const source=fixture(spec.kind,spec.size,1000+i),start=performance.now();
    result=compileLocal(source);const elapsed=performance.now()-start;
    assert.ok(result.ok,JSON.stringify(result.diagnostics));assert.equal(result.diagnostics.length,0);
    if(i>=spec.warmups)times.push(elapsed);
  }
  const source=fixture(spec.kind,spec.size,1234);
  result=compileLocal(source);assert.ok(result.ok);
  const digest=createHash('sha256').update(JSON.stringify(result)).digest('hex');
  const retained=memory();result=null;const released=memory();
  return {id:`${spec.kind}-${spec.size}`,label:spec.label,sourceCharacters:source.length,timing:summary(times),digest,before,retained,released,peakRssBytes:process.resourceUsage().maxRSS*1024};
}
async function run(spec) {
  return new Promise((resolveChild,reject)=>{
    const proc=fork(self,['--child',JSON.stringify(spec)],{silent:true,execArgv:['--expose-gc']});
    let result,error='';proc.stdout.resume();proc.stderr.on('data',s=>{error=(error+s).slice(-4000);});
    proc.on('message',value=>{result=value;});proc.on('error',reject);
    const timeout=setTimeout(()=>proc.kill(),120000);
    proc.on('close',code=>{clearTimeout(timeout);code===0&&result?resolveChild(result):reject(new Error(`Benchmark child exited ${code}: ${error}`));});
  });
}
if(process.argv[2]==='--child')process.send(await child(JSON.parse(process.argv[3])));
else {
  const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
  const iterations=Number(option('--iterations','15')),warmups=Number(option('--warmups','3')),edits=Number(option('--edits','200'));
  assert.ok(Number.isInteger(iterations)&&iterations>0&&Number.isInteger(warmups)&&warmups>=0&&Number.isInteger(edits)&&edits>=20);
  const variants=[{label:'after',module:'reactive-md'}];
  if(args.includes('--before'))variants.unshift({label:'before',module:pathToFileURL(resolve(option('--before'))).href});
  const report={generatedAt:new Date().toISOString(),environment:{node:process.version,cpu:cpus()[0]?.model,platform:process.platform,arch:process.arch},iterations,warmups,edits,variants,
    methodology:'Serial child processes, default heap, --expose-gc. Full compile timings exclude source generation/assertions/GC; complete result included. Table cells and list content use a conservative fast subset. Version order alternates per size. SHA256 compares full serialized output of each pair. Retention samples run GC every 20 context edits; recovered result remains alive at disposal. No React rendering.',results:[]};
  const output=resolve(option('--output','artifacts/benchmark-fast-blocks.json'));await mkdir(dirname(output),{recursive:true});
  const filter = new RegExp(option('--case','.*'));
  const cases=[...['bullet','table','component-table'].flatMap(kind=>(kind==='bullet'?[100,500,1500]:kind==='table'?[100,500,1000]:[100,500]).map(size=>({kind,size}))),{kind:'context'}]
    .filter(c=>filter.test(c.kind==='context'?'context':`${c.kind}-${c.size}`));
  for(let i=0;i<cases.length;i++) {
    for(const variant of i%2?[...variants].reverse():variants) {
      const result=await run({...cases[i],...variant,iterations,warmups,edits});report.results.push(result);
      console.log(JSON.stringify({id:result.id,label:result.label,medianMs:result.timing?.medianMs??result.editTimes?.medianMs,p95Ms:result.timing?.p95Ms,builds:result.builds,recoveryMs:result.recoveryMs}));
      await writeFile(output,JSON.stringify(report,null,2)+'\n');
    }
  }
  if(variants.length===2)for(const spec of cases.filter(c=>c.kind!=='context')) {
    const pair=report.results.filter(r=>r.id===`${spec.kind}-${spec.size}`);assert.equal(pair[0].digest,pair[1].digest);
  }
  console.log(`Report: ${output}`);
}
