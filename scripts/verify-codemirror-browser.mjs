import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep,extname} from 'node:path';
import {build} from 'vite';
import {reactiveMd} from 'reactive-md/vite';
import {chromium,expect} from '@playwright/test';

const root=resolve('artifacts/cm6'),dist=resolve(root,'browser-dist');
await mkdir(root,{recursive:true});
await build({configFile:false,base:'./',logLevel:'error',plugins:[reactiveMd({extensions:'./demo/extensions.ts'})],worker:{format:'es'},build:{outDir:dist,rollupOptions:{input:resolve('tests/browser/codemirror-fixture.html')}}});
const server=createServer(async(req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  const path=resolve(dist,'.'+pathname);
  if(!path.startsWith(dist+sep)){res.writeHead(404).end();return;}
  const candidates=pathname==='/demo'?[resolve('demo/dist/index.html')]:[path];
  if(pathname.startsWith('/assets/'))candidates.push(resolve('demo/dist','.'+pathname));
  for(const candidate of candidates)try{const data=await readFile(candidate);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(candidate)]??'application/octet-stream');res.end(data);return;}catch{}
  res.writeHead(404).end();
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const url=`http://127.0.0.1:${server.address().port}/tests/browser/codemirror-fixture.html`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true});
const errors=[],checks=[],performanceResults=[],memoryResults=[];
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name);};
const source=()=>page.evaluate(()=>window.cmProbe.source());
const install=async value=>{await page.evaluate(value=>window.cmProbe.install(value),value);await expect.poll(source).toBe(value);};
const focus=async(start,end=start)=>page.evaluate(([a,b])=>window.cmProbe.focus(a,b),[start,end]);
async function waitPreview(target){await page.waitForFunction(target=>window.cmProbe.previewSource===target,target,{timeout:60000});}
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{median:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],samples:values};};
try{
  await page.goto(url);await page.waitForFunction(()=>window.cmProbe?.ready);await expect(page.locator('.cm-editor')).toHaveCount(1);
  await check('native editing and controlled acknowledgements preserve the EditorView',async()=>{
    await focus(0);await page.evaluate(()=>window.originalEditor=document.querySelector('.cm-editor'));
    await page.keyboard.type('X');await expect.poll(source).toBe('XReady');
    assert.equal(await page.evaluate(()=>window.originalEditor===document.querySelector('.cm-editor')),true);
    await page.keyboard.press('Control+z');await expect.poll(source).toBe('Ready');
    await page.keyboard.press('Control+Shift+Z');await expect.poll(source).toBe('XReady');
  });
  await check('UTF16, mixed CRLF and CR, BOM and emoji round trip through native input and history',async()=>{
    const raw='\ufeff😀\r\nalpha\r\nend\rtail';await install(raw);await focus(5,10);await page.keyboard.insertText('中文');
    await expect.poll(source).toBe('\ufeff😀\r\n中文\r\nend\rtail');
    const edit=await page.evaluate(()=>window.cmProbe.transactions.at(-1).changes[0]);assert.deepEqual(edit,{from:5,to:10,insert:'中文'});
    await page.keyboard.press('Control+z');await expect.poll(source).toBe(raw);
    await page.keyboard.press('Control+Shift+Z');await expect.poll(source).toBe('\ufeff😀\r\n中文\r\nend\rtail');
    await focus(7);await page.keyboard.press('Enter');await expect.poll(source).toBe('\ufeff😀\r\n中文\r\n\r\nend\rtail');
    await install(raw);await focus(10,raw.length);await page.keyboard.insertText('K');await page.keyboard.press('Control+z');await expect.poll(source).toBe(raw);
    await page.keyboard.press('Control+Shift+Z');await expect.poll(source).toBe(raw.slice(0,10)+'K');
    await install('a\r\nb');await focus(1,3);await page.evaluate(()=>window.cmProbe.insert('\n'));await expect.poll(source).toBe('a\nb');
    await page.evaluate(()=>window.cmProbe.undo());await expect.poll(source).toBe('a\r\nb');
  });
  await check('toolbar edits are single history entries; host replacement and document keys reset history',async()=>{
    await install('word');await focus(0,4);await page.getByRole('button',{name:'Bold',exact:true}).click();
    await expect.poll(source).toBe('**word**');await page.evaluate(()=>window.cmProbe.undo());await expect.poll(source).toBe('word');
    await page.evaluate(()=>window.cmProbe.insert('fresh'));await page.evaluate(()=>window.cmProbe.reset('next-document'));
    await page.waitForFunction(()=>window.cmProbe.key()==='next-document');
    const before=await source();await page.evaluate(()=>window.cmProbe.undo());assert.equal(await source(),before);
    await install('replacement');await page.evaluate(()=>window.cmProbe.undo());assert.equal(await source(),'replacement');
    await focus(0);await page.keyboard.press('Escape');await page.keyboard.press('Tab');await expect(page.locator('.editor-toolbar')).toContainText('Body');
    assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.editor-toolbar')),true);
  });
  await check('native document replacement followed by mixed-ending host insertion retains redo',async()=>{
    await install('# Old\r\n\r\nBody');await focus(0,(await source()).length);
    await page.keyboard.insertText('# New\n\nBefore AFTER');
    const before=await source();await focus(before.indexOf('AFTER'),before.length);
    await page.evaluate(()=>window.cmProbe.insert('\n\n![Image](image.png)\n\n'));
    const inserted=await source();await page.keyboard.press('Control+z');await expect.poll(source).toBe(before);
    await page.keyboard.press('Control+Shift+Z');
    await expect.poll(source).toBe(inserted);
  });
  await check('delayed host echoes do not roll back later local transactions',async()=>{
    await install('');await page.evaluate(()=>window.cmProbe.defer(true));await focus(0);await page.keyboard.type('ab');await expect.poll(source).toBe('ab');
    await page.evaluate(()=>window.cmProbe.ack());await page.waitForFunction(()=>window.cmProbe.hostSource==='a');await expect.poll(source).toBe('ab');
    await page.evaluate(()=>window.cmProbe.ack());await page.waitForFunction(()=>window.cmProbe.hostSource==='ab');await expect.poll(source).toBe('ab');
    await page.evaluate(()=>window.cmProbe.defer(false));
  });
  await check('composition events keep Chinese text and undo; readonly and disabled reject edits',async()=>{
    await install('');await focus(0);
    await page.locator('#source-editor').dispatchEvent('compositionstart',{data:''});
    await page.keyboard.insertText('中文输入');await page.locator('#source-editor').dispatchEvent('compositionend',{data:'中文输入'});
    await expect.poll(source).toBe('中文输入');await page.evaluate(()=>window.cmProbe.undo());await expect.poll(source).toBe('');
    await install('locked');await page.evaluate(()=>window.cmProbe.lock(true));await page.evaluate(()=>window.cmProbe.insert('no'));assert.equal(await source(),'locked');
    await expect(page.locator('#source-editor')).toHaveAttribute('contenteditable','false');await page.evaluate(()=>window.cmProbe.lock(false));
    await page.evaluate(()=>window.cmProbe.lock(true));await install('locked replacement');await expect(page.locator('#source-editor')).toHaveAttribute('contenteditable','false');await page.evaluate(()=>window.cmProbe.lock(false));await install('locked');
    await page.evaluate(()=>window.cmProbe.disable(true));await page.evaluate(()=>window.cmProbe.insert('no'));assert.equal(await source(),'locked');await page.evaluate(()=>window.cmProbe.disable(false));
    await page.evaluate(()=>window.cmProbe.toolbar(false));await expect(page.locator('.editor-toolbar')).toHaveCount(0);
    await focus(0);await page.keyboard.press('Escape');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.cm-content')),false);
    await page.evaluate(()=>window.cmProbe.toolbar(true));
  });
  await check('author analysis shares the preview worker and reference pages retain original offsets',async()=>{
    const text='<number bind="n" label="N" initial="2">\n\n'+Array.from({length:130},(_,i)=>`Reference ${i}: {{ n }}`).join('\n\n');
    await install(text);await waitPreview(text);await expect(page.locator('[data-binding-name="n"]')).toBeVisible();
    await expect(page.locator('[data-binding-location]')).toHaveCount(50);assert.equal(await page.evaluate(()=>window.cmProbe.workers),1);
    await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('[data-binding-location="reference"]').first()).toHaveAttribute('data-start',String(text.indexOf('{{ n }}',text.indexOf('Reference 49:'))+3));
    const location=page.locator('[data-binding-location="reference"]').last(),start=Number(await location.getAttribute('data-start'));
    await location.click();assert.equal((await page.evaluate(()=>window.cmProbe.selection())).start,start);
  });
  await check('preview mode keeps live input state, anchors, findable DOM and print content',async()=>{
    const text='<number bind="n" label="N" initial="2">\n\n# Heading\n\n{{ n }}\n\n[Jump](#heading)\n\nSearchable content';
    await install(text);await waitPreview(text);const input=page.locator('.editor-preview input[inputmode="decimal"]');await input.fill('13');await input.press('Tab');
    await page.evaluate(()=>window.cmProbe.view('edit'));await page.evaluate(()=>window.cmProbe.view('split'));await expect(input).toHaveValue('13');
    await page.evaluate(()=>window.cmProbe.view('preview'));await expect(page.locator('.editor-preview').getByText('Searchable content')).toBeVisible();
    await page.locator('.editor-preview a').click();await expect(page.locator('.editor-preview h1')).toHaveAttribute('id',/heading/);
    const textContent=await page.locator('.editor-preview').textContent();assert.ok(textContent.includes('Searchable content'));
    await page.emulateMedia({media:'print'});assert.ok((await page.locator('.editor-preview').textContent()).includes('Searchable content'));await page.emulateMedia({media:'screen'});
    await page.evaluate(()=>window.cmProbe.view('split'));
  });
  await check('giant static and dynamic list/table edits retain unaffected preview DOM and live state',async()=>{
    for(const kind of ['list','table','dynamic-list','dynamic-table']){
      const table=kind.endsWith('table'),dynamic=kind.startsWith('dynamic-'),count=table?500:1000;
      const prefix='<number bind="n" label="Row state" initial="2">\n\n';
      const body=table?'| Name | Value |\n| --- | --- |\n'+Array.from({length:count},(_,i)=>`| Row ${i} | ${dynamic?'{{ n * 1000 }}':'1000'} |`).join('\n')
        :Array.from({length:count},(_,i)=>`- Row ${i} value ${dynamic?'{{ n * 1000 }}':'1000'}`).join('\n');
      const initial=prefix+'Before\n\n'+body+'\n\nAfter';await install(initial);await waitPreview(initial);
      const input=page.getByRole('textbox',{name:'Row state',exact:true});await input.fill('13');await input.press('Tab');
      const selector=table?'.editor-preview tbody tr':'.editor-preview li';
      await page.locator(selector).nth(10).evaluate(element=>window.keptPreviewRow=element);
      const at=initial.indexOf(`Row ${Math.floor(count/2)}`),value=initial.indexOf('1000',at);
      const edited=initial.slice(0,value)+'1001'+initial.slice(value+4);
      await install(edited);await waitPreview(edited);await expect(input).toHaveValue('13');
      await expect(page.locator(selector).nth(Math.floor(count/2))).toContainText(dynamic?'13013':'1001');
      assert.ok(await page.locator(selector).nth(10).evaluate(element=>element===window.keptPreviewRow),kind);
      assert.equal(await page.evaluate(()=>window.cmProbe.responses.at(-1).patch),true,kind);
    }
  });
  await check('metadata and native HTML use the original light/dark palette, including nested attribute expressions',async()=>{
    const text=[
      '<theme name="default">',
      ...['content','visual','interaction','testing'].map(name=>`<number bind="${name}" label="${name}" initial="10">`),
      '<const name="budgets" value="{{ [150, 200, 220, 120] }}">',
      '<computed name="expenses" value="{{ [content, visual, interaction, testing] }}">',
      '<computed name="budget" value="{{ sum(budgets) }}">',
      '<computed name="total" value="{{ sum(expenses) }}">',
      '<computed name="remaining" value="{{ budget - total }}">','',
      '<div align="center"># 一份预算，多种观察方式</div>','',
      '{{ remaining }}',
    ].join('\n');
    await install(text);await waitPreview(text);await expect(page.locator('.cm-content .author-token-tag').filter({hasText:/^const$/})).toHaveCount(1);
    const inspect=()=>page.evaluate(()=>{
      const root=document.querySelector('.reactive-md-editor'),tokens=document.querySelector('.cm-content');
      return [['tag','const','--code-tag'],['tag','computed','--code-tag'],['tag','div','--code-tag'],['attribute','align','--code-attribute'],
        ['string','center','--code-string'],['binding','budgets','--code-binding'],['expression','{{ sum(budgets) }}','--code-expression']].map(([kind,text,variable])=>{
        const element=[...tokens.querySelectorAll('.author-token-'+kind)].find(element=>element.textContent===text);
        if(!element)return{kind,text,missing:true};
        const sample=document.createElement('span');sample.style.color=`var(${variable})`;root.append(sample);const expected=getComputedStyle(sample).color;sample.remove();
        const colors=[],walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;
        while(node=walker.nextNode())if(node.textContent)colors.push(getComputedStyle(node.parentElement).color);
        return{kind,text,expected,colors};
      });
    });
    for(const theme of ['light','dark','auto']){
      if(theme==='auto')await page.emulateMedia({colorScheme:'dark'});
      await page.evaluate(theme=>window.cmProbe.theme(theme),theme);await expect(page.locator('.reactive-md-editor')).toHaveAttribute('data-editor-theme',theme);
      for(const token of await inspect()){assert.ok(!token.missing,JSON.stringify(token));assert.ok(token.colors.every(color=>color===token.expected),JSON.stringify(token));}
      await page.screenshot({path:resolve(root,`highlight-${theme}.png`),fullPage:false});
    }
    // An unresolved name during editing must preserve syntax colours elsewhere.
    await install(text.replace('sum(expenses)','sum(missing)'));
    await expect.poll(async()=> (await page.locator('.cm-content .author-token-expression').allTextContents()).join('')).toContain('sum(missing)');
    await page.evaluate(()=>window.cmProbe.theme('light'));await page.emulateMedia({colorScheme:'light'});
  });
  await check('private analysis worker, StrictMode cleanup and remount',async()=>{
    await page.goto(url+'?private&strict');await page.waitForFunction(()=>window.cmProbe?.ready);
    const text='<number bind="n" label="N">\n\n{{ n }}';await install(text);await expect(page.locator('[data-binding-name="n"]')).toBeVisible();
    await page.evaluate(()=>window.cmProbe.mount(false));await expect(page.locator('.cm-editor')).toHaveCount(0);
    await page.evaluate(()=>window.cmProbe.mount(true));await expect(page.locator('.cm-editor')).toHaveCount(1);assert.equal(await source(),text);
  });
  await check('soft wrap, long line, search, locale, theme and narrow layout',async()=>{
    await page.goto(url);await page.waitForFunction(()=>window.cmProbe?.ready);
    const line='Long text 😀 '.repeat(10000);await install(line);await focus(line.length);await page.keyboard.type('Z');await expect.poll(source).toBe(line+'Z');
    await page.keyboard.press('Control+f');await expect(page.locator('.cm-search')).toBeVisible();await page.keyboard.press('Escape');
    await page.evaluate(()=>{window.cmProbe.locale('zh');window.cmProbe.theme('dark');});await expect(page.locator('#source-editor')).toHaveAttribute('lang','zh-CN');
    await page.setViewportSize({width:390,height:844});await expect(page.locator('.editor-workspace')).toHaveAttribute('data-view','edit');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000});
  });
  if(process.argv.includes('--demo'))await check('production Demo only uses CM6 and compiles native edits',async()=>{
    await page.goto(new URL('/demo?editor=textarea',url).href);await expect(page.locator('.cm-editor')).toHaveCount(1,{timeout:60000});
    await expect(page.locator('textarea#source-editor')).toHaveCount(0);
    await page.goto(new URL('/demo',url).href);await expect(page.locator('.cm-editor')).toHaveCount(1,{timeout:60000});
    await page.locator('[data-editor-view-option="split"]').click();await expect(page.locator('#source-editor')).toBeVisible();
    await page.locator('#source-editor').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n\nCM6-check');
    await expect(page.locator('.preview-stage')).toContainText('CM6-check',{timeout:60000});
    await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
      canvas.getContext('2d').fillRect(0,0,2,2);
      const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'cm6-paste.png',{type:'image/png'}));
      document.querySelector('#source-editor').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    });
    await expect(page.locator('.cm-content')).toContainText('cm6-paste',{timeout:20000});
  });
  if(!process.argv.includes('--skip-performance'))for(const engine of ['cm6'])for(const kind of ['paragraphs800','paragraphs2400','table1000']){
    await page.goto(url+'?engine='+engine);await page.waitForFunction(()=>window.cmProbe?.ready);
    const count=Number(kind.match(/\d+/)[0]);
    const body=kind.startsWith('table')?'|Name|Value|\n|-|-|\n'+Array.from({length:count},(_,i)=>`|Row ${i}|{{ n }}|`).join('\n')
      :Array.from({length:count},(_,i)=>`Paragraph ${i} with **bold** and _emphasis_, {{ n }}. `+'Wrapping content. '.repeat(4)).join('\n\n');
    const text='<number bind="n" label="N" initial="2">\n\n'+body;await install(text);await waitPreview(text);await focus(text.indexOf(`${kind.startsWith('table')?'Row':'Paragraph'} ${Math.floor(count/2)}`)+4);
    await page.evaluate(()=>window.cmProbe.events=[]);
    const cdp=await page.context().newCDPSession(page),trace=[];
    cdp.on('Tracing.dataCollected',data=>trace.push(...data.value));
    for(let i=0;i<18;i++){
      if(i===3)await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline',options:'record-as-much-as-possible'});
      await page.keyboard.type('x');await page.waitForFunction(()=>window.cmProbe.events.filter(e=>e.name==='input-frame').length>0);
      await page.waitForFunction(()=>window.cmProbe.previewSource===window.cmProbe.source(),undefined,{timeout:60000});}
    const finished=new Promise(done=>cdp.once('Tracing.tracingComplete',done));await cdp.send('Tracing.end');await finished;await cdp.detach();
    const mainThread=trace.find(event=>event.name==='thread_name'&&event.args?.name==='CrRendererMain');
    const intervals=trace.filter(event=>event.ph==='X'&&event.pid===mainThread?.pid&&event.tid===mainThread?.tid);
    const sum=name=>intervals.filter(event=>event.name===name).reduce((sum,event)=>sum+(event.dur??0)/1000,0);
    const result=await page.evaluate(()=>({frames:window.cmProbe.events.filter(e=>e.name==='input-frame').map(e=>e.duration),dom:document.querySelector('.editor-shell').querySelectorAll('*').length,
      lines:document.querySelectorAll('.cm-line').length,totalLines:window.cmProbe.source().split('\n').length,workers:window.cmProbe.workers,responses:window.cmProbe.responses.slice(-15)}));
    const row={engine,kind,sourceLength:text.length,sourceDOM:result.dom,renderedLines:result.lines,totalLines:result.totalLines,inputFrameMs:stats(result.frames.slice(3)),workers:result.workers,worker:result.responses,
      trace:{layoutMs:sum('Layout'),styleMs:sum('UpdateLayoutTree'),paintMs:sum('Paint'),longTasks:intervals.filter(event=>event.name==='RunTask'&&event.dur>=50000).map(event=>event.dur/1000)}};
    performanceResults.push(row);console.log('MEASURE '+JSON.stringify({engine,kind,sourceDOM:row.sourceDOM,inputFrameMs:row.inputFrameMs}));
  }
  if(process.argv.includes('--memory')){
    const edits=Number(process.argv.find(arg=>arg.startsWith('--edits='))?.split('=')[1]??500);
    assert.ok(Number.isSafeInteger(edits)&&edits>=50&&edits<=10000);
    await page.goto(url);await page.waitForFunction(()=>window.cmProbe?.ready);
    const text=Array.from({length:800},(_,i)=>`Paragraph ${i}. `+'Continuous editing. '.repeat(6)).join('\n\n');await install(text);await waitPreview(text);await focus(text.length);
    const cdp=await page.context().newCDPSession(page);
    const collect=async label=>{
      await page.evaluate(()=>{for(const key of ['events','transactions','commits','responses'])window.cmProbe[key]=[];});
      await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');
      memoryResults.push({label,usedMiB:heap.usedSize/1024/1024,sourceDOM:await page.locator('.editor-shell *').count()});
    };
    for(let i=1;i<=edits;i++){await page.keyboard.type('x');if(i===50||i===edits){await expect.poll(source).toBe(text+'x'.repeat(i));await waitPreview(await source());await collect('edit-'+i);}}
    await page.evaluate(()=>window.cmProbe.mount(false));await expect(page.locator('.cm-editor')).toHaveCount(0);await collect('editor-unmounted-host-retained');
    await cdp.detach();console.log('MEMORY '+JSON.stringify(memoryResults));
    await page.evaluate(()=>window.cmProbe.mount(true));await expect(page.locator('.cm-editor')).toHaveCount(1);
  }
  assert.deepEqual(errors,[]);await page.screenshot({path:resolve(root,'browser.png'),fullPage:false});
}catch(error){await writeFile(resolve(root,'error-evidence.json'),JSON.stringify(await page.evaluate(()=>window.cmProbe?.errors),null,2)).catch(()=>{});await page.screenshot({path:resolve(root,'failure.png'),fullPage:false}).catch(()=>{});throw error;}
finally{
  const report=JSON.stringify({checks,errors,performance:performanceResults,memory:memoryResults,notes:['Input-frame is keydown to a requestAnimationFrame opportunity, not completed paint.','18 edits per scene, first 3 omitted; P95 from 15 samples is exploratory.','IME uses synthetic composition events plus native text insertion; physical OS IME remains manual.','Memory is the main renderer heap; host compilation state remains mounted. Probe arrays are cleared before GC.']},null,2);
  await writeFile(resolve(root,process.argv.includes('--memory')?'memory-results.json':process.argv.includes('--skip-performance')?'correctness-results.json':'browser-results.json'),report);
  if(performanceResults.length&&process.argv.includes('--memory'))await writeFile(resolve(root,'browser-results.json'),report);
  await browser.close();await new Promise(done=>server.close(done));
}
