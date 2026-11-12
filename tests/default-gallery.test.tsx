import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal, createLocalRuntime } from '../src/index';
import { LocalDocumentView } from '../src/react/index';
import { createLocalConfig } from '../src/sdk/config';
import { layoutPack } from '../src/presets/packs';
import { createLocalComponentCatalog } from '../src/authoring/catalog';

const source = `<gallery label="研究切片" item-width="260">
<gallery-item label="04 · 波形">完整的 **波形说明**。</gallery-item>
<gallery-item label="研究记录"><card title="记录">卡片正文。</card></gallery-item>
</gallery>`;

describe('default gallery integration', () => {
  it('compiles and renders with the default preset and no extra registration', () => {
    const result = compileLocal(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      const interactive = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} locale="zh" />);
      expect(interactive).toContain('rmd-gallery-viewport');
      expect(interactive).toContain('aria-label="下一组"');
      expect(interactive).toMatch(/<h3 class="rmd-gallery-caption"[^>]*>04 · 波形<\/h3>/);
      const staticHtml = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} mode="static" />);
      expect(staticHtml).toContain('rmd-gallery-static-grid');
      expect(staticHtml).toContain('波形说明');
      expect(staticHtml).toContain('卡片正文');
      expect(staticHtml).not.toContain('rmd-gallery-button');
    } finally { runtime.dispose(); }
  });

  it('includes gallery in the layout pack and localized insertion catalog', () => {
    const config = createLocalConfig({ presets: [layoutPack] });
    expect(compileLocal(source, { config }).ok).toBe(true);
    const entry = createLocalComponentCatalog(config, 'zh').find(item => item.name === 'gallery');
    expect(entry?.title).toBe('横向画廊');
    expect(entry?.insertText).toContain('<gallery-item');
  });

  it('rejects empty galleries and non-item direct children', () => {
    expect(compileLocal('<gallery label="空画廊"></gallery>').ok).toBe(false);
    expect(compileLocal('<gallery label="画廊"><card title="错误层级">内容</card></gallery>').ok).toBe(false);
  });
});
