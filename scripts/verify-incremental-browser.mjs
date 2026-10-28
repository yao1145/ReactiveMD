import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './benchmark-compiler-stress.mjs';

const root=resolve('dist-library');
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Incremental worker verification</title>');return;}
  const path=resolve('.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??'msedge'});
  const page=await browser.newPage();await page.goto(base);
  const report=await page.evaluate(async({base,source})=>{
    const code=`import {startLocalCompileWorker} from '${base}dist-library/reactive-md.js';startLocalCompileWorker();postMessage({ready:true});`;
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    const worker=new Worker(url,{type:'module'});
    const receive=()=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Worker response timeout')),60000);
      worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};
      worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};
    });
    try{
      await receive();const samples=[];
      for(let i=0;i<11;i++){
        const pending=receive(),start=performance.now();worker.postMessage({id:i,source:source+String(i)});
        const response=await pending;
        if(!response.ok||!response.result.ok)throw new Error('Worker compilation failed');
        const roundTripMs=performance.now()-start;
        samples.push({workerMs:response.duration,roundTripMs,stats:response.incremental});
      }
      let pending=receive();worker.postMessage({id:20,source:source+'changed',options:{markdownBreaks:true}});
      const invalidated=await pending;
      return{samples,optionChange:invalidated.incremental};
    }finally{worker.terminate();URL.revokeObjectURL(url);}
  },{base,source:fixture('article',600).trimEnd()});
  assert.equal(report.samples[0].stats.mode,'full');
  assert.ok(report.samples.slice(1).every(s=>s.stats.mode==='incremental'&&s.stats.compiledBlocks===1&&s.stats.reusedBlocks===1799));
  assert.equal(report.optionChange.mode,'full');
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const samples=report.samples.slice(3);
  const result={generatedAt:new Date().toISOString(),browser:browser.version(),workerMedianMs:median(samples.map(s=>s.workerMs)),roundTripMedianMs:median(samples.map(s=>s.roundTripMs)),...report};
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/incremental-browser.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
