import { describe, expect, it } from 'vitest';
import {
  createLocalComponentCatalogForOptions,
  filterLocalComponentCatalog,
  insertLocalComponentFromOptions,
  localComponentCatalogGroups,
  localComponentHelp,
} from 'reactive-md/authoring';
import { createLocalConfig, defineLocalComponent } from 'reactive-md/sdk';

const capabilities = { interactive: true, static: true, ssr: true, offline: true } as const;

const rating = defineLocalComponent({
  id: 'demo/rating',
  name: 'demo-rating',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: {
      kind: 'string',
      required: true,
      description: { en: 'Visible rating label', zh: '可见的评分标签' },
    },
  },
  bindings: {
    value: {
      kind: 'number',
      family: 'number',
      bind: 'bind',
      initial: 'initial',
      initialRule: 'nearest-zero',
    },
  },
  capabilities,
  authoring: {
    title: { en: 'Demo rating', zh: '演示评分' },
    description: { en: 'A demo extension control.', zh: '演示用扩展控件。' },
    category: 'input',
    insertText: '<demo-rating bind="{{bind:score}}" label="Rating">',
  },
});

const hint = defineLocalComponent({
  id: 'demo/hint',
  name: 'demo-hint',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'container',
  props: {},
  structure: { rule: 'any', label: 'none' },
  capabilities,
  authoring: {
    title: { en: 'Demo hint', zh: '演示提示' },
    description: { en: 'A demo extension container.', zh: '演示用扩展容器。' },
    category: 'hint',
    insertText: '<demo-hint>\n\n</demo-hint>',
  },
});

const config = createLocalConfig({ components: [rating, hint] });
const options = { config };

describe('demo authoring menu data', () => {
  it('derives defaults and registered extensions from one catalog', () => {
    const catalog = createLocalComponentCatalogForOptions(options, 'en');
    expect(catalog).toHaveLength(36);
    const groups = localComponentCatalogGroups(catalog);
    expect(groups.find((group) => group.id === 'input')?.entries.some((entry) => entry.name === 'demo-rating'))
      .toBe(true);
    expect(groups.find((group) => group.id === 'hint')?.entries.some((entry) => entry.name === 'demo-hint'))
      .toBe(true);
  });

  it('shows localized titles and property help in the picker data', () => {
    const zh = createLocalComponentCatalogForOptions(options, 'zh');
    const entry = zh.find((item) => item.name === 'demo-rating');
    expect(entry?.title).toBe('演示评分');
    expect(entry?.props.label.description).toBe('可见的评分标签');
    expect(localComponentHelp(entry!)).toContain('可见的评分标签');
  });

  it('searches and inserts an extension with a fresh binding', () => {
    const catalog = createLocalComponentCatalogForOptions(options, 'en');
    expect(filterLocalComponentCatalog(catalog, { query: 'demo rating' }).map((entry) => entry.name))
      .toContain('demo-rating');

    const first = insertLocalComponentFromOptions(options, 'demo/rating', '', { start: 0, end: 0 }, 'en');
    expect(first.value).toContain('bind="score"');
    const second = insertLocalComponentFromOptions(
      options,
      'demo/rating',
      first.value,
      { start: first.value.length, end: first.value.length },
      'en',
    );
    expect(second.value).toContain('bind="score2"');
  });
});
