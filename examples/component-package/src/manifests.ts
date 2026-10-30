import { defineLocalComponent } from 'reactive-md/sdk';

/**
 * Two manifests: a numeric control and a Markdown container.
 *
 * The manifest is plain, bounded JSON data. React implementations live in
 * `components.tsx`; both are bound together by `defineReactComponent`.
 */
export const rating = defineLocalComponent({
  id: 'example/rating',
  name: 'rating',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', dynamic: true, default: 5, integer: true, min: 1, max: 10 },
    locked: { kind: 'boolean', dynamic: true, default: false },
  },
  bindings: {
    value: {
      kind: 'number',
      family: 'number',
      bind: 'bind',
      initial: 'initial',
      initialRule: 'nearest-zero',
      constraints: {
        min: { literal: 0 },
        max: { prop: 'max' },
        step: { literal: 1 },
      },
    },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Rating', zh: '评分' },
    description: {
      en: 'A numeric rating control that shares a document binding.',
      zh: '与文档绑定共享数值的评分控件。',
    },
    category: 'input',
    insertText: '<rating bind="score" label="Score" max="5" initial="3">',
  },
  styles: ['example/component.css'],
});

export const note = defineLocalComponent({
  id: 'example/note',
  name: 'note',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'container',
  props: {
    title: { kind: 'string', required: true },
    tone: { kind: 'enum', enum: ['info', 'warn'], default: 'info', static: true },
    disabled: { kind: 'boolean', dynamic: true, default: false },
  },
  structure: { rule: 'any', label: 'optional' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Note', zh: '提示' },
    description: {
      en: 'A Markdown container with a title and a visual tone.',
      zh: '带标题与视觉风格的 Markdown 容器。',
    },
    category: 'content',
    insertText: '<note title="Notes" tone="info">\n**Markdown** content.\n</note>',
  },
  styles: ['example/component.css'],
});
