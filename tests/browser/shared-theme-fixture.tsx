import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import { collectLocalThemeCss, defineLocalTheme } from '../../src/sdk/theme';
import '../../src/styles.css';

const empty = defineLocalTheme({ id: 'test/empty', name: 'empty', version: '1.0.0', css: [] });
const shaped = defineLocalTheme({ id: 'test/shaped', name: 'shaped', version: '1.0.0', css: [
  { id: 'shape', css: '[data-rmd-theme="shaped"] { --rmd-slider-thumb-width: 16px; --rmd-slider-thumb-height: 28px; --rmd-slider-thumb-radius: 2px; --rmd-slider-track-height: 4px; --rmd-chart-line-width: 6; --rmd-chart-bar-radius: 0px; }' },
  { id: 'cascade-probe', css: '@layer controls { [data-rmd-theme="shaped"] { --layer-probe: blue; } @layer rmd.themes { [data-rmd-theme="shaped"] { --layer-probe: red; } } }' },
] });
const content = `<counter bind="count" label="Count" initial="2">
<slider bind="level" label="Level" initial="3" min="0" max="10">
<range-slider label="Interval" min="0" max="10">
<select label="Choice">
<option value="a">A</option>
<option value="b">B</option>
<option value="c">C</option>
</select>
<date label="Day">

Count value: {{ count }}

<chart title="Shared chart">
| Category | Value |
| --- | ---: |
| A | 2 |
| B | 4 |
</chart>

<chart kind="line" title="Lines">
| Time | Alpha | Beta |
| --- | ---: | ---: |
| 1 | 10 | 20 |
| 2 | 20 | 5 |
| 3 | 15 | 12 |
</chart>

<diagram label="Steps">
<node id="a" label="Start">Start description</node>
<node id="b" label="End">End description</node>
<edge from="a" to="b">
</diagram>`;

declare global { interface Window { sharedThemeHarness: { registered(value: boolean): void; scheme(value: 'light' | 'dark'): void } } }

function Fixture() {
  const [registered, setRegistered] = useState(true);
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  window.sharedThemeHarness = { registered: setRegistered, scheme: setScheme };
  return <>
    <style>{collectLocalThemeCss(shaped)}</style>
    <div id="baseline"><LocalReactiveDocument source={content} colorScheme={scheme} /></div>
    <div id="empty"><LocalReactiveDocument source={`<theme name="empty">\n\n${content}`} themes={registered ? [empty] : []} colorScheme={scheme} /></div>
    <div id="shaped"><LocalReactiveDocument source={`<theme name="shaped">\n\n${content}`} themes={[shaped]} colorScheme={scheme} /></div>
    <div id="static"><LocalReactiveDocument source={`<theme name="empty">\n\n${content}`} themes={[empty]} colorScheme={scheme} mode="static" /></div>
    <button id="host-button">Host button</button>
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
