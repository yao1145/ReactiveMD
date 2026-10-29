import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const self=fileURLToPath(import.meta.url);
const cases=[
  {kind:'ordinary',size:1000},
  {kind:'mixed',size:80},
  {kind:'table',size:1000},
  {kind:'component-table',size:500},
  {kind:'component-dynamic-table',size:500,iterations:7},
  {kind:'controls',size:5000},
  ...[16_000,64_000,256_000].map(size=>({kind:'indented-line',size,iterations:5})),
  {kind:'over-budget-list',size:50_000,iterations:3},
];
function fixture(c) {
  if(c.kind==='ordinary')return Array.from({length:c.size},(_,i)=>`Paragraph ${i}, ordinary explanatory text.`).join('\n\n');
  if(c.kind==='mixed')return Array.from({length:c.size},(_,i)=> i===Math.floor(c.size/2)?'A [link](/path) with \\*escaped\\* text.':i%2
    ?Array.from({length:5},(_,n)=>`- Item ${i}-${n} with **bold**.`).join('\n')
    :'|A|B|C|D|\n|-|-|-|-|\n'+Array.from({length:10},(_,n)=>`|${i}|${n}|value|text|`).join('\n')).join('\n\n');
  if(c.kind==='indented-line')return '<panel>\n    '+ 'ordinary text '.repeat(Math.ceil(c.size/14)).slice(0,c.size)+'\n</panel>';
  if(c.kind==='over-budget-list')return Array.from({length:c.size},(_,i)=>`- Item ${i}`).join('\n');
  if(c.kind==='controls')return Array.from({length:c.size},(_,i)=>`<slider bind="v${i}" label="Value ${i}" initial="2">`).join('\n');
  if(c.kind==='component-dynamic-table')return '<slider bind="n" label="N" initial="2">\n\n<table label="Data">\n| Item | Value |\n| - | - |\n'+Array.from({length:c.size},(_,i)=>`|row ${i}|{{ n * ${i+1} }}|`).join('\n')+'\n</table>';
  const table='|A|B|C|D|\n|-|-|-|-|\n'+Array.from({length:c.size},(_,i)=>`|row ${i}|${i}|${i+1}|${i+2}|`).join('\n');
  return c.kind==='component-table'?'<table label="Data">\n'+table+'\n</table>':table;
}
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return{medianMs:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],samples:values};};
async function child(spec) {
  const {compileLocal}=await import(spec.module),source=fixture(spec),times=[];
  let result;
  for(let i=0;i<spec.warmups+spec.iterations;i++) {
    const start=performance.now();result=compileLocal(source);const elapsed=performance.now()-start;
    if(spec.kind==='over-budget-list') {assert.equal(result.ok,false);assert.equal(result.diagnostics[0].code,'local.budget');}
    else {assert.ok(result.ok,JSON.stringify(result.diagnostics));assert.equal(result.diagnostics.length,0);}
    if(i>=spec.warmups)times.push(elapsed);
  }
  const digest=createHash('sha256').update(JSON.stringify(ordered(result))).digest('hex');
  global.gc();const retained=process.memoryUsage();result=null;global.gc();const released=process.memoryUsage();
  return {id:`${spec.kind}-${spec.size}`,label:spec.label,characters:source.length,iterations:spec.iterations,timing:summary(times),digest,retained,released,peakRssBytes:process.resourceUsage().maxRSS*1024};
}
async function run(spec) {
  return new Promise((resolveChild,reject)=>{
    const proc=fork(self,['--child',JSON.stringify(spec)],{silent:true,execArgv:['--expose-gc']});
    let result,error='';proc.stdout.resume();proc.stderr.on('data',s=>{error=(error+s).slice(-4000);});
    proc.on('message',value=>{result=value;});proc.on('error',reject);
    const timer=setTimeout(()=>proc.kill(),120000);
    proc.on('close',code=>{clearTimeout(timer);code===0&&result?resolveChild(result):reject(new Error(`Child exited ${code}: ${error}`));});
  });
}
if(process.argv[2]==='--child')process.send(await child(JSON.parse(process.argv[3])));
else {
  const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
  const filter=new RegExp(option('--case','.*')),iterations=Number(option('--iterations','15')),warmups=Number(option('--warmups','3'));
  assert.ok(Number.isInteger(iterations)&&iterations>0&&Number.isInteger(warmups)&&warmups>=0);
  const variants=[{label:'after',module:'reactive-md'}];
  if(args.includes('--before'))variants.unshift({label:'before',module:pathToFileURL(resolve(option('--before'))).href});
  const report={generatedAt:new Date().toISOString(),environment:{node:process.version,cpu:cpus()[0]?.model,platform:process.platform,arch:process.arch},iterations,warmups,variants,
    methodology:'Serial isolated Node processes with --expose-gc and default heap. Version order alternates by case. Timings include complete compileLocal result construction, exclude fixture generation, assertions, hashing and GC. Long-line cases use at most 5 samples and over-budget uses at most 3. Canonical full-result hashes must match. Peak RSS covers the whole child process. Work counters are aggregate parser-call work, measured separately through Vite SSR, not unique source coverage. No rendering.',results:[]};
  const selected=cases.filter(c=>filter.test(`${c.kind}-${c.size}`));assert.ok(selected.length,'No cases matched');
  const output=resolve(option('--output','artifacts/parser-pipeline/benchmark.json'));await mkdir(dirname(output),{recursive:true});
  for(let i=0;i<selected.length;i++)for(const variant of i%2?[...variants].reverse():variants) {
    const c=selected[i],result=await run({...c,...variant,iterations:Math.min(iterations,c.iterations??iterations),warmups});report.results.push(result);
    console.log(JSON.stringify({id:result.id,label:result.label,medianMs:result.timing.medianMs,p95Ms:result.timing.p95Ms,peakRssMiB:result.peakRssBytes/1048576}));
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
  }
  if(variants.length===2)for(const c of selected) {
    const pair=report.results.filter(r=>r.id===`${c.kind}-${c.size}`);assert.equal(pair[0].digest,pair[1].digest,`Full result mismatch: ${c.kind}-${c.size}`);
  }
  const {createServer}=await import('vite');const server=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true}});
  try {
    const {parseLocal}=await server.ssrLoadModule('/src/local/parser.ts');
    report.parserWork=selected.map(c=>({id:`${c.kind}-${c.size}`,work:parseLocal(fixture(c)).work}));
  } finally {await server.close();}
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(`Report: ${output}`);
}
