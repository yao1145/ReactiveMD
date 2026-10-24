import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, LocalReactiveDocument, textProblem } from '../src/local/LocalDocumentView';
import { countLocalCodePoints, formatLocalDiagnostic } from '../src/local';
import type { LocalLocale } from '../src/local/i18n';

function mount(source: string, locale?: LocalLocale): { html: string; text: string } {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('；'));
  }
  const runtime = createLocalRuntime(result.document);
  try {
    const html = renderToStaticMarkup(
      <LocalDocumentView document={result.document} runtime={runtime} locale={locale} />,
    );
    return { html, text: html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ') };
  } finally {
    runtime.dispose();
  }
}

const controlsSource =
  '<panel>\n' +
  '<counter bind="count" label="Participants" initial="2" min="1" max="20">\n' +
  '</panel>\n\n' +
  '<checklist bind="done" label="Steps">\n- [ ] First step\n</checklist>\n\n' +
  '<timer label="Focus timer" duration="60">\n\n' +
  '<table label="Prices">\n' +
  '| Name | Price |\n| --- | ---: |\n| Alpha | 10 |\n| Beta | 20 |\n' +
  '</table>\n';

const controlsSourceZh =
  '<panel>\n' +
  '<counter bind="count" label="参与人数" initial="2" min="1" max="20">\n' +
  '</panel>\n\n' +
  '<checklist bind="done" label="任务">\n- [ ] 第一项\n</checklist>\n\n' +
  '<timer label="专注计时" duration="60">\n\n' +
  '<table>\n' +
  '| 名称 | 价格 |\n| --- | ---: |\n| 甲 | 10 |\n| 乙 | 20 |\n' +
  '</table>\n';

const zhTimeline =
  '<timeline title="计划">\n' +
  '| 事项 | 开始 | 时长 | 说明 |\n' +
  '| --- | ---: | ---: | --- |\n' +
  '| 准备 | 0 | 10 | 先列出材料 |\n' +
  '| 执行 | 10 | 20 | 完成主体 |\n' +
  '| 检查 | 30 | 5 | 复核结果 |\n' +
  '</timeline>\n';

const enTimeline =
  '<timeline title="Work plan">\n' +
  '| Task | Start | Duration | Notes |\n' +
  '| --- | ---: | ---: | --- |\n' +
  '| Prepare | 0 | 10 | List materials first |\n' +
  '| Draft | 10 | 20 | Write the core content |\n' +
  '| Review | 30 | 5 | Check the result |\n' +
  '</timeline>\n';

describe('library locale defaults', () => {
  it('keeps the English UI when locale is omitted', () => {
    const { html, text } = mount(controlsSource);
    expect(html).toContain('aria-label="Interactive document"');
    expect(html).toContain('aria-label="Participants increase"');
    expect(html).toContain('aria-label="Participants decrease"');
    expect(html).toContain('>Reset<');
    expect(text).toContain('Steps');
    expect(html).toContain('aria-label="60 seconds remaining"');
    expect(html).toContain('>Start<');
    expect(html).toContain('>Pause<');
    expect(html).toContain('aria-label="Search Prices"');
    expect(html).toContain('placeholder="Search all columns"');
    expect(text).toContain('Paused');

    const unlabeled = mount('<table>\n| Name |\n| --- |\n| Alpha |\n</table>');
    expect(unlabeled.html).toContain('aria-label="Search Table"');
    expect(unlabeled.html).toContain('>Table<');
  });

  it('keeps the English UI for explicit locale="en"', () => {
    const { html } = mount(controlsSource, 'en');
    expect(html).toContain('aria-label="Interactive document"');
    expect(html).toContain('aria-label="Participants increase"');
    expect(html).toContain('>Reset<');
    expect(html).toContain('aria-label="Search Prices"');
  });

  it('localizes counter, panel, checklist, timer and table labels for locale="zh"', () => {
    const { html, text } = mount(controlsSourceZh, 'zh');
    expect(html).toContain('aria-label="交互文档"');
    expect(html).toContain('aria-label="参与人数 增加"');
    expect(html).toContain('aria-label="参与人数 减少"');
    expect(html).toContain('>恢复初值<');
    expect(html).toContain('aria-label="参数面板"');
    expect(html).toContain('aria-label="恢复默认"');
    expect(text).toContain('恢复默认');
    expect(html).toContain('任务');
    expect(html).toContain('aria-label="专注计时"');
    expect(html).toContain('aria-label="剩余 60 秒"');
    expect(html).toContain('>开始<');
    expect(html).toContain('>暂停<');
    expect(html).toContain('>重置<');
    expect(text).toContain('已暂停');
    expect(html).toContain('aria-label="搜索表格"');
    expect(html).toContain('placeholder="搜索所有列"');
    expect(html).toContain('>表格<');
    expect(text).toContain('表格');

    const checklistProblem = mount(
      '<number bind="n" label="分母" initial="0">\n\n' +
        '<checklist bind="done" label="任务" disabled="{{ 1 / n > 0 }}">\n- [ ] 第一项\n</checklist>\n',
      'zh',
    );
    expect(checklistProblem.text).toContain('无法计算');
  });
});

describe('LocalReactiveDocument locale', () => {
  it('defaults the syntax-error notice to English', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={'<number bind="n" label="Value">\n\nTotal: {{ missing + 1 }}\n'} />,
    );
    expect(html).toContain('local-inactive');
    expect(html).toContain('The document contains syntax errors; interactive preview is disabled.');
    expect(html).toContain('(line ');
  });

  it('shows the Chinese syntax-error notice for locale="zh"', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={'<number bind="n" label="数字">\n\n合计：{{ missing + 1 }}\n'}
        locale="zh"
      />,
    );
    expect(html).toContain('local-inactive');
    expect(html).toContain('文档包含语法错误，交互预览已停用。');
    expect(html).toContain('（第 ');
    expect(html).toContain(' 行，第 ');
  });
});

describe('diagnostic localization in the renderer', () => {
  it('formats the same diagnostic in both languages without changing its structure', () => {
    const result = compileLocal('{{ absent }}');
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics[0];
    const en = formatLocalDiagnostic(diagnostic, 'en');
    const zh = formatLocalDiagnostic(diagnostic, 'zh');
    expect(en).toContain('undeclared parameter');
    expect(zh).toContain('未声明');
    expect(zh).not.toBe(en);
    expect(diagnostic.code).toBe('local.binding.unknown');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.range.start).toBeGreaterThanOrEqual(2);
  });

  it('keeps the default English message for unknown host diagnostics', () => {
    const hostDiagnostic = {
      code: 'host.custom',
      message: 'Host-owned message',
      severity: 'warning' as const,
      range: { start: 0, end: 0 },
      line: 1,
      column: 1,
    };
    expect(formatLocalDiagnostic(hostDiagnostic)).toBe('Host-owned message');
    expect(formatLocalDiagnostic(hostDiagnostic, 'zh')).toBe('Host-owned message');
  });

  it('localizes the compile-error list of LocalReactiveDocument', () => {
    const source = '{{ absent }}';
    const enHtml = renderToStaticMarkup(<LocalReactiveDocument source={source} />);
    const zhHtml = renderToStaticMarkup(<LocalReactiveDocument source={source} locale="zh" />);
    expect(enHtml).toContain('undeclared parameter');
    expect(zhHtml).toContain('未声明');
    expect(zhHtml).toContain('（第 ');
  });

  it('uses code points for text-control min/max lengths', () => {
    expect(countLocalCodePoints('😀')).toBe(1);
    expect(countLocalCodePoints('中文')).toBe(2);
    expect(countLocalCodePoints('é')).toBe(2);
    expect(countLocalCodePoints('👩‍💻')).toBe(3);
    expect(countLocalCodePoints('\ud800')).toBe(1);

    expect(textProblem('😀', { required: false, maxLength: 1, minLength: 1 })).toBeNull();
    expect(textProblem('😀', { required: false, maxLength: 1 }, (en, zh) => zh)).toBeNull();
    expect(textProblem('😀😀', { required: false, maxLength: 1 })).toContain('At most 1');
    expect(textProblem('中文', { required: false, maxLength: 2, minLength: 2 })).toBeNull();
    expect(textProblem('é', { required: false, maxLength: 1 })).toContain('At most 1');
    // The defensive resource limit remains UTF-16 based and is not replaced by
    // the author-facing code-point limit.
    expect(textProblem('a'.repeat(100_001), { required: false })).toContain('100000');
  });

  it('accepts an astral initial value at max-length="1"', () => {
    const { html } = mount('<input bind="name" label="Name" max-length="1" initial="😀">');
    expect(html).toContain('value="😀"');
    expect(html).not.toContain('field-error');
  });
});

describe('timeline headers', () => {  it('compiles and renders Chinese headers with Chinese labels', () => {
    const result = compileLocal(zhTimeline);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={result.document} runtime={runtime} locale="zh" />,
      );
      expect(html).toContain('local-visual-timeline');
      expect(html).toContain('计划');
      expect(html).toContain('准备');
      expect(html).toContain('执行');
      expect(html).toContain('检查');
      expect(html).toContain(
        'aria-label="准备，开始 0 分钟，结束 10 分钟，时长 10 分钟，有说明"',
      );
      expect(html).toContain('开始');
      expect(html).toContain('结束');
      expect(html).toContain('时长');
      expect(html).not.toContain('Started');
      expect(html).not.toContain('Ended');
    } finally {
      runtime.dispose();
    }
  });

  it('keeps English headers working and renders English labels by default', () => {
    const result = compileLocal(enTimeline);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={result.document} runtime={runtime} />,
      );
      expect(html).toContain('local-visual-timeline');
      expect(html).toContain('Work plan');
      expect(html).toContain('Prepare');
      expect(html).toContain(
        'aria-label="Prepare, started 0 minutes, ended 10 minutes, duration 10 minutes, with notes"',
      );
      expect(html).toContain('Started');
      expect(html).toContain('Ended');
    } finally {
      runtime.dispose();
    }
  });

  it('accepts English headers under the Chinese locale and localizes only the labels', () => {
    const { html } = mount(enTimeline, 'zh');
    expect(html).toContain('local-visual-timeline');
    expect(html).toContain('Prepare');
    expect(html).toContain('开始');
    expect(html).toContain('结束');
    expect(html).toContain('时长');
    expect(html).not.toContain('Started');
  });

  it('accepts Chinese headers under the English locale', () => {
    const { html } = mount(zhTimeline);
    expect(html).toContain('local-visual-timeline');
    expect(html).toContain('准备');
    expect(html).toContain('Started');
    expect(html).toContain('Ended');
    expect(html).toContain('Duration');
  });
});
