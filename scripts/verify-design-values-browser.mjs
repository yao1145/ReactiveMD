import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const output='artifacts/design-values-fixes';
await mkdir(output,{recursive:true});
const server=await createServer({configFile:false,optimizeDeps:{entries:['tests/browser/design-values-fixture.html']},server:{host:'127.0.0.1',port:0},appType:'mpa'});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${server.resolvedUrls.local[0]}tests/browser/design-values-fixture.html`);
 const baseline=page.locator('#baseline article'),custom=page.locator('#custom article');
 await expect(baseline).toBeVisible();
 const button=baseline.getByRole('button',{name:'检查答案',exact:true});await expect(button).toBeVisible();
 const paint=await button.evaluate(node=>{
  const css=getComputedStyle(node),rules=[];
  const walk=(list,layer='')=>{for(const rule of list){
   if(rule.selectorText&&rule.style?.color){try{if(node.matches(rule.selectorText))rules.push({selector:rule.selectorText,color:rule.style.color,layer});}catch{}}
   if(rule.cssRules)walk(rule.cssRules,rule.name??layer);
  }};for(const sheet of document.styleSheets)walk(sheet.cssRules);
  return {color:css.color,background:css.backgroundColor,accentInk:css.getPropertyValue('--accent-ink').trim(),rules};
 });
 await writeFile(`${output}/quiz-paint.json`,JSON.stringify(paint,null,2));
 await button.screenshot({path:`${output}/quiz-light.png`});
 await expect(button).toHaveCSS('color','rgb(255, 255, 255)');
 console.log('PASS light quiz primary foreground uses accent ink');
 const snapshots={};
 for(const scheme of ['light','dark']){
  await page.evaluate(mode=>window.designValuesHarness.scheme(mode),scheme);
  await expect(baseline).toHaveAttribute('data-color-scheme',scheme);
  snapshots[scheme]=await baseline.evaluate(root=>{
   const selectors=['.local-coordinate-surface','.rmd-chart-swatch','.rmd-diagram-zoom','.rmd-diagram-zoom button','.rmd-diagram-stage','.local-choice-list'];
   const props=['background-color','color','border-radius','box-shadow','filter'];
   const result=Object.fromEntries(selectors.map(s=>{const node=root.querySelector(s);const css=getComputedStyle(node);return[s,Object.fromEntries(props.map(p=>[p,css.getPropertyValue(p)]))];}));
   result.choiceThumb=getComputedStyle(root.querySelector('.local-choice-list'),'::before').boxShadow;
   return result;
  });
  for(const [label,root] of [['baseline',baseline],['custom',custom]]){
   const trigger=root.locator('.local-tooltip-trigger');await trigger.focus();
   const tooltip=root.locator('.local-tooltip-bubble');await expect(tooltip).toBeVisible();
   const tooltipPaint=await tooltip.evaluate(n=>({background:getComputedStyle(n).backgroundColor,ink:getComputedStyle(n).color}));
   if(label==='baseline')snapshots[scheme].tooltip=tooltipPaint;
   else if(!process.argv.includes('--record-baseline')){
    await expect(tooltip).toHaveCSS('background-color','rgb(30, 70, 100)');
    await expect(tooltip).toHaveCSS('color','rgb(250, 240, 210)');
   }
   await page.keyboard.press('Escape');await trigger.blur();
   const node=root.locator('[data-diagram-node]').first();await node.focus();
   const inspector=root.locator('.rmd-diagram-tooltip');await expect(inspector).toBeVisible();
   const nodePaint=await inspector.evaluate(n=>({shadow:getComputedStyle(n).boxShadow,radius:getComputedStyle(n).borderRadius}));
   if(label==='baseline'){
    snapshots[scheme].inspector=nodePaint;
    snapshots[scheme].activeNodeFilter=await node.locator('rect').evaluate(n=>getComputedStyle(n).filter);
   }
   else if(!process.argv.includes('--record-baseline')){
    await expect(inspector).toHaveCSS('box-shadow','rgba(80, 30, 90, 0.4) 0px 7px 19px 0px');
    await expect(root.locator('.local-coordinate-surface')).toHaveCSS('border-radius','26px');
    await expect(root.locator('.rmd-chart-swatch').first()).toHaveCSS('border-radius','5px');
    await expect(root.locator('.rmd-diagram-zoom')).toHaveCSS('border-radius','11px');
    await expect(inspector.locator('button')).toHaveCSS('border-radius','7px');
    const choiceShadow=await root.locator('.local-choice-list').evaluate(n=>getComputedStyle(n,'::before').boxShadow);
    assert.equal(choiceShadow,'rgba(100, 40, 120, 0.5) 0px 3px 5px 0px');
   }
   await page.keyboard.press('Escape');await node.blur();
   const idleFilter=await node.locator('rect').evaluate(n=>getComputedStyle(n).filter);
   if(label==='baseline')snapshots[scheme].nodeFilter=idleFilter;
   else if(!process.argv.includes('--record-baseline'))assert.equal(idleFilter,'drop-shadow(rgba(30, 100, 150, 0.6) 0px 4px 6px)');
   await root.evaluate(n=>{const d=document.createElement('dialog');d.className='design-dialog';d.textContent='Dialog';n.append(d);d.showModal();});
   const backdrop=await root.locator('.design-dialog').evaluate(n=>getComputedStyle(n,'::backdrop').backgroundColor);
   if(label==='baseline')snapshots[scheme].backdrop=backdrop;
   else if(!process.argv.includes('--record-baseline'))assert.equal(backdrop,'rgba(20, 60, 90, 0.7)');
   await root.locator('.design-dialog').evaluate(n=>{n.close();n.remove();});
   if(label==='custom'&&!process.argv.includes('--record-baseline')){
    await root.evaluate(n=>{const d=document.createElement('dialog');d.className='md-image-zoom';d.textContent='Image';n.append(d);d.showModal();});
    const imageBackdrop=await root.locator('.md-image-zoom').evaluate(n=>getComputedStyle(n,'::backdrop').backgroundColor);
    assert.equal(imageBackdrop,'rgba(70, 20, 90, 0.8)');
    await root.locator('.md-image-zoom').evaluate(n=>{n.close();n.remove();});
   }
  }
 }
 if(process.argv.includes('--record-baseline'))await writeFile(`${output}/default-before.json`,JSON.stringify(snapshots,null,2));
 else {
  let reference;
  try{reference=JSON.parse(await readFile(`${output}/default-before.json`,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(reference){assert.deepEqual(snapshots,reference,'Token extraction changed the default paint');console.log('PASS captured light/dark default paint is unchanged');}
  const touch=await browser.newPage({viewport:{width:375,height:900},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await touch.goto(`${server.resolvedUrls.local[0]}tests/browser/design-values-fixture.html`);
  const pressed=touch.locator('#custom').getByRole('button',{name:'检查答案',exact:true});
  await pressed.scrollIntoViewIfNeeded();const box=await pressed.boundingBox();assert.ok(box);
  await touch.mouse.move(box.x+box.width/2,box.y+box.height/2);await touch.mouse.down();
  await expect(pressed).toHaveCSS('box-shadow','rgba(40, 90, 120, 0.5) 0px 3px 4px 0px inset');
  await touch.mouse.up();await touch.close();
  console.log('PASS light/dark overlay, shadow, radius overrides and touch pressed shadow');
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();await server.close();}
