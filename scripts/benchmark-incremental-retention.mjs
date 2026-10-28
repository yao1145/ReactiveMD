import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLocalCompileSession } from 'reactive-md';
import { fixture } from './benchmark-compiler-stress.mjs';
assert.ok(global.gc,'Run with --expose-gc');
const session=createLocalCompileSession(),source=fixture('paragraphs',5000).trimEnd();
const snapshot=()=>{global.gc();return process.memoryUsage();};
const before=snapshot(),checkpoints=[];
let result;
for(let i=0;i<200;i++){
  result=session.compile(source+String(i));assert.ok(result.ok);
  if(i>0)assert.equal(session.stats.compiledBlocks,1);
  if((i+1)%20===0)checkpoints.push({iteration:i+1,...snapshot()});
}
result=null;const retained=snapshot();session.dispose();const disposed=snapshot();
const report={generatedAt:new Date().toISOString(),iterations:200,before,checkpoints,retained,disposed};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/incremental-retention.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
