import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, LocalReactiveDocument } from '../src/local/LocalDocumentView';
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

describe('timeline headers', () => {
  it('compiles and renders Chinese headers with Chinese labels', () => {
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
