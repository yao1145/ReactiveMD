import { describe, expect, it } from 'vitest';
import {
  createLocalAuthoringLookup,
  createLocalComponentCatalog,
  createLocalComponentCatalogForOptions,
  filterLocalComponentCatalog,
  insertLocalComponentFromOptions,
  localCatalogAncestors,
  localComponentCatalogGroups,
  localComponentCatalogKey,
  localComponentHelp,
  validateLocalComponentInsertTemplates,
} from '../src/authoring';
import { compileLocal } from '../src/local/compiler';
import type { LocalCompileOptions } from '../src/local';
import { localCompileOptionsKey } from '../src/local/options';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent } from '../src/sdk/manifest';
import type { LocalComponentDefinition } from '../src/sdk/types';

const CAPABILITIES = {
  interactive: true,
  static: true,
  ssr: true,
  offline: true,
} as const;

function external(input: {
  id: string;
  name: string;
  form?: LocalComponentDefinition['form'];
  props?: LocalComponentDefinition['props'];
  bindings?: LocalComponentDefinition['bindings'];
  structure?: LocalComponentDefinition['structure'];
  authoring: NonNullable<LocalComponentDefinition['authoring']>;
}): LocalComponentDefinition {
  return defineLocalComponent({
    id: input.id,
    name: input.name,
    version: '1.0.0',
    protocol: 'reactive-md-component/v1',
    form: input.form ?? 'leaf',
    props: input.props ?? {},
    ...(input.bindings ? { bindings: input.bindings } : {}),
    ...(input.structure ? { structure: input.structure } : {}),
    capabilities: CAPABILITIES,
    authoring: input.authoring,
  });
}

const rating = external({
  id: 'example/rating',
  name: 'rating',
  props: {
    label: {
      kind: 'string',
      required: true,
      description: { en: 'Rate this component', zh: '请评分' },
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
    },
  },
  authoring: {
    title: { en: 'Rating', zh: '评分' },
    description: { en: 'A rating sharing a numeric binding.', zh: '与数字控件共享绑定的评分。' },
    category: 'input',
    insertText: '<rating bind="{{bind:score}}" label="Rating" initial="3">',
  },
});

const hostBox = external({
  id: 'example/host-box',
  name: 'host-box',
  form: 'container',
  structure: { rule: 'any', label: 'none' },
  authoring: {
    title: { en: 'Host box' },
    description: { en: 'A neutral external container.' },
    category: 'layout',
    insertText: '<host-box>\n\n</host-box>',
  },
});

const hostSlot = external({
  id: 'example/host-slot',
  name: 'host-slot',
  structure: { rule: 'none', label: 'none', parents: ['host-box'] },
  authoring: {
    title: { en: 'Host slot' },
    description: { en: 'Only valid inside a host box.' },
    category: 'layout',
    insertText: '<host-slot>',
  },
});

const exclusive = external({
  id: 'example/exclusive',
  name: 'exclusive',
  form: 'container',
  structure: {
    rule: 'components',
    label: 'none',
    child: 'inner-item',
    children: ['inner-item'],
    min: 1,
  },
  authoring: {
    title: { en: 'Exclusive container' },
    description: { en: 'Accepts only inner items.' },
    category: 'layout',
    insertText: '<exclusive>\n<inner-item>\n\n</inner-item>\n</exclusive>',
  },
});

const innerItem = external({
  id: 'example/inner-item',
  name: 'inner-item',
  form: 'container',
  structure: { rule: 'any', label: 'none', parents: ['exclusive'] },
  authoring: {
    title: { en: 'Inner item' },
    description: { en: 'Only valid inside an exclusive container.' },
    category: 'layout',
    insertText: '<inner-item>\n\n</inner-item>',
  },
});

const config = createLocalConfig({ components: [rating, hostBox, hostSlot, exclusive, innerItem] });
const options = { config } as LocalCompileOptions;

function entryNamed(name: string, opts: LocalCompileOptions | undefined = options) {
  const entry = createLocalComponentCatalogForOptions(opts, 'en').find((item) => item.name === name);
  if (!entry) throw new Error(`Missing catalog entry ${name}`);
  return entry;
}

describe('P3.1 manifest-derived catalog', () => {
  it('projects the default preset and keeps the legacy compatibility catalog aligned', () => {
    const catalog = createLocalComponentCatalog(createLocalConfig({}), 'en');
    expect(catalog).toHaveLength(34);
    expect(catalog.find((entry) => entry.name === 'number')).toMatchObject({
      title: 'Number input',
      category: 'input',
      categoryLabel: 'Input controls',
    });
    expect(catalog.find((entry) => entry.name === 'range-slider')?.form).toBe('leaf');
    expect(catalog.find((entry) => entry.name === 'badge')?.inline).toBe(true);

    const zh = createLocalComponentCatalog(createLocalConfig({}), 'zh');
    expect(zh.find((entry) => entry.name === 'number')?.title).toBe('数字输入');
    expect(zh.find((entry) => entry.name === 'number')?.insertText).toContain('label="数量"');
  });

  it('includes external manifests with localized copy and property help', () => {
    const entry = entryNamed('rating');
    expect(entry).toMatchObject({
      id: 'example/rating',
      name: 'rating',
      title: 'Rating',
      description: 'A rating sharing a numeric binding.',
      category: 'input',
      categoryLabel: 'Input controls',
      paired: false,
    });
    expect(entry.props.label.description).toBe('Rate this component');
    expect(localComponentHelp(entry)).toContain('Rate this component');

    const zh = createLocalComponentCatalogForOptions(options, 'zh').find((item) => item.name === 'rating');
    expect(zh?.title).toBe('评分');
    expect(zh?.props.label.description).toBe('请评分');

    // Missing locale falls back explicitly to the other declaration.
    const onlyChinese = external({
      id: 'example/only-zh',
      name: 'only-zh',
      authoring: { title: { zh: '仅中文' }, insertText: '<only-zh>' },
    });
    const fallback = createLocalComponentCatalogForOptions(
      { config: createLocalConfig({ components: [onlyChinese] }) } as LocalCompileOptions,
      'en',
    ).find((item) => item.name === 'only-zh');
    expect(fallback?.title).toBe('仅中文');

    // Authoring descriptions are literal text; no HTML parsing or stripping.
    const literal = external({
      id: 'example/literal-copy',
      name: 'literal-copy',
      authoring: {
        title: { en: 'Literal copy' },
        description: { en: '<b>Not markup</b>' },
        insertText: '<literal-copy>',
      },
    });
    const literalEntry = createLocalComponentCatalogForOptions(
      { config: createLocalConfig({ components: [literal] }) } as LocalCompileOptions,
      'en',
    ).find((item) => item.name === 'literal-copy');
    expect(literalEntry?.description).toBe('<b>Not markup</b>');
    expect(localComponentHelp(literalEntry!)).toContain('<b>Not markup</b>');
  });

  it('groups and searches the same catalog the menu consumes', () => {
    const catalog = createLocalComponentCatalogForOptions(options, 'en');
    const groups = localComponentCatalogGroups(catalog);
    expect(groups.map((group) => group.id).slice(0, 5))
      .toEqual(['input', 'action', 'layout', 'data', 'hint']);
    expect(groups.find((group) => group.id === 'input')?.entries.some((entry) => entry.name === 'rating'))
      .toBe(true);

    const search = filterLocalComponentCatalog(catalog, { query: 'rating' });
    expect(search.map((entry) => entry.name)).toContain('rating');
    const zhCatalog = createLocalComponentCatalogForOptions(options, 'zh');
    expect(filterLocalComponentCatalog(zhCatalog, { query: '评' }).map((entry) => entry.name))
      .toContain('rating');
    expect(filterLocalComponentCatalog(catalog, { query: 'no-such-component' })).toHaveLength(0);
  });

  it('applies structural parent and exclusive-child context filters', () => {
    const catalog = createLocalComponentCatalogForOptions(options, 'en');
    const rootNames = filterLocalComponentCatalog(catalog).map((entry) => entry.name);
    expect(rootNames).toContain('host-box');
    expect(rootNames).not.toContain('host-slot');
    expect(rootNames).not.toContain('inner-item');

    const box = '<host-box>\n\n</host-box>';
    const boxOffset = '<host-box>'.length;
    expect(localCatalogAncestors(box, boxOffset, options)).toEqual(['host-box']);
    const boxNames = filterLocalComponentCatalog(catalog, { ancestors: ['host-box'] })
      .map((entry) => entry.name);
    expect(boxNames).toContain('host-slot');
    expect(boxNames).toContain('host-box');

    const exclusiveSource = '<exclusive>\n<inner-item>\n\n</inner-item>\n</exclusive>';
    const exclusiveOffset = '<exclusive>'.length;
    expect(localCatalogAncestors(exclusiveSource, exclusiveOffset, options)).toEqual(['exclusive']);
    const exclusiveNames = filterLocalComponentCatalog(catalog, { ancestors: ['exclusive'] })
      .map((entry) => entry.name);
    expect(exclusiveNames).toEqual(['inner-item']);
  });

  it('synthesizes only templates that compile and inserts fresh bindings', () => {
    const gauge = external({
      id: 'example/gauge',
      name: 'gauge',
      props: {
        label: { kind: 'string', required: true },
        max: { kind: 'number', default: 5, min: 1, max: 10, integer: true },
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
      authoring: { title: { en: 'Gauge' } },
    });
    const gaugeConfig = createLocalConfig({ components: [gauge] });
    const gaugeOptions = { config: gaugeConfig } as LocalCompileOptions;
    expect(entryNamed('gauge', gaugeOptions).insertText).toBe('<gauge bind="gauge" label="">');

    const first = insertLocalComponentFromOptions(gaugeOptions, 'example/gauge', '', { start: 0, end: 0 }, 'en');
    expect(first.value).toBe('<gauge bind="gauge" label="">');
    expect(compileLocal(first.value, gaugeOptions).ok).toBe(true);

    const second = insertLocalComponentFromOptions(
      gaugeOptions,
      'example/gauge',
      first.value,
      { start: first.value.length, end: first.value.length },
      'en',
    );
    expect(second.value).toContain('bind="gauge2"');
    expect(compileLocal(second.value, gaugeOptions).ok).toBe(true);
  });

  it('rejects a synthesized template that does not compile, naming the component', () => {
    const probe = external({
      id: 'example/probe',
      name: 'probe',
      props: { label: { kind: 'string', required: true } },
      authoring: { title: { en: 'Probe' } },
    });
    // `nonempty` makes the empty synthesized label illegal; the manifest must
    // therefore supply authoring.insertText.
    const withRule = defineLocalComponent({
      ...probe,
      rules: [{ kind: 'nonempty', attribute: 'label' } as const],
    });
    const probeOptions = { config: createLocalConfig({ components: [withRule] }) } as LocalCompileOptions;
    expect(() => createLocalComponentCatalogForOptions(probeOptions, 'en'))
      .toThrow(/component "probe".*does not compile.*authoring\.insertText/);
  });

  it('rebuilds menu data when the configuration or locale changes', () => {
    const base = createLocalConfig({ components: [rating] });
    const extended = createLocalConfig({ components: [rating, hostBox] });
    const baseOptions = { config: base } as LocalCompileOptions;
    const extendedOptions = { config: extended } as LocalCompileOptions;
    expect(createLocalComponentCatalogForOptions(baseOptions, 'en').some((entry) => entry.name === 'host-box'))
      .toBe(false);
    expect(createLocalComponentCatalogForOptions(extendedOptions, 'en').some((entry) => entry.name === 'host-box'))
      .toBe(true);
    expect(localCompileOptionsKey(baseOptions)).not.toBe(localCompileOptionsKey(extendedOptions));
  });

  it('exposes the same external attributes through the authoring lookup', () => {
    const lookup = createLocalAuthoringLookup(options, 'en');
    expect(lookup.tag('rating')).toMatchObject({
      title: 'Rating',
      category: 'input',
      paired: false,
    });
    expect(lookup.attribute('rating', 'label')).toMatchObject({
      required: true,
      description: 'Rate this component',
    });
    expect(lookup.tag('host-slot')?.parents).toEqual(['host-box']);
  });

  it('compiles supplied templates after token expansion and parent context', () => {
    // `rating` uses `{{bind:score}}`, `host-slot` is parent-only, and
    // `exclusive` declares required children; all are supplied templates.
    expect(() => createLocalComponentCatalogForOptions(options, 'en')).not.toThrow();
    expect(entryNamed('rating').insertText).toContain('{{bind:score}}');
    expect(entryNamed('host-slot').insertText).toBe('<host-slot>');

    // The raw parent-only snippet is illegal at the root; the catalog accepts it
    // only because it validates inside its declared parent.
    expect(compileLocal('<host-slot>', options).ok).toBe(false);
  });

  it('rejects supplied external templates that do not compile', () => {
    const broken = external({
      id: 'example/broken-template',
      name: 'broken-template',
      props: { label: { kind: 'string', required: true } },
      authoring: { title: { en: 'Broken template' }, insertText: '<broken-template>' },
    });
    const brokenConfig = createLocalConfig({ components: [broken] });
    const brokenOptions = { config: brokenConfig } as LocalCompileOptions;

    expect(() => createLocalComponentCatalogForOptions(brokenOptions, 'en'))
      .toThrow(/component "broken-template".*authoring\.insertText.*does not compile/);
    expect(() => createLocalComponentCatalog(brokenConfig, 'en'))
      .toThrow(/component "broken-template"/);

    // Conformance reporting still names every bad entry instead of aborting.
    const issues = validateLocalComponentInsertTemplates(brokenConfig, 'en');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: 'example/broken-template',
      name: 'broken-template',
    });
    expect(issues[0].diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects an invalid parent-only child even inside its legal parent', () => {
    const badSlot = external({
      id: 'example/bad-slot',
      name: 'bad-slot',
      structure: { rule: 'none', label: 'none', parents: ['host-box'] },
      authoring: { title: { en: 'Bad slot' }, insertText: '<bad-slot bogus="1">' },
    });
    const badOptions = {
      config: createLocalConfig({ components: [hostBox, badSlot] }),
    } as LocalCompileOptions;
    expect(() => createLocalComponentCatalogForOptions(badOptions, 'en'))
      .toThrow(/component "bad-slot".*does not compile/);
  });

  it('rebuilds catalog data for authoring-only configuration changes', () => {
    const renamed = defineLocalComponent({
      ...rating,
      authoring: {
        ...(rating.authoring ?? {}),
        title: { en: 'Rating alias', zh: '评分别名' },
      },
    });
    const base = createLocalConfig({ components: [rating] });
    const other = createLocalConfig({ components: [renamed] });
    const baseOptions = { config: base } as LocalCompileOptions;
    const otherOptions = { config: other } as LocalCompileOptions;

    // Authoring copy is excluded from the semantic compile key by design.
    expect(localCompileOptionsKey(baseOptions)).toBe(localCompileOptionsKey(otherOptions));
    expect(base.key).toBe(other.key);
    // The catalog key must still change so the menu does not keep stale copy.
    expect(localComponentCatalogKey(baseOptions, 'en'))
      .not.toBe(localComponentCatalogKey(otherOptions, 'en'));
    expect(createLocalComponentCatalogForOptions(otherOptions, 'en')
      .find((entry) => entry.name === 'rating')?.title).toBe('Rating alias');

    // Equivalent configurations produce an identical key and reuse the memo.
    const same = createLocalConfig({ components: [rating] });
    expect(localComponentCatalogKey({ config: same } as LocalCompileOptions, 'en'))
      .toBe(localComponentCatalogKey(baseOptions, 'en'));
  });
});
