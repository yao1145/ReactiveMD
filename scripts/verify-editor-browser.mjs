import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
const server=await createServer({configFile:false,root:process.cwd(),appType:'mpa',server:{host:'127.0.0.1',port:0},optimizeDeps:{exclude:['reactive-md']}});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];page.setDefaultTimeout(20000);
 page.on('pageerror',error=>errors.push(error.message));
 const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name);};
 const source=id=>page.evaluate(id=>window.editorHarness.getValue(id),id);
 const install=async(id,text)=>{await page.evaluate(([id,text])=>window.editorHarness.setValue(id,text),[id,text]);await expect.poll(()=>source(id)).toBe(text);};
 const focus=(id,start,end=start)=>page.evaluate(([id,start,end])=>window.editorHarness.focusRange(id,start,end),[id,start,end]);
 const root=id=>page.locator('#host-'+id+' .reactive-md-editor');
 await page.goto(server.resolvedUrls.local[0]+'tests/browser/editor-fixture.html');
 await expect(page.locator('.cm-editor')).toHaveCount(2);
 await check('canonical package entry mounts two CM6 instances without legacy mirrors',async()=>{
   await expect(page.locator('.editor-shell textarea,.author-highlight,.editor-mirror,.editor-gutter')).toHaveCount(0);
   assert.notEqual(await source('a'),await source('b'));await expect(page.locator('.cm-gutters')).toHaveCount(2);
   await expect(root('a')).toHaveAttribute('data-editor-theme','light');
 });
 await check('native typing, history and controlled callbacks stay per instance',async()=>{
   const untouched=await source('b');await install('a','alpha beta');await focus('a',0);await page.keyboard.type('X');await expect.poll(()=>source('a')).toBe('Xalpha beta');
   await page.keyboard.press('Control+z');await expect.poll(()=>source('a')).toBe('alpha beta');
   await page.keyboard.press('Control+Shift+Z');await expect.poll(()=>source('a')).toBe('Xalpha beta');assert.equal(await source('b'),untouched);
 });
 await check('selection and toolbar edits are undoable without a textarea',async()=>{
   await install('a','alpha beta');await focus('a',0,5);await root('a').getByRole('button',{name:'Bold',exact:true}).click();
   await expect.poll(()=>source('a')).toBe('**alpha** beta');await page.evaluate(()=>window.editorHarness.undo('a'));await expect.poll(()=>source('a')).toBe('alpha beta');
   await focus('a',0);await page.keyboard.press('Escape');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#host-a .editor-toolbar')),true);
 });
 await check('external replacements and document keys reset history',async()=>{
   await install('a','replacement');await focus('a',11);await page.keyboard.type('!');await expect.poll(()=>source('a')).toBe('replacement!');
   await page.evaluate(()=>window.editorHarness.setDocumentKey('next'));await expect(root('a').locator('[data-toolbar-id="undo"]')).toBeDisabled();
   await page.evaluate(()=>window.editorHarness.undo('a'));assert.equal(await source('a'),'replacement!');
   await install('a','external');await page.evaluate(()=>window.editorHarness.undo('a'));assert.equal(await source('a'),'external');
 });
 await check('readonly and disabled protect native input and ref commands',async()=>{
   await page.evaluate(()=>window.editorHarness.setReadOnly(true,'a'));await expect(page.locator('#editor-a')).toHaveAttribute('contenteditable','false');
   await focus('a',0);await page.keyboard.type('blocked');assert.equal(await source('a'),'external');
   await page.evaluate(()=>window.editorHarness.setReadOnly(false,'a'));await page.evaluate(()=>window.editorHarness.setDisabled(true,'a'));
   await page.evaluate(()=>window.editorHarness.undo('a'));assert.equal(await source('a'),'external');await page.evaluate(()=>window.editorHarness.setDisabled(false,'a'));
 });
 await check('view switches preserve host preview inputs',async()=>{
   await page.evaluate(()=>window.editorHarness.setViewMode('split','a'));
   const slider=root('a').getByRole('slider',{name:'Preview amount a'});await slider.fill('7');
   await page.evaluate(()=>window.editorHarness.setViewMode('edit','a'));await page.evaluate(()=>window.editorHarness.setViewMode('preview','a'));await expect(slider).toHaveValue('7');
   await page.evaluate(()=>window.editorHarness.setViewMode('edit','a'));
 });
 await check('source DOM stays bounded when locating the end of a long document',async()=>{
   const text=Array.from({length:3000},(_,i)=>'Line '+i).join('\n');await install('a',text);await focus('a',text.length);
   await expect.poll(()=>page.evaluate(()=>window.editorHarness.getSelection('a'))).toEqual({start:text.length,end:text.length});
   assert.ok(await root('a').locator('.cm-line').count()<200);await page.keyboard.type('Z');await expect.poll(()=>source('a')).toBe(text+'Z');
 });
 await check('external component registers in the menu, localizes, inserts, undoes and removes',async()=>{
   await page.evaluate(()=>{window.editorHarness.setLocale('en','a');window.editorHarness.setExtension(true,'a');});
   await install('a','');await focus('a',0);
   const trigger=root('a').locator('[data-toolbar-id="components"]'),panel=root('a').locator('.editor-toolbar-native-menu');
   const item=()=>panel.locator('.editor-toolbar-native-item').filter({has:page.locator('.editor-toolbar-native-label',{hasText:/^Meter$/})});
   await trigger.click();await expect(panel).toBeVisible();await expect(item()).toHaveCount(1);
   await expect(item()).toHaveAttribute('aria-description',/Fixture external meter\./);
   await expect(item()).toHaveAttribute('aria-description',/Meter label/);
   await panel.getByRole('searchbox').fill('meter');await expect(item()).toHaveCount(1);
   await focus('a',0);await item().click();
   await expect.poll(()=>source('a')).toContain('<ext-meter bind="meter"');
   await page.evaluate(()=>window.editorHarness.undo('a'));await expect.poll(()=>source('a')).toBe('');
   await page.evaluate(()=>window.editorHarness.redo('a'));await expect.poll(()=>source('a')).toContain('<ext-meter bind="meter"');
   await page.evaluate(()=>window.editorHarness.setLocale('zh','a'));
   await trigger.click();await panel.getByRole('searchbox').fill('仪表');
   const localized=()=>panel.locator('.editor-toolbar-native-item').filter({has:page.locator('.editor-toolbar-native-label',{hasText:/^仪表$/})});
   await expect(localized()).toHaveCount(1);
   await expect(localized()).toHaveAttribute('aria-description',/测试外部仪表。/);
   await expect(localized()).toHaveAttribute('aria-description',/仪表标签/);
   await page.keyboard.press('Escape');
   await page.evaluate(()=>window.editorHarness.setExtension(false,'a'));
   await trigger.click();await panel.getByRole('searchbox').fill('仪表');
   await expect(panel.locator('.editor-toolbar-native-item')).toHaveCount(0);
   await expect(panel.locator('.editor-toolbar-menu-empty')).toHaveText('没有匹配的组件');
   await page.keyboard.press('Escape');
   await page.evaluate(()=>window.editorHarness.setLocale('en','a'));
 });
 await check('locale, themes, exports and narrow layout remain scoped',async()=>{
   await page.evaluate(()=>{window.editorHarness.setLocale('zh','a');window.editorHarness.setTheme('dark','a');});
   await expect(root('a')).toHaveAttribute('data-editor-theme','dark');await expect(root('b')).toHaveAttribute('data-editor-theme','light');
   await root('a').getByRole('button',{name:/下载文档|导出文档/}).click();assert.equal(await page.evaluate(()=>window.editorHarness.exports()),1);
   await page.setViewportSize({width:375,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 });
 assert.deepEqual(errors,[]);console.log('PASS '+checks.length+' canonical CM6 browser checks');
}finally{await browser?.close();await server.close();}
