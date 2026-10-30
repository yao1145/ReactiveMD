import { describe, expect, it } from 'vitest';
import {
  createLocalAuthoringLookup,
  createLocalComponentCatalog,
  insertLocalComponent,
  validateLocalComponentInsertTemplates,
} from '../src/authoring';
import { completeLocalSource } from '../src/local/authoring';
import { compileLocal } from '../src/local/compiler';
import type { LocalCompileOptions } from '../src/local';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent } from '../src/sdk/manifest';
import type { LocalComponentDefinition, LocalConfig } from '../src/sdk/types';

const BOOLEAN_CAPABILITIES = {
  interactive: true,
  static: true,
  ssr: true,
  offline: true,
} as const;

const rating: LocalComponentDefinition = defineLocalComponent({
  id: 'example/rating',
  name: 'rating',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: {
      kind: 'string',
      required: true,
      description: { zh: '请评分', en: 'Rate this component' },
    },
    max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
  },
  bindings: {
    value: {
      kind: 'number',
      family: 'number',
      bind: 'bind',
      initial: 'initial',
      initialRule: 'nearest-zero',
      constraints: { min: { literal: 0 }, max: { prop: 'max' } },
    },
  },
  capabilities: BOOLEAN_CAPABILITIES,
  styles: ['example/rating.css'],
  requires: { kernel: '>=0.6.0' },
  authoring: {
    title: { zh: '评分', en: 'Rating' },
    description: { zh: '与数字控件共享绑定的评分。', en: 'A rating sharing a numeric binding.' },
    category: 'input',
    insertText: '<rating bind="score" label="Rating" initial="3">',
  },
});

const hint: LocalComponentDefinition = defineLocalComponent({
  id: 'example/hint',
  name: 'hint',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'container',
  props: { title: { kind: 'string' } },
  capabilities: BOOLEAN_CAPABILITIES,
  authoring: { title: { zh: '提示', en: 'Hint' }, category: 'hint' },
});

const config = createLocalConfig({ components: [rating, hint] });

function leafManifest(input: {
  id: string;
  name: string;
  props?: LocalComponentDefinition['props'];
  authoring?: LocalComponentDefinition['authoring'];
  bindings?: LocalComponentDefinition['bindings'];
  children?: LocalComponentDefinition['children'];
  form?: LocalComponentDefinition['form'];
}): LocalComponentDefinition {
  return defineLocalComponent({
    id: input.id,
    name: input.name,
    version: '1.0.0',
    protocol: 'reactive-md-component/v1',
    form: input.form ?? 'leaf',
    props: input.props ?? {},
    ...(input.bindings ? { bindings: input.bindings } : {}),
    ...(input.children ? { children: input.children } : {}),
    capabilities: BOOLEAN_CAPABILITIES,
    ...(input.authoring ? { authoring: input.authoring } : {}),
  });
}

describe('createLocalComponentCatalog', () => {
  const catalog = createLocalComponentCatalog(config, 'en');

  it('includes native catalog entries and freezes every entry', () => {
    const number = catalog.find((entry) => entry.name === 'number');
    expect(number).toBeDefined();
    expect(number!.id).toBe('number');
    expect(number!.title).toBe('Number input');
    expect(number!.category).toBe('input');
    expect(number!.insertText).toContain('<number bind="{{bind:quantity}}"');
    expect(number!.props.bind?.kind).toBe('string');

    expect(Object.isFrozen(catalog)).toBe(true);
    for (const entry of catalog) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.props)).toBe(true);
    }
  });

  it('derives external entries from validated manifests with localized authoring metadata', () => {
    const entry = catalog.find((item) => item.name === 'rating');
    expect(entry).toMatchObject({
      id: 'example/rating',
      name: 'rating',
      title: 'Rating',
      description: 'A rating sharing a numeric binding.',
      category: 'input',
      insertText: '<rating bind="score" label="Rating" initial="3">',
    });
    expect(entry!.props.label).toMatchObject({
      kind: 'string',
      required: true,
      description: 'Rate this component',
    });
    expect(entry!.props.max).toMatchObject({ kind: 'number', dynamic: true, defaultValue: 5 });
    expect(entry!.styles).toEqual(['example/rating.css']);
    expect(entry!.requires).toEqual({ kernel: '>=0.6.0' });
    expect(Object.isFrozen(entry!.styles)).toBe(true);

    const zh = createLocalComponentCatalog(config, 'zh').find((item) => item.name === 'rating');
    expect(zh?.title).toBe('评分');
    expect(zh?.description).toBe('与数字控件共享绑定的评分。');
    expect(zh?.props.label.description).toBe('请评分');
  });

  it('synthesizes a minimal legal template when a manifest has no insertText', () => {
    const synthesized = createLocalComponentCatalog(
      createLocalConfig({ components: [hint] }),
      'en',
    ).find((item) => item.name === 'hint');
    expect(synthesized?.insertText).toBe('<hint>\n\n</hint>');

    const marker = leafManifest({
      id: 'example/marker',
      name: 'marker',
      props: { tone: { kind: 'enum', required: true, enum: ['info', 'success'] } },
    });
    const leaf = createLocalComponentCatalog(createLocalConfig({ components: [marker] }), 'en')
      .find((item) => item.name === 'marker');
    expect(leaf?.insertText).toBe('<marker tone="info">');
  });

  it('synthesizes a literal binding that compiles with the same config', () => {
    const gauge = leafManifest({
      id: 'example/gauge',
      name: 'gauge',
      props: rating.props,
      bindings: rating.bindings,
    });
    const gaugeConfig = createLocalConfig({ components: [gauge] });
    const entry = createLocalComponentCatalog(gaugeConfig, 'en')
      .find((item) => item.name === 'gauge');
    expect(entry?.insertText).toBe('<gauge bind="gauge" label="">');
    const compiled = compileLocal(entry!.insertText, { config: gaugeConfig });
    expect(compiled.ok, compiled.ok ? '' : JSON.stringify(compiled.diagnostics)).toBe(true);
  });

  it('uses core config validation instead of a parallel weak reader', () => {
    const tampered = {
      ...config,
      components: [{ ...rating, extra: 'not-allowed' }],
    } as unknown as LocalConfig;
    expect(() => createLocalComponentCatalog(tampered, 'en')).toThrow(/unknown field/);
    expect(() => createLocalComponentCatalog({
      protocol: 'reactive-md-config/v1',
      components: 'nope',
    } as unknown as LocalConfig, 'en')).toThrow(/components/);
  });

  it('rejects conflicts and templates that cannot be synthesized legally', () => {
    expect(() => createLocalConfig({
      components: [leafManifest({ id: 'example/number', name: 'number' })],
    })).toThrow(/conflicts with a built-in component/);

    const duplicate = leafManifest({ id: 'example/other', name: 'rating' });
    expect(() => createLocalConfig({ components: [rating, duplicate] }))
      .toThrow(/declared more than once/);

    const patterned = leafManifest({
      id: 'example/slug',
      name: 'slug',
      props: { slug: { kind: 'string', required: true, pattern: '^[a-z]+$' } },
    });
    expect(() => createLocalComponentCatalog(createLocalConfig({ components: [patterned] }), 'en'))
      .toThrow(/authoring\.insertText/);

    const withChildren = leafManifest({
      id: 'example/group',
      name: 'group',
      form: 'container',
      children: { kind: 'markdown', required: true },
    });
    expect(() => createLocalComponentCatalog(createLocalConfig({ components: [withChildren] }), 'en'))
      .toThrow(/requires children/);
  });
});

describe('insertLocalComponent', () => {
  it('renames a fresh binding and its active references together', () => {
    const referenced = defineLocalComponent({ ...rating,
      authoring:{insertText:'<rating bind="score" label="Rate" initial="3">\n\nValue: {{ score }}. Code: `{{ score }}`.'},
    });
    const currentConfig=createLocalConfig({components:[referenced]});
    const previous='<number bind="score" label="Existing" min="0" max="5" initial="1">';
    const edit=insertLocalComponent(currentConfig,referenced.id,previous,{start:previous.length,end:previous.length});
    expect(edit.value).toContain('bind="score2"');
    expect(edit.value).toContain('Value: {{ score2 }}');
    expect(edit.value).toContain('Code: `{{ score }}`');
    expect(compileLocal(edit.value,{config:currentConfig}).ok).toBe(true);
  });
  it('inserts a supplied template and allocates fresh bindings on repeat', () => {
    const first = insertLocalComponent(config, 'example/rating', '', { start: 0, end: 0 });
    expect(first.value).toContain('<rating bind="score"');
    const compiledFirst = compileLocal(first.value, { config });
    expect(compiledFirst.ok, compiledFirst.ok ? '' : JSON.stringify(compiledFirst.diagnostics))
      .toBe(true);

    const second = insertLocalComponent(config, 'example/rating', first.value, {
      start: first.value.length,
      end: first.value.length,
    });
    expect(second.value).toContain('bind="score2"');
    const compiledSecond = compileLocal(second.value, { config });
    expect(compiledSecond.ok, compiledSecond.ok ? '' : JSON.stringify(compiledSecond.diagnostics))
      .toBe(true);
  });

  it('resolves native binding tokens and keeps shared tokens shared', () => {
    const edit = insertLocalComponent(config, 'number', '', { start: 0, end: 0 });
    expect(edit.value).toContain('bind="quantity"');
    expect(compileLocal(edit.value, { config }).ok).toBe(true);

    const shared = defineLocalComponent({
      id: 'example/link-pair',
      name: 'link-pair',
      version: '1.0.0',
      protocol: 'reactive-md-component/v1',
      form: 'container',
      props: { target: { kind: 'string', required: true } },
      capabilities: BOOLEAN_CAPABILITIES,
      authoring: {
        insertText: '<link-pair target="{{bind:target}}">\n<number bind="{{bind:target}}" label="Target">\n</link-pair>',
      },
    });
    const sharedConfig = createLocalConfig({ components: [shared] });
    const sharedEdit = insertLocalComponent(sharedConfig, 'example/link-pair', '', { start: 0, end: 0 });
    expect(sharedEdit.value).toContain('target="target"');
    expect(sharedEdit.value).toContain('bind="target"');
    expect(compileLocal(sharedEdit.value, { config: sharedConfig }).ok).toBe(true);
  });

  it('inserts synthesized templates and resolves selection/caret tokens', () => {
    const gauge = leafManifest({
      id: 'example/gauge',
      name: 'gauge',
      props: rating.props,
      bindings: rating.bindings,
    });
    const gaugeConfig = createLocalConfig({ components: [gauge] });
    const inserted = insertLocalComponent(gaugeConfig, 'example/gauge', '', { start: 0, end: 0 });
    expect(inserted.value).toBe('<gauge bind="gauge" label="">');
    expect(compileLocal(inserted.value, { config: gaugeConfig }).ok).toBe(true);

    const tip = leafManifest({
      id: 'example/tip',
      name: 'tip',
      form: 'inline',
      authoring: { insertText: '<tip>{{selection:Default text}}{{caret}}</tip>' },
    });
    const tipConfig = createLocalConfig({ components: [tip] });
    const fallback = insertLocalComponent(tipConfig, 'example/tip', '', { start: 0, end: 0 });
    const fallbackStart = fallback.value.indexOf('Default text');
    expect(fallback.selection).toEqual({
      start: fallbackStart,
      end: fallbackStart + 'Default text'.length,
    });
    const replaced = insertLocalComponent(tipConfig, 'example/tip', 'Old words', { start: 0, end: 9 });
    expect(replaced.value).toBe('<tip>Old words</tip>');
  });

  it('rejects unknown ids and invalid configs', () => {
    expect(() => insertLocalComponent(config, 'missing', '', { start: 0, end: 0 }))
      .toThrow(/Unknown local component/);
    expect(() => insertLocalComponent({
      protocol: 'reactive-md-config/v1',
      components: 'nope',
    } as unknown as LocalConfig, 'rating', '', { start: 0, end: 0 }))
      .toThrow(/components/);
  });
});

describe('validateLocalComponentInsertTemplates', () => {
  it('accepts templates that compile under the same config', () => {
    expect(validateLocalComponentInsertTemplates(config, 'en')).toEqual([]);
  });

  it('reports external templates that do not compile and skips native entries', () => {
    const broken = defineLocalComponent({
      ...rating,
      id: 'example/broken',
      name: 'broken',
      authoring: { insertText: '<broken bind="score">' },
    });
    const brokenConfig = createLocalConfig({ components: [broken] });
    const issues = validateLocalComponentInsertTemplates(brokenConfig, 'en');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: 'example/broken', name: 'broken' });
    expect(issues[0].diagnostics.length).toBeGreaterThan(0);
  });
});

describe('config-derived completion', () => {
  const options = { config } as unknown as LocalCompileOptions;

  it('completes external tags and paired closing tags, excluding leaves', () => {
    const opening = completeTags('<rat', 4, options);
    expect(opening).toContain('rating');

    const pairedClosing = completeTags('</hi', 4, options);
    expect(pairedClosing).toContain('hint');

    const leafClosing = completeTags('</rat', 5, options);
    expect(leafClosing).not.toContain('rating');
  });

  it('completes attributes lowered from manifests', () => {
    const source = '<hint ti';
    const completions = completeTags(source, source.length, options);
    expect(completions).toContain('title');
  });

  it('reports tag and attribute descriptions from the same config', () => {
    const lookup = createLocalAuthoringLookup(options);
    const ratingInfo = lookup.tag('rating');
    expect(ratingInfo).toMatchObject({
      name: 'rating',
      form: 'leaf',
      paired: false,
      title: 'Rating',
      description: 'A rating sharing a numeric binding.',
      category: 'input',
    });
    expect(ratingInfo?.insertText).toContain('<rating');
    expect(lookup.attribute('rating', 'label')).toMatchObject({
      name: 'label',
      kind: 'string',
      required: true,
      description: 'Rate this component',
    });
    expect(lookup.attribute('rating', 'max')?.defaultValue).toBe(5);
    expect(ratingInfo?.styles).toEqual(['example/rating.css']);
    expect(ratingInfo?.requires).toEqual({ kernel: '>=0.6.0' });

    const hintInfo = lookup.tag('hint');
    expect(hintInfo?.paired).toBe(true);
    expect(hintInfo?.form).toBe('container');
  });
});

function completeTags(source: string, offset: number, options: LocalCompileOptions) {
  return completeLocalSource(source, offset, options).map((completion) => completion.label);
}
