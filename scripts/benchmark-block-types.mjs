import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const self = fileURLToPath(import.meta.url);
const token = 'REVISION';
const slider = '<slider bind="n" label="N" initial="2">';
const definitions = [
  ['plain',512,'普通段落，约 512 字符'], ['plain',8192,'普通段落，约 8 Ki 字符'],
  ['formatted',512,'格式段落，约 512 字符'], ['heading',80,'二级标题，约 80 字符'],
  ['bullet',20,'无序列表，20 项'], ['bullet',100,'无序列表，100 项'], ['ordered',20,'有序列表，20 项'],
  ['table',20,'Markdown 表格，20×4'], ['table',100,'Markdown 表格，100×4'], ['table',200,'Markdown 表格，200×4'],
  ['quote',10,'块引用，10 段'], ['fenced',60,'围栏代码，60 行'], ['fenced',300,'围栏代码，300 行'], ['indented',60,'缩进代码，60 行'],
  ['math',20,'显示公式，20 项'], ['math',80,'显示公式，80 项'], ['expressions',20,'表达式段落，20 个插值'],
  ['control',1,'滑块初值修改'], ['panel',50,'Panel 内部，50 段'], ['component-table',20,'ReactiveMD 表格，20×4'],
  ['chart',20,'柱状图数据，20 行'], ['plot',1,'Plot 公式，1 条曲线'], ['diagram',20,'Diagram 节点正文，20 节点'],
  ['fence-delimiter',60,'围栏定界符修改，60 行代码'],
].map(([kind,size,label]) => ({kind,size,label,id:`${kind}-${size}`}));

function fixture(c, revision) {
  const {kind,size} = c;
  let source, prefix = '';
  if(kind==='plain') source='Ordinary text for a stable paragraph. '.repeat(Math.ceil(size/37)).slice(0,size-16)+` revision ${token}.`;
  if(kind==='formatted') { const unit='Text with **bold**, _emphasis_, [link](/path) and `code`. ';source=unit.repeat(Math.max(1,Math.floor((size-20)/unit.length)))+` Revision ${token}.`; }
  if(kind==='heading') source='## '+ 'Heading text '.repeat(6)+` revision ${token}`;
  if(kind==='bullet'||kind==='ordered') source=Array.from({length:size},(_,i)=>`${kind==='bullet'?'-':`${i+1}.`} Item ${i} with **formatting** and value ${i===size-1?token:i}.`).join('\n');
  if(kind==='table'||kind==='component-table') {
    source='| A | B | C | D |\n| --- | --- | --- | --- |\n'+Array.from({length:size},(_,i)=>`| row ${i} | ${i===size-1?token:i} | ${i+1} | ${i+2} |`).join('\n');
    if(kind==='component-table') source='<table label="Data">\n'+source+'\n</table>';
  }
  if(kind==='quote') source=Array.from({length:size},(_,i)=>`> Quoted paragraph ${i}, value ${i===size-1?token:i}.`).join('\n>\n');
  if(kind==='fenced'||kind==='fence-delimiter'||kind==='indented') {
    const code=Array.from({length:size},(_,i)=>`const value${i} = ${i===size-1?token:i};`).join('\n');
    if(kind==='indented') source=code.split('\n').map(line=>'    '+line).join('\n');
    else { const fence='`'.repeat(kind==='fence-delimiter'?3+(revision%2):3); source=fence+'js\n'+code+'\n'+fence; }
  }
  if(kind==='math') source='$$\n'+Array.from({length:size},(_,i)=>`\\frac{x^{${i+1}}}{${i+1}}`).join(' + ')+` + ${token}\n$$`;
  if(kind==='expressions') { prefix=slider; source='Values: '+Array.from({length:size},(_,i)=>`{{ n * ${i+1} + ${i===size-1?token:i} }}`).join(', '); }
  if(kind==='control') source=`<slider bind="input" label="Input" initial="${token}" min="0" max="10000">`;
  if(kind==='panel') source='<panel title="Panel">\n\n'+Array.from({length:size},(_,i)=>`Internal paragraph ${i}, value ${i===size-1?token:i}.`).join('\n\n')+'\n\n</panel>';
  if(kind==='chart') source='<chart title="Values">\n| Item | Value |\n| --- | ---: |\n'+Array.from({length:size},(_,i)=>`| item ${i} | ${i===size-1?token:i+1} |`).join('\n')+'\n</chart>';
  if(kind==='plot') { prefix=slider;source=`<plot label="Curve">\n$$ y = n * x + ${token} $$\n</plot>`; }
  if(kind==='diagram') source='<diagram label="Flow">\n'+Array.from({length:size},(_,i)=>`<node id="node${i}" label="Step ${i}">\nDescription ${i===size-1?token:i}.\n</node>`).join('\n')+'\n'+Array.from({length:size-1},(_,i)=>`<edge from="node${i}" to="node${i+1}">`).join('\n')+'\n</diagram>';
  assert.ok(source,`Missing fixture ${kind}`);
  return {block:source.replace(token,String(1000+revision)),prefix};
}
function countNodes(nodes) { let count=0;const stack=[...nodes];while(stack.length){const n=stack.pop();count++;if(n.children)stack.push(...n.children);}return count; }
function normalized(input) {
  const result=structuredClone(input);if(!result.ok)return result;
  const doc=result.document,ids=new Map();
  const visit=nodes=>{for(const n of nodes){ids.set(n.id,`node-${ids.size}`);if(n.children)visit(n.children);}};
  visit(doc.nodes);
  for(const [name,c]of Object.entries(doc.computations??{}))ids.set(c.nodeId,`computed-${name}`);
  const id=value=>ids.get(value)??value,key=value=>value.startsWith('@')&&ids.has(value.slice(1))?'@'+id(value.slice(1)):value;
  const rewrite=nodes=>{for(const n of nodes){n.id=id(n.id);if(n.children)rewrite(n.children);}};rewrite(doc.nodes);
  doc.initialState=Object.fromEntries(Object.entries(doc.initialState).map(([k,v])=>[key(k),v]));
  doc.bindings=Object.fromEntries(Object.entries(doc.bindings).map(([k,b])=>[key(k),{...b,name:key(b.name),owner:b.owner?id(b.owner):b.owner,nodeIds:b.nodeIds.map(id)}]));
  for(const c of Object.values(doc.computations??{}))c.nodeId=id(c.nodeId);
  for(const v of doc.validations??[])v.nodeId=id(v.nodeId);
  if(doc.dependencies)doc.dependencies=Object.fromEntries(Object.entries(doc.dependencies).map(([k,v])=>[id(k),v?.map(key)??null]));
  if(doc.bindingSlots)doc.bindingSlots=Object.fromEntries(Object.entries(doc.bindingSlots).map(([k,v])=>[id(k),Object.fromEntries(Object.entries(v).map(([s,n])=>[s,key(n)]))]));
  if(doc.tableShapes)doc.tableShapes=Object.fromEntries(Object.entries(doc.tableShapes).map(([k,v])=>[id(k),{...v,rowIds:v.rowIds.map(r=>r.map(id))}]));
  return result;
}
const rounded=n=>Number(n.toFixed(4));
function summarize(values) { const sorted=[...values].sort((a,b)=>a-b);return {medianMs:rounded(sorted[Math.ceil(sorted.length*.5)-1]),p95Ms:rounded(sorted[Math.ceil(sorted.length*.95)-1]),minMs:rounded(sorted[0]),maxMs:rounded(sorted.at(-1)),samples:values.map(rounded)}; }

async function child(c,config) {
  const {compileLocal,createLocalCompileSession}=await import(config.module);
  const single=[];
  let isolatedNodes=0;
  for(let i=0;i<config.warmups+config.iterations;i++){
    const {block,prefix}=fixture(c,i),source=prefix?prefix+'\n\n'+block:block;
    const t=performance.now(),result=compileLocal(source),elapsed=performance.now()-t;
    assert.ok(result.ok,JSON.stringify(result.diagnostics));assert.equal(result.diagnostics.length,0);
    if(i>=config.warmups)single.push(elapsed);
    if(i===0)isolatedNodes=countNodes(result.document.nodes);
  }
  const background=Array.from({length:config.background},(_,i)=>`Background paragraph ${i}. Ordinary text for a stable compilation workload.`);
  const middle=Math.floor(background.length/2);
  const document=revision=>{const {block,prefix}=fixture(c,revision);return [...(prefix?[prefix]:[]),...background.slice(0,middle),block,...background.slice(middle)].join('\n\n');};
  const initialSource=document(0),session=createLocalCompileSession();
  const setupStart=performance.now(),initial=session.compile(initialSource),setupMs=performance.now()-setupStart;
  assert.ok(initial.ok,JSON.stringify(initial.diagnostics));assert.equal(initial.diagnostics.length,0);
  const longNodes=countNodes(initial.document.nodes),full=[],incremental=[],stats=[];
  for(let i=1;i<=config.warmups+config.iterations;i++){
    const source=document(i),timings={};
    let baseline,edited;
    for(const mode of i%2?['full','session']:['session','full']){
      const t=performance.now(),result=mode==='full'?compileLocal(source):session.compile(source);
      timings[mode]=performance.now()-t;
      assert.ok(result.ok,JSON.stringify(result.diagnostics));assert.equal(result.diagnostics.length,0);
      if(mode==='full')baseline=result;else edited=result;
    }
    assert.equal(countNodes(edited.document.nodes),countNodes(baseline.document.nodes));
    assert.equal(edited.document.source,baseline.document.source);
    if(i===config.warmups+config.iterations)assert.deepEqual(normalized(edited),normalized(baseline),'Final snapshot must match full compilation');
    if(i>config.warmups){full.push(timings.full);incremental.push(timings.session);stats.push(session.stats);}
  }
  const modes=Object.fromEntries(['full','incremental','cached'].map(mode=>[mode,stats.filter(s=>s.mode===mode).length]));
  const result={...c,blockCharacters:fixture(c,0).block.length,isolatedSourceCharacters:(fixture(c,0).prefix?fixture(c,0).prefix.length+2:0)+fixture(c,0).block.length,
    isolatedNodes,documentCharacters:initialSource.length,documentNodes:longNodes,initialSessionMs:rounded(setupMs),
    isolated:summarize(single),fullDocument:summarize(full),editSession:summarize(incremental),speedup:rounded(summarize(full).medianMs/summarize(incremental).medianMs),modes,lastStats:stats.at(-1),peakRssBytes:process.resourceUsage().maxRSS*1024};
  session.dispose();process.send(result);
}
async function isolatedCase(c,config){
  return new Promise(resolveCase=>{
    const processChild=fork(self,['--child',JSON.stringify(c),JSON.stringify(config)],{silent:true,execArgv:[]});
    let result,error='',timeout=false;
    processChild.stdout.resume();processChild.stderr.on('data',s=>{error=(error+s).slice(-5000);});
    processChild.on('message',message=>{result=message;});
    processChild.on('error',e=>{error+=e.message;});
    const timer=setTimeout(()=>{timeout=true;processChild.kill();},120000);
    processChild.on('close',(code,signal)=>{clearTimeout(timer);resolveCase({...c,...result,status:timeout?'timeout':code===0&&result?'completed':'failed',...(error?{error}:{}),exitCode:code,signal});});
  });
}
async function main(){
  const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
  const config={iterations:Number(option('--iterations','21')),warmups:Number(option('--warmups','3')),background:Number(option('--background','1000'))};
  for(const [key,value]of Object.entries(config))assert.ok(Number.isInteger(value)&&value>=(key==='warmups'?0:1),`Invalid ${key}`);
  config.module=args.includes('--module')?pathToFileURL(resolve(option('--module'))).href:'reactive-md';
  const filter=new RegExp(option('--case','.*')),output=resolve(option('--output','artifacts/benchmark-block-types.json'));
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const report={generatedAt:new Date().toISOString(),packageVersion:pkg.version,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:{node:process.version,cpu:cpus()[0]?.model,platform:platform(),arch:arch()},config,
    methodology:'Serial isolated Node processes per fixture, default V8 heap. Standalone compileLocal plus one target block in the middle of the same 1000 ordinary paragraph background (configurable). Numeric revision has fixed width; fence-delimiter fixture intentionally changes both fence lengths. Three warmups, 21 measured samples by default; long-document full and session calls alternate order. Timer excludes source generation/assertions and includes complete compile result assembly. Formula inspection included; React rendering, syntax highlighting, chart sampling and diagram layout excluded. Block sizes/node counts differ and are reported. P95 uses nearest rank. No cross-machine pass threshold.',results:[]};
  await mkdir(dirname(output),{recursive:true});
  for(const c of definitions.filter(c=>filter.test(c.id))){
    console.log(`START ${c.id}`);const result=await isolatedCase(c,config);report.results.push(result);
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({id:c.id,status:result.status,singleMs:result.isolated?.medianMs,fullMs:result.fullDocument?.medianMs,editMs:result.editSession?.medianMs,modes:result.modes,reused:result.lastStats?.reusedBlocks,error:result.error}));
  }
  if(report.results.some(r=>r.status!=='completed'))process.exitCode=1;
  console.log(`Report: ${output}`);
}
if(process.argv[2]==='--child')await child(JSON.parse(process.argv[3]),JSON.parse(process.argv[4]));
else if(process.argv[1]&&resolve(process.argv[1])===self)await main();
