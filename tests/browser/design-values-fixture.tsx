import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import { collectLocalThemeCss, defineLocalTheme } from '../../src/sdk/theme';
import '../../src/styles.css';

const custom = defineLocalTheme({ id: 'test/design-values', name: 'design-values', version: '1.0.0', css: [{ id: 'paint', css: `
[data-rmd-theme="design-values"] {
  --tooltip-bg: rgb(30 70 100);
  --tooltip-ink: rgb(250 240 210);
  --dialog-backdrop: rgb(20 60 90 / 70%);
  --image-zoom-backdrop: rgb(70 20 90 / 80%);
  --shadow-lg: 0 7px 19px rgb(80 30 90 / 40%);
  --rmd-button-press-shadow: inset 0 3px 4px rgb(40 90 120 / 50%);
  --rmd-diagram-node-shadow: 0 4px 6px rgb(30 100 150 / 60%);
  --rmd-choice-thumb-shadow: 0 3px 5px rgb(100 40 120 / 50%);
  --radius-2xs: 4px;
  --radius-xs: 5px;
  --radius-inset: 7px;
  --radius-toolbar: 11px;
  --radius-xl: 26px;
  --radius-pill: 30px;
}` }] });
const content = `<quiz label="题目" answer="b">
<option value="a">甲</option><option value="b">乙</option>
</quiz>

<tooltip text="提示内容">帮助</tooltip>
<choices label="尺寸"><option value="a">小</option><option value="b">大</option></choices>
<coordinate label="坐标" initial-x="1" initial-y="1">

<chart title="图表">
| Category | Value |
| --- | ---: |
| A | 2 |
| B | 4 |
</chart>

<diagram label="流程"><node id="a" label="开始">节点详情。</node><node id="b" label="结束">结束。</node><edge from="a" to="b"></diagram>`;
declare global { interface Window { designValuesHarness: { scheme(mode: 'light' | 'dark'): void } } }
function Fixture() {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  window.designValuesHarness = { scheme: setScheme };
  return <>
    <style>{collectLocalThemeCss(custom)}</style>
    <div id="baseline"><LocalReactiveDocument source={content} colorScheme={scheme} locale="zh" /></div>
    <div id="custom"><LocalReactiveDocument source={`<theme name="design-values">\n\n${content}`} themes={[custom]} colorScheme={scheme} locale="zh" /></div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
