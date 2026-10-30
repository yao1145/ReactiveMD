import { useEffect, useState, type KeyboardEvent } from 'react';
import { defineLocalComponent, createLocalConfig, defineLocalTheme } from 'reactive-md/sdk';
import { defaultPreset } from 'reactive-md/presets/default';
import { createReactConfig, defineReactComponent, type LocalComponentContext } from 'reactive-md/react';

export const rating = defineLocalComponent({
  id: 'example/rating', name: 'rating', version: '1.0.0', protocol: 'reactive-md-component/v1', form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', default: 5, integer: true, min: 1, max: 10, dynamic: true },
  },
  styles: ['example/rating.css'],
  bindings: { value: {
    kind: 'number', family: 'number', bind: 'bind', initial: 'initial', initialRule: 'nearest-zero',
    constraints: { min: { literal: 0 }, max: { prop: 'max' }, step: { literal: 1 } },
  } },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Rating', zh: '评分' }, category: 'input',
    description: { en: 'A rating sharing a numeric binding.', zh: '与数字控件共享绑定的评分。' },
    insertText: '<rating bind="score" label="评分">',
  },
});

export const hint = defineLocalComponent({
  id: 'example/hint', name: 'hint', version: '1.0.0', protocol: 'reactive-md-component/v1', form: 'container',
  props: { title: { kind: 'string', default: '说明' } }, children: { kind: 'markdown' },
  styles: ['example/hint.css'],
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: { title: { en: 'Hint', zh: '提示' }, category: 'content', insertText: '<hint title="说明">\n普通 **Markdown**。\n</hint>' },
});

// Component structure is independent of the optional theme enhancements.
export const componentResources = [
  { id: 'example/rating.css', css: `.local-document .example-rating { display:flex; align-items:center; gap:var(--space-2,8px); flex-wrap:wrap; }
.local-document .example-rating button { padding:8px 12px; color:var(--ink); background:var(--surface); border:1px solid var(--accent); border-radius:var(--radius-control,6px); }
.local-document .example-rating button[aria-checked="true"] { background:var(--accent); color:var(--surface); }
.local-document .example-rating button:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.local-document .example-rating button:disabled { opacity:var(--disabled-opacity,.5); }` },
  { id: 'example/hint.css', css: '.local-document .example-hint { border-inline-start:3px solid var(--accent); padding:var(--space-3,12px); background:var(--surface-subtle); }' },
] as const;

export const paper = defineLocalTheme({
  id: 'example/paper', name: 'paper', version: '1.0.0', protocol: 'reactive-md-theme-1', colorSchemes: ['light', 'dark'],
  css: [{ id: 'example/paper.css', css: `
[data-rmd-theme="paper"] { --surface: #fffdf7; --document-bg: #fffdf7; --ink: #26302d; --accent: #216b54; }
[data-rmd-theme="paper"][data-color-scheme="dark"] { --surface: #192522; --document-bg: #192522; --ink: #e6f1e9; --accent: #8fd1ab; }
` }],
});

export function RatingControl(ctx: LocalComponentContext) {
  const value = Number(ctx.bindings.value.get());
  const maximum = Number(ctx.props.max);
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => setHovered(null), [ctx.resetToken, ctx.visible]);
  const set = (next: number) => ctx.bindings.value.set(Math.max(0, Math.min(maximum, next)));
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); set(value + 1); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); set(value - 1); }
    if (event.key === 'Home') { event.preventDefault(); set(0); }
    if (event.key === 'End') { event.preventDefault(); set(maximum); }
  };
  return <div className="example-rating" role="radiogroup" aria-label={String(ctx.props.label)} data-reset-token={ctx.resetToken}>
    <span>{String(ctx.props.label)}</span>
    {Array.from({ length: maximum + 1 }, (_, n) => <button key={n} type="button" role="radio"
      aria-checked={value === n} aria-label={`评分 ${n}`} disabled={ctx.disabled || !ctx.visible}
      tabIndex={value === n ? 0 : -1} onClick={() => set(n)} onKeyDown={keyboard}
      onPointerEnter={() => setHovered(n)} onPointerLeave={() => setHovered(null)}>{n}</button>)}
    <output aria-live="polite" data-rating-value>{hovered ?? value} / {maximum}</output>
  </div>;
}
export function RatingText(ctx: LocalComponentContext) {
  return <p className="example-rating-static">{String(ctx.props.label)}: {String(ctx.bindings.value.get())} / {String(ctx.props.max)}</p>;
}
export function Hint(ctx: LocalComponentContext) {
  return <aside className="example-hint"><h3>{String(ctx.props.title)}</h3>{ctx.children.render()}</aside>;
}
export const config = createLocalConfig({ presets: [defaultPreset], components: [rating, hint], themes: [paper] });
export const reactConfig = createReactConfig(config, { components: [
  defineReactComponent(rating, { render: RatingControl, renderStatic: RatingText }),
  defineReactComponent(hint, { render: Hint, renderStatic: Hint }),
] });
export const source = `<theme name="paper">

# SDK 外部消费示例

<panel title="评分面板">
<number bind="score" label="内置评分" min="0" max="5" initial="3">
<rating bind="score" label="你的评分" max="5">

<hint title="说明">
当前评分为 **{{ score }}**。

- 普通 Markdown 与响应式内容共享文档运行时。
</hint>
</panel>
`;
