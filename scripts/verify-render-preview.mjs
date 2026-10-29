import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import { replaceWorkbenchSource } from '../demo/scripts/workbench-ui.mjs';

const server=await preview({configFile:false,root:resolve('demo'),preview:{host:'127.0.0.1',port:0},build:{outDir:resolve('demo/dist')}});
const base=`http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.setDefaultTimeout(60000);
  // The Demo has no favicon asset; serve this optional browser request in the
  // fixture so the empty-error assertion covers application resources.
  await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
  await page.goto(base+'/?example=pricing');
  await page.locator('.editor-status-bar').getByRole('button',{name:'Split',exact:true}).click();
  // Keep this real-Playground fixture inside its default 10,000-node budget.
  const source='<slider bind="n" label="Render test" initial="2">\n\n'+Array.from({length:1500},(_,i)=>`Paragraph ${i}, value {{ n * 2 }}.`).join('\n\n');
  await replaceWorkbenchSource(page,source);
  await page.getByRole('slider',{name:'Render test',exact:true}).waitFor();
  const article=page.locator('.preview-stage .local-document');
  await page.waitForFunction(()=>document.querySelector('.preview-stage .local-document')?.textContent.includes('Paragraph 1499'));
  await page.getByRole('slider',{name:'Render test',exact:true}).fill('13');
  await page.evaluate(()=>{window.__previousArticle=document.querySelector('.preview-stage .local-document');window.__previousSlider=window.__previousArticle.querySelector('input[type=range]');});
  const next=source.replace('Paragraph 750','Edited paragraph 750');
  await replaceWorkbenchSource(page,next);
  await page.waitForFunction(()=>document.querySelector('.preview-stage .local-document')?.textContent.includes('Edited paragraph 750'));
  assert.equal(await page.getByRole('slider',{name:'Render test',exact:true}).inputValue(),'13');
  assert.ok(await page.evaluate(()=>document.querySelector('.preview-stage .local-document')===window.__previousArticle&&window.__previousArticle.querySelector('input[type=range]')===window.__previousSlider));
  assert.equal(await article.locator(':scope > p').count(),1500);
  assert.equal(await article.locator(':scope > p').nth(100).evaluate(el=>getComputedStyle(el).contentVisibility),'auto');
  const reference=page.locator('[data-binding-location=reference]').last();
  const range=await reference.evaluate(el=>({start:Number(el.getAttribute('data-start')),end:Number(el.getAttribute('data-end'))}));
  await reference.click();
  assert.equal(await page.locator('#source-editor').evaluate(el=>{const {start,end}=window.rmdEditorProbe.selection(el);return window.rmdEditorProbe.read(el).slice(start,end);}), 'n');
  const reset=next.replace('initial="2"','initial="3"');
  await replaceWorkbenchSource(page,reset);
  await page.waitForFunction(()=>document.querySelector('.preview-stage input[type=range]')?.value==='3');
  assert.deepEqual(errors,[]);
  await mkdir('artifacts/render-pipeline',{recursive:true});
  await page.screenshot({path:'artifacts/render-pipeline/demo.png'});
  const report={status:'PASS',browser:browser.version(),checks:['Actual production Playground with its native source editor','1500 dynamic paragraphs rendered within default node budget','Middle edit preserves article and control DOM','Parameter remains 13 after edit','Changed initial resets to 3','All paragraphs stay in DOM; later prose uses content-visibility:auto'],errors};
  await writeFile('artifacts/render-pipeline/demo-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done));}
