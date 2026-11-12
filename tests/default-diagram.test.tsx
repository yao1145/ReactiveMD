import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { LocalDocumentView } from '../src/local/rendering/LocalDocumentView';

const source = `<diagram label="分析流程" bind="step" initial="input">
<node id="input" label="输入数据">节点正文只在浮层中显示。</node>
<node id="result" label="结果" tone="success">完整的 **结果说明**。</node>
<edge from="input" to="result" label="分析">
</diagram>`;

function render(mode: 'interactive' | 'static') {
  const compiled = compileLocal(source);
  if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join('; '));
  const runtime = createLocalRuntime(compiled.document);
  try { return renderToStaticMarkup(<LocalDocumentView document={compiled.document} runtime={runtime} mode={mode} locale="zh" />); }
  finally { runtime.dispose(); }
}

describe('default diagram inspection', () => {
  it('keeps node bodies out of the resting view and exposes keyboard inspection', () => {
    const html = render('interactive');
    expect(html).toContain('rmd-diagram-stage');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('local-visual-diagram-detail');
    expect(html).not.toContain('节点正文只在浮层中显示。');
    expect(html).toContain('aria-pressed="true"');
  });
  it('keeps all rich node contents readable in static documents', () => {
    const html = render('static');
    expect(html).toContain('节点正文只在浮层中显示。');
    expect(html).toMatch(/<strong>(?:<span>)?结果说明/);
    expect(html).toContain('local-static-diagram-detail');
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('rmd-diagram-toolbar');
  });
});
