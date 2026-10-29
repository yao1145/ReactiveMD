import { openWorkbench, clickWorkbenchAction, replaceWorkbenchSource } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const checks = [], errors = [];
await mkdir('artifacts', { recursive: true });
async function check(name, run) { await run(); checks.push(name); console.log('PASS '+name); }
try {
  for (const language of ['en','zh']) {
    const t=(en,zh)=>language==='zh'?zh:en;
    const context=await browser.newContext({viewport:{width:1360,height:950},reducedMotion:'reduce'});
    await context.addInitScript(language=>localStorage.setItem('reactive-md:language',language),language);
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    const preview=page.locator('.preview-stage');
    const open=async id=>{
      await openWorkbench(page,baseURL+'/?example='+id);
      await expect(page.locator('#example-select')).toHaveValue(id);
      await expect(preview.locator('.local-document')).toBeVisible();
    };
    await open('forms');
    await check(language+': form inputs and multiple selection update the workshop preferences',async()=>{
      const multi=preview.locator('.local-multi-select');
      await multi.getByRole('checkbox',{name:t('Mathematics','数学'),exact:true}).check();
      await multi.getByRole('checkbox',{name:t('Physics','物理'),exact:true}).check();
      await expect(multi.getByRole('checkbox',{name:t('Chemistry','化学'),exact:true})).toBeDisabled();
      await multi.getByRole('checkbox',{name:t('Physics','物理'),exact:true}).uncheck();
      await multi.getByRole('checkbox',{name:t('Chemistry','化学'),exact:true}).check();
      await expect(preview.getByText(t('Include a chemistry example','加入一个化学示例'),{exact:true})).toBeVisible();
      await preview.getByLabel(t('Experience level','经验水平'),{exact:true}).selectOption('advanced');
      await preview.getByRole('radio',{name:t('Independent exploration','自主探索'),exact:true}).check();
      await preview.getByRole('checkbox',{name:t('Include a written step-by-step guide','提供书面步骤说明'),exact:true}).check();
      await expect(preview.getByText(t('Prepare the written guide','准备书面说明'),{exact:true})).toBeVisible();
      await multi.locator('.local-multi-clear').click();
      await expect(multi.getByRole('checkbox',{checked:true})).toHaveCount(0);
    });
    await open('functions');
    await check(language+': interval keyboard controls keep ordered endpoints',async()=>{
      const range=preview.locator('.local-range-slider');
      const start=range.getByRole('slider').first(), end=range.getByRole('slider').last();
      await start.focus(); await start.press('ArrowRight'); await expect(start).toHaveValue('-2');
      await end.focus(); await end.press('ArrowLeft'); await expect(end).toHaveValue('2');
      await expect(preview).toContainText(t('Interval: -2–2','当前区间：-2–2'));
    });
    await check(language+': coordinate keyboard and pointer input update both coordinates',async()=>{
      const coordinate=preview.locator('.local-coordinate');
      const pad=coordinate.locator('.local-coordinate-pad');
      const fields=coordinate.locator('.local-coordinate-fields input');
      await pad.focus(); await pad.press('ArrowRight');
      await expect(fields.first()).toHaveValue('2');
      const box=await pad.boundingBox();
      await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
      await page.mouse.down(); await page.mouse.move(box.x+box.width*.74,box.y+box.height*.26,{steps:6}); await page.mouse.up();
      await expect(fields.first()).toHaveValue('3'); await expect(fields.last()).toHaveValue('3');
    });
    await check(language+': numeric quiz tolerance and scoped reset work in the function scenario',async()=>{
      const quiz=preview.locator('.local-quiz');
      await quiz.locator('input').fill('5.005'); await quiz.locator('.local-quiz-check').click();
      await expect(quiz.locator('.local-quiz-feedback')).toContainText(t('Correct','正确'));
      await quiz.locator('.local-quiz-again').click(); await expect(quiz.locator('input')).toHaveValue('');
      await preview.getByRole('button',{name:t('Reset Point and interval','坐标与区间 恢复默认'),exact:true}).click();
      await expect(preview.locator('.local-range-slider').getByRole('slider').first()).toHaveValue('-3');
      await expect(preview.locator('.local-coordinate-fields input').first()).toHaveValue('1');
    });
    await open('flow');
    await check(language+': steps reveal a flow question and retain the chosen answer',async()=>{
      const steps=preview.locator('.local-steps');
      await steps.locator('.local-steps-next').click();
      await expect(steps).toContainText(t('Each participant costs 80','每人 80 元'));
      await steps.locator('.local-steps-next').click();
      await expect(steps.locator('.local-steps-next')).toBeDisabled();
      const quiz=steps.locator('.local-quiz');
      await quiz.getByRole('radio',{name:'people × 80',exact:true}).check(); await quiz.locator('.local-quiz-check').click();
      await expect(quiz.locator('.local-quiz-feedback')).toContainText(t('Correct','正确'));
      await steps.locator('.local-steps-prev').click(); await steps.locator('.local-steps-next').click();
      await expect(quiz.getByRole('radio',{name:'people × 80',exact:true})).toBeChecked();
    });
    await open('tasks');
    await check(language+': todo completion strikes the label and updates colored progress',async()=>{
      const item=preview.locator('.local-checklist').first().locator('.local-checklist-item').nth(1);
      await item.getByRole('checkbox').check();
      expect(await item.locator('label').evaluate(el=>getComputedStyle(el).textDecorationLine)).toContain('line-through');
      await item.getByRole('checkbox').uncheck();
      expect(await item.locator('label').evaluate(el=>getComputedStyle(el).textDecorationLine)).not.toContain('line-through');
      await expect(preview.locator('.local-progress-fill')).toHaveCSS('background-color','rgb(22, 120, 117)');
    });
    await open('statistics');
    await check(language+': shared table/chart selection survives sorting, filtering and paging',async()=>{
      const table=preview.locator('.local-visual-table-block');
      await table.getByRole('button',{name:t('Select row Visual','选择行 视觉'),exact:true}).click();
      const chart=preview.locator('.local-visual-chart').first();
      await expect(chart.locator('[data-chart-selectable][aria-pressed="true"]')).toHaveCount(2);
      const search=table.locator('input[type="search"]'); await search.fill(t('Content','内容'));
      await expect(chart.locator('[data-chart-selectable][aria-pressed="true"]')).toHaveCount(2);
      await search.fill('');
      const sort=table.locator('.local-visual-sort-button').filter({hasText:t('Actual','实际')});
      await sort.click(); await sort.click();
      const mark=chart.locator('[data-chart-selectable]').last();
      await mark.focus(); await mark.press('Enter');
      await expect(preview).toContainText(t('Selected expense: Testing','当前选择：测试'));
      await table.locator('.local-visual-pagination button').last().click();
      await expect(table.getByRole('button',{name:t('Select row Testing','选择行 测试'),exact:true})).toHaveAttribute('aria-pressed','true');
      await preview.getByRole('tab',{name:t('Budget and actual','预算与实际'),exact:true}).click();
      await expect(preview.locator('.local-visual-chart-scatter [data-chart-selectable][aria-pressed="true"]')).toHaveCount(1);
    });
    await open('layout');
    await check(language+': prose colors and local jumps work in the reading scenario',async()=>{
      await expect(preview.locator('.local-text')).toHaveCSS('color','rgb(162, 39, 58)');
      await expect(preview.locator('.local-section')).toHaveCSS('color','rgb(69, 83, 111)');
      await preview.getByRole('link',{name:t('Jump to the questions','跳到常见问题'),exact:true}).click();
      expect(await page.evaluate(()=>document.activeElement?.id?.endsWith('-reading-details'))).toBe(true);
      await preview.getByRole('link',{name:t('Return to the overview','返回阅读概览'),exact:true}).click();
      expect(await page.evaluate(()=>document.activeElement?.id?.endsWith('-reading-start'))).toBe(true);
    });
    await check(language+': all six scenarios fit desktop/mobile in light/dark themes',async()=>{
      for(const id of ['functions','forms','statistics','layout','flow','tasks']) {
        await page.setViewportSize({width:1360,height:950}); await open(id);
        for(const width of [1360,375]) {
          await page.setViewportSize({width,height:950});
          for(const theme of ['light','dark']) {
            await preview.locator('.md-document').evaluate((el,theme)=>el.setAttribute('data-theme',theme),theme);
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
            await page.screenshot({path:'artifacts/v2-'+language+'-'+id+'-'+width+'-'+theme+'.png',fullPage:true});
          }
        }
        await expect(preview.locator('.local-error')).toHaveCount(0);
      }
    });
    await context.close();
  }
  const boundaryContext=await browser.newContext({viewport:{width:1100,height:900},reducedMotion:'reduce'});
  const boundary=await boundaryContext.newPage();
  boundary.setDefaultTimeout(10000);
  boundary.on('pageerror',error=>errors.push(error.message));
  await openWorkbench(boundary,baseURL+'/?example=functions');
  await clickWorkbenchAction(boundary, 'Show source');
  await replaceWorkbenchSource(boundary, `<panel title="Boundary checks">
<coordinate label="Fractional point" bind-x="px" bind-y="py" initial-x="0.3" initial-y="0.6" x-min="0" x-max="1" y-min="0" y-max="1" step="0.3">
<toggle bind="shown" label="Show target">
<jump to="hidden">Hidden destination</jump>
<if when="{{ shown }}">
<anchor id="hidden">
Revealed destination.
</if>
</panel>`);
  const stage=boundary.locator('.preview-stage');
  // The previous function example also contains a coordinate. Wait for this
  // fixture's labelled fields before sending keys to its coordinate pad.
  await expect(stage.getByRole('textbox',{name:'Fractional point X',exact:true})).toHaveValue('0.3');
  await expect(stage.getByRole('textbox',{name:'Fractional point Y',exact:true})).toHaveValue('0.6');
  await check('fractional coordinate boundaries snap to a valid step',async()=>{
    await stage.locator('.local-coordinate-pad').focus();
    await stage.locator('.local-coordinate-pad').press('End');
    const fields=stage.locator('.local-coordinate-fields input');
    await expect(fields.first()).toHaveValue('0.9');
    await expect(fields.last()).toHaveValue('0.9');
    await expect(stage.locator('.local-error')).toHaveCount(0);
  });
  await check('hidden jumps give feedback and become usable after the target is shown',async()=>{
    const jump=stage.getByRole('link',{name:'Hidden destination',exact:true});
    await jump.click();
    await expect(stage.locator('.local-jump-feedback')).toHaveText('Jump target is hidden');
    await stage.getByRole('checkbox',{name:'Show target',exact:true}).click();
    await jump.click();
    expect(await boundary.evaluate(()=>document.activeElement?.id?.endsWith('-hidden'))).toBe(true);
    await expect(stage.locator('.local-jump-feedback')).toHaveCount(0);
  });
  await check('programmatic panel reset clears a focused coordinate draft',async()=>{
    const field=stage.locator('.local-coordinate-fields input').first();
    await field.fill('-');
    await stage.getByRole('button',{name:'Reset Boundary checks',exact:true}).dispatchEvent('click');
    await expect(field).toHaveValue('0.3');
  });
  await boundaryContext.close();
  expect(errors).toEqual([]);
  await writeFile('artifacts/v2-results.json',JSON.stringify({baseURL,checks,errors},null,2));
} finally { await browser.close(); }
