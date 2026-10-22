import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import {
  LocalDocumentView,
  LocalReactiveDocument,
} from '../src/local/LocalDocumentView';

function mount(source: string): { html: string; text: string } {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('；'));
  }
  const runtime = createLocalRuntime(result.document);
  try {
    const html = renderToStaticMarkup(
      <LocalDocumentView document={result.document} runtime={runtime} />,
    );
    return { html, text: html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ') };
  } finally {
    runtime.dispose();
  }
}

it('renders Markdown, interpolated text and controls with accessible names', () => {
  const { html, text } = mount(
    '# 费用估算\n\n' +
      '<slider bind="people" label="人数" initial="2" min="1" max="20">\n\n' +
      '<toggle bind="annual" label="年度付款">\n\n' +
      '每月费用：**{{ people * (annual ? 80 : 100) }} 元**。\n',
  );
  expect(html).toContain('<h1');
  expect(html).toContain('type="range"');
  expect(html).toContain('人数');
  expect(html).toContain('年度付款');
  expect(text).toContain('每月费用');
  expect(text).toContain('200');
});

it('renders unbound controls that keep their own state', () => {
  const { html } = mount('<counter label="参与人数" initial="2" min="1" max="20">');
  expect(html).toContain('参与人数');
  expect(html).toContain('恢复初值');
  expect(html).toContain('aria-label="参与人数 增加"');
});

it('shows a local error instead of a stale value when an expression fails', () => {
  const { text } = mount('<number bind="n" label="分母" initial="0">\n\n结果：{{ 1 / n }}。\n');
  expect(text).toContain('无法计算');
});

it('keeps hidden conditional content mounted and hides it from the reader', () => {
  const { html } = mount(
    '<toggle bind="show" label="显示">\n\n' +
      '<if when="{{ show }}">\n<timer label="专注计时" duration="60">\n</if>\n',
  );
  expect(html).toContain('专注计时');
  expect(html).toContain('role="timer"');
  expect(html).toContain('hidden');
  expect(html).toContain('aria-hidden="true"');
});

it('renders inline math through the math view and marks it inline', () => {
  const { html } = mount('行内 $x^2$ 公式。\n');
  expect(html).toContain('local-math-inline');
});

it('reports an unevaluable condition locally and keeps the hidden subtree mounted', () => {
  const { html, text } = mount(
    '<number bind="n" label="分母" initial="0">\n\n' +
      '<if when="{{ 1 / n > 1 }}">\n<timer label="条件计时" duration="60">\n</if>\n',
  );
  expect(text).toContain('无法计算');
  expect(html).toContain('条件计时');
  expect(html).toContain('hidden');
});

it('fails closed and reports an unevaluable disabled expression', () => {
  const { html, text } = mount(
    '<number bind="n" label="分母" initial="0">\n\n' +
      '<input bind="name" label="称呼" disabled="{{ 1 / n > 0 }}">\n',
  );
  expect(text).toContain('无法计算');
  expect(html).toMatch(/<input[^>]*disabled=""/);
});

it('deactivates the preview when compilation reports a fatal error', () => {
  const html = renderToStaticMarkup(
    <LocalReactiveDocument source={'<number bind="n" label="数字">\n\n结果：{{ missing + 1 }}\n'} />,
  );
  expect(html).toContain('local-inactive');
  expect(html).toContain('交互预览已停用');
});
