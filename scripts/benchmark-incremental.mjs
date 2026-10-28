import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { compileLocal, createLocalCompileSession } from 'reactive-md';
import { fixture } from './benchmark-compiler-stress.mjs';

const iterations = 15;
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const results = [];
for (const [kind,size,options] of [['paragraphs',5000],['formatted-paragraphs',1000],['article',600],['article',2000,{limits:{maxSyntaxNodes:50000}}]]) {
  const source = fixture(kind,size).trimEnd();
  const session = createLocalCompileSession();
  const start = performance.now();
  assert.ok(session.compile(source,options).ok);
  const initialSessionMs = performance.now()-start;
  const full = [], incremental = [], stats = [];
  for (let i=0;i<iterations+3;i++) {
    const next = source + String(i);
    const timings = {};
    for (const mode of i%2 ? ['incremental','full'] : ['full','incremental']) {
      const t=performance.now();
      const result=mode==='full' ? compileLocal(next,options) : session.compile(next,options);
      timings[mode]=performance.now()-t;
      assert.ok(result.ok, JSON.stringify(result.diagnostics));
    }
    assert.equal(session.stats.mode,'incremental');
    assert.ok(session.stats.compiledBlocks<=2,JSON.stringify(session.stats));
    if(i>=3){ full.push(timings.full);incremental.push(timings.incremental);stats.push(session.stats); }
  }
  const result={kind,size,sourceCharacters:source.length,options,initialSessionMs,iterations,fullMedianMs:median(full),incrementalMedianMs:median(incremental),speedup:median(full)/median(incremental),fullSamples:full,incrementalSamples:incremental,lastStats:stats.at(-1)};
  results.push(result);console.log(JSON.stringify(result));session.dispose();
}
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/benchmark-incremental.json',JSON.stringify({generatedAt:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,methodology:'Same production build, one session per case. Appends a changing revision to the last block. Three warmups and fifteen paired measurements in alternating order; default Node heap. Full snapshot assembly is included. Browser rendering and Worker transport excluded.',results},null,2));
