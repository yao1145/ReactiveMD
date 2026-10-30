import { describe, expect, it } from 'vitest';
import {
  createLocalConfig,
  localConfigKey,
  readLocalConfig,
} from '../src/sdk/config';
import {
  defineLocalComponent,
  localComponentDigest,
  readLocalComponentManifest,
} from '../src/sdk/manifest';
import {
  localComponentHostBinding,
  resolveLocalComponentBindingConstraints,
  resolveLocalComponentProps,
} from '../src/sdk/props';
import { defineLocalTheme } from '../src/sdk/theme';
import type { LocalComponentDefinition } from '../src/sdk/types';
import {
  LOCAL_SDK_VERSION,
  localVersionSatisfies,
  parseLocalVersionRange,
} from '../src/sdk/version';
import defaultPreset from '../src/presets/default';

const PROTOCOL = 'reactive-md-component/v1' as const;

function ratingManifest(): LocalComponentDefinition {
  return defineLocalComponent({
    id: 'example/rating',
    name: 'rating',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      label: { kind: 'string', required: true },
      max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
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
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function propsDefinition(): LocalComponentDefinition {
  return defineLocalComponent({
    id: 'example/probe',
    name: 'probe',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      label: { kind: 'string', required: true },
      max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
      zero: { kind: 'number', default: 5 },
      empty: { kind: 'string', default: 'fallback' },
      flag: { kind: 'boolean', default: false },
      mode: { kind: 'enum', enum: ['a', 'b'], default: 'a' },
      note: { kind: 'string' },
      frozen: { kind: 'string', static: true },
    },
    capabilities: { interactive: true, static: true, ssr: true, offline: false },
  });
}

function evaluateExpression(expression: string): string | number | boolean {
  if (expression === '2 + 3') return 5;
  if (expression === '"hi"') return 'hi';
  if (expression === 'true') return true;
  if (expression === '11') return 11;
  throw new Error(`unknown expression ${expression}`);
}

const runtime = {
  evaluate: evaluateExpression,
  text(template: string): string {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => String(evaluateExpression(expression)));
  },
};

describe('SDK manifest validation', () => {
  it('clones and deeply freezes a valid manifest', () => {
    const input = {
      id: 'example/rating',
      name: 'rating',
      version: '1.0.0',
      protocol: PROTOCOL,
      form: 'leaf' as const,
      props: {
        label: { kind: 'string' as const, required: true },
        max: { kind: 'number' as const, default: 5, min: 1, max: 10, integer: true },
      },
      bindings: {
        value: {
          kind: 'number' as const,
          family: 'number' as const,
          bind: 'bind' as const,
          initial: 'initial' as const,
          initialRule: 'nearest-zero' as const,
          constraints: { min: { literal: 0 }, max: { prop: 'max' } },
        },
      },
      capabilities: { interactive: true, static: true, ssr: true, offline: true },
    };
    const definition = defineLocalComponent(input);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.props)).toBe(true);
    expect(Object.isFrozen(definition.props.max)).toBe(true);
    expect(Object.isFrozen(definition.bindings)).toBe(true);
    input.props.max.default = 7;
    expect(definition.props.max.default).toBe(5);
  });

  it('rejects an unsupported protocol or version', () => {
    const base = ratingManifest();
    expect(() => readLocalComponentManifest({ ...base, protocol: 'v2' })).toThrow(/protocol/);
    expect(() => readLocalComponentManifest({ ...base, version: 'latest' })).toThrow(/version/);
  });

  it('rejects conflicting static/dynamic flags', () => {
    expect(() => defineLocalComponent({
      ...ratingManifest(),
      props: { size: { kind: 'string', static: true, dynamic: true } },
    })).toThrow(/static and dynamic/);
  });

  it('rejects a default that violates its own declaration', () => {
    expect(() => defineLocalComponent({
      ...ratingManifest(),
      props: { level: { kind: 'number', integer: true, min: 1, default: 2.5 } },
    })).toThrow(/integer/);
    expect(() => defineLocalComponent({
      ...ratingManifest(),
      props: { tone: { kind: 'enum', enum: ['a', 'b'], default: 'c' } },
    })).toThrow(/enum value/);
  });

  it('rejects a backtracking-prone pattern', () => {
    expect(() => defineLocalComponent({
      ...ratingManifest(),
      props: { code: { kind: 'string', pattern: '^(a+)+$' } },
    })).toThrow(/regex syntax/);
  });

  it('rejects unknown fields and unsafe keys', () => {
    expect(() => readLocalComponentManifest({ ...ratingManifest(), extra: true })).toThrow(/unknown field/);
    const polluted = JSON.parse('{"id":"example/x","name":"x","version":"1.0.0","protocol":"reactive-md-component/v1","form":"leaf","props":{},"capabilities":{},"__proto__":{"polluted":true}}');
    expect(() => readLocalComponentManifest(polluted)).toThrow(/not allowed/);
  });

  it('rejects a binding constraint that references a missing or non-number prop', () => {
    const base = ratingManifest();
    const bindings = {
      value: {
        ...base.bindings!.value,
        constraints: { max: { prop: 'missing' } },
      },
    };
    expect(() => readLocalComponentManifest({ ...base, bindings })).toThrow(/undeclared prop/);
    const wrongKind = {
      value: {
        ...base.bindings!.value,
        constraints: { max: { prop: 'label' } },
      },
    };
    expect(() => readLocalComponentManifest({ ...base, bindings: wrongKind })).toThrow(/not a number/);
  });

  it('rejects body rules incompatible with the tag form', () => {
    const base = ratingManifest();
    expect(() => readLocalComponentManifest({ ...base, children: { kind: 'markdown' } })).toThrow(/leaf/);
    expect(() => readLocalComponentManifest({
      ...base,
      form: 'container',
      children: { kind: 'none', required: true },
    })).toThrow(/require/);
  });

  it('produces a stable digest independent of property order', () => {
    const first = ratingManifest();
    const second = defineLocalComponent({
      version: '1.0.0',
      name: 'rating',
      id: 'example/rating',
      protocol: PROTOCOL,
      form: 'leaf',
      capabilities: { offline: true, ssr: true, static: true, interactive: true },
      props: {
        max: { integer: true, max: 10, min: 1, default: 5, dynamic: true, kind: 'number' },
        label: { required: true, kind: 'string' },
      },
      bindings: {
        value: {
          constraints: {
            step: { literal: 1 },
            max: { prop: 'max' },
            min: { literal: 0 },
          },
          initialRule: 'nearest-zero',
          initial: 'initial',
          bind: 'bind',
          family: 'number',
          kind: 'number',
        },
      },
    });
    expect(localComponentDigest(first)).toBe(localComponentDigest(second));
    const changed = defineLocalComponent({
      ...first,
      props: { ...first.props, max: { ...first.props.max, default: 4 } },
    });
    expect(localComponentDigest(changed)).not.toBe(localComponentDigest(first));
  });

  it('accepts bounded, deduplicated component style ids', () => {
    const definition = defineLocalComponent({
      ...ratingManifest(),
      styles: ['example/rating.css', 'paper.css'],
    });
    expect(definition.styles).toEqual(['example/rating.css', 'paper.css']);
    expect(() => defineLocalComponent({
      ...ratingManifest(),
      styles: ['duplicate.css', 'duplicate.css'],
    })).toThrow(/more than once/);
    expect(() => defineLocalComponent({
      ...ratingManifest(),
      styles: Array.from({ length: 33 }, (_, index) => `style-${index}.css`),
    })).toThrow(/at most/);
  });

  it('excludes authoring metadata and prop descriptions from the semantic digest', () => {
    const base = ratingManifest();
    const decorated = defineLocalComponent({
      ...base,
      authoring: {
        title: { en: 'Rating', zh: '评分' },
        description: { en: 'Pick a score.', zh: '选择一个评分。' },
        category: 'input',
        insertText: '<rating bind="score" label="Rating">',
      },
      props: {
        ...base.props,
        label: { ...base.props.label, description: { en: 'Visible label', zh: '可见标签' } },
      },
    });
    expect(decorated.props.label.description).toEqual({ en: 'Visible label', zh: '可见标签' });
    expect(decorated.authoring?.title).toEqual({ en: 'Rating', zh: '评分' });
    expect(localComponentDigest(decorated)).toBe(localComponentDigest(base));

    const changedDefault = defineLocalComponent({
      ...base,
      props: { ...base.props, max: { ...base.props.max, default: 4 } },
    });
    const changedCapability = defineLocalComponent({
      ...base,
      capabilities: { ...base.capabilities, offline: false },
    });
    const changedDependency = defineLocalComponent({
      ...base,
      dependencies: [{ id: 'reactive-md/number', version: '>=0.6.0' }],
    });
    const changedBinding = defineLocalComponent({
      ...base,
      bindings: {
        value: {
          ...base.bindings!.value,
          constraints: { ...base.bindings!.value.constraints!, step: { literal: 2 } },
        },
      },
    });
    const changedStyles = defineLocalComponent({ ...base, styles: ['example/rating.css'] });
    for (const changed of [changedDefault, changedCapability, changedDependency, changedBinding, changedStyles]) {
      expect(localComponentDigest(changed)).not.toBe(localComponentDigest(base));
    }
  });

  it('supports declarative choice options and rejects unsupported families', () => {
    const choice = defineLocalComponent({
      id: 'example/choice',
      name: 'choice',
      version: '1.0.0',
      protocol: PROTOCOL,
      form: 'leaf',
      props: { label: { kind: 'string' } },
      bindings: {
        value: {
          kind: 'string',
          family: 'choice',
          bind: 'bind',
          initial: 'initial',
          initialRule: 'first-option',
          options: ['a', 'b'],
        },
      },
      capabilities: { interactive: true, static: true, ssr: true, offline: false },
    });
    expect(localComponentHostBinding(choice)).toMatchObject({
      kind: 'string',
      options: ['a', 'b'],
      initialRule: 'first-option',
    });
    expect(() => defineLocalComponent({
      ...choice,
      bindings: {
        value: {
          kind: 'string',
          family: 'choice',
          bind: 'bind',
          initial: 'initial',
          initialRule: 'first-option',
        },
      },
    })).toThrow(/required for a choice/);
    expect(() => defineLocalComponent({
      ...choice,
      bindings: {
        value: {
          kind: 'string',
          family: 'date',
          bind: 'bind',
          initial: 'initial',
          initialRule: 'empty',
        },
      },
    })).toThrow(/not supported/);
    expect(() => defineLocalComponent({
      ...choice,
      bindings: {
        value: {
          kind: 'number',
          family: 'number',
          bind: 'bind',
          initial: 'initial',
          initialRule: 'nearest-zero',
          options: ['a'],
        },
      },
    })).toThrow(/only valid for a string/);
  });

  it('parses bounded version ranges and rejects unsupported syntax', () => {
    expect(localVersionSatisfies(LOCAL_SDK_VERSION, '^0.6.0')).toBe(true);
    expect(localVersionSatisfies('1.0.0', '^0.6.0')).toBe(false);
    expect(localVersionSatisfies('0.6.5', '~0.6.1')).toBe(true);
    expect(localVersionSatisfies('0.7.0', '~0.6.1')).toBe(false);
    expect(localVersionSatisfies('0.9.9', '>=0.6.0 <1.0.0')).toBe(true);
    expect(localVersionSatisfies('1.0.0', '>=0.6.0 <1.0.0')).toBe(false);
    expect(localVersionSatisfies('1.2.3', '1.2.3')).toBe(true);
    expect(localVersionSatisfies('1.2.4', '1.2.3')).toBe(false);
    for (const unsupported of ['*', '>=1 || <2', 'latest', '^ 1.0.0', '1.2', 'x']) {
      expect(parseLocalVersionRange(unsupported)).toBeNull();
    }
  });

  it('checks dependency versions and kernel requirements', () => {
    const base = ratingManifest();
    const dependent = defineLocalComponent({
      ...base,
      id: 'example/dependent',
      name: 'dependent',
      dependencies: [{ id: 'example/rating', version: '^1.0.0' }],
    });
    expect(createLocalConfig({ components: [base, dependent] }).components).toHaveLength(2);

    const wrongVersion = defineLocalComponent({
      ...base,
      id: 'example/wrong',
      name: 'wrong',
      dependencies: [{ id: 'example/rating', version: '^2.0.0' }],
    });
    expect(() => createLocalConfig({ components: [base, wrongVersion] })).toThrow(/requires "example\/rating"/);

    const builtinDependency = defineLocalComponent({
      ...base,
      id: 'example/builtin-dependency',
      name: 'builtin-dependency',
      dependencies: [{ id: 'reactive-md/number', version: '>=0.6.0' }],
    });
    expect(createLocalConfig({ components: [builtinDependency] })).toBeTruthy();

    const compatibleKernel = defineLocalComponent({
      ...base,
      id: 'example/kernel',
      name: 'kernel',
      requires: { kernel: '>=0.6.0 <1.0.0' },
    });
    expect(createLocalConfig({ components: [compatibleKernel] }).key).toMatch(/^rmd-/);

    const futureKernel = defineLocalComponent({
      ...base,
      id: 'example/future',
      name: 'future',
      requires: { kernel: '^1.0.0' },
    });
    expect(() => createLocalConfig({ components: [futureKernel] })).toThrow(/kernel/);
    expect(() => defineLocalComponent({ ...base, requires: { kernel: '*' } })).toThrow(/kernel version range/);
  });

  it('exposes the frozen default preset descriptor', () => {
    expect(defaultPreset).toEqual({ id: 'reactive-md/default', version: '0.6.1' });
    expect(Object.isFrozen(defaultPreset)).toBe(true);
  });
});

describe('SDK configuration', () => {
  it('defaults to the default preset and freezes the snapshot', () => {
    const config = createLocalConfig({ components: [ratingManifest()] });
    expect(config.protocol).toBe('reactive-md-config/v1');
    expect(config.presets).toEqual([{ id: 'reactive-md/default', version: '0.6.1' }]);
    expect(config.themes).toEqual([]);
    expect(config.key).toMatch(/^rmd-[0-9a-f]{16}$/);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.components)).toBe(true);
    expect(Object.isFrozen(config.components[0])).toBe(true);
  });

  it('rejects duplicate and reserved component names', () => {
    const rating = ratingManifest();
    expect(() => createLocalConfig({ components: [rating, rating] })).toThrow(/declared more than once/);
    const duplicateName = defineLocalComponent({ ...rating, id: 'example/other' });
    expect(() => createLocalConfig({ components: [rating, duplicateName] })).toThrow(/name/);
    const builtin = defineLocalComponent({ ...rating, id: 'example/number', name: 'number' });
    expect(() => createLocalConfig({ components: [builtin] })).toThrow(/conflicts with a built-in/);
  });

  it('rejects unsupported preset selections', () => {
    expect(() => createLocalConfig({ presets: ['example/custom'] })).toThrow(/unsupported preset/);
    expect(() => createLocalConfig({ presets: [{ id: 'reactive-md/default', version: '9.9.9' }] })).toThrow(/version/);
    expect(createLocalConfig({ presets: ['default'] }).presets[0].id).toBe('reactive-md/default');
  });

  it('rejects missing component dependencies and cycles', () => {
    const rating = ratingManifest();
    const dependent = defineLocalComponent({
      ...rating,
      id: 'example/dependent',
      name: 'dependent',
      dependencies: [{ id: 'example/missing' }],
    });
    expect(() => createLocalConfig({ components: [dependent] })).toThrow(/missing component/);
    const first = defineLocalComponent({
      ...rating, id: 'example/first', name: 'first', dependencies: [{ id: 'example/second' }],
    });
    const second = defineLocalComponent({
      ...rating, id: 'example/second', name: 'second', dependencies: [{ id: 'example/first' }],
    });
    expect(() => createLocalConfig({ components: [first, second] })).toThrow(/cycle/);
  });

  it('recomputes the key on read and ignores a supplied stale key', () => {
    const config = createLocalConfig({ components: [ratingManifest()] });
    const snapshot = structuredClone(config);
    expect(snapshot.key).toBe(config.key);
    const tampered = { ...snapshot, key: 'rmd-0000000000000000' };
    expect(readLocalConfig(tampered).key).toBe(config.key);
    const changed = createLocalConfig({
      components: [defineLocalComponent({ ...ratingManifest(), version: '1.0.1' })],
    });
    expect(changed.key).not.toBe(config.key);
    expect(localConfigKey(tampered)).toBe(config.key);
  });

  it('rejects an invalid worker snapshot', () => {
    expect(() => readLocalConfig({ protocol: 'reactive-md-config/v1', presets: ['default'], components: 'nope', themes: [] }))
      .toThrow(/components/);
    expect(() => readLocalConfig({ protocol: 'nope', presets: ['default'], components: [], themes: [] }))
      .toThrow(/protocol/);
  });

  it('validates theme packages structurally', () => {
    const theme = {
      id: 'example/paper',
      name: 'paper',
      version: '1.0.0',
      protocol: 'reactive-md-theme-1',
      colorSchemes: ['light', 'dark'],
      css: [{ id: 'tokens', css: '[data-rmd-theme="paper"] { --accent: green; }' }],
    };
    const config = createLocalConfig({ themes: [theme as never] });
    expect(config.themes).toHaveLength(1);
    expect(Object.isFrozen(config.themes[0])).toBe(true);
    expect(() => createLocalConfig({ themes: [{ ...theme, name: 'default' } as never] })).toThrow(/reserved/);
    expect(() => createLocalConfig({ themes: [{ ...theme, colorSchemes: ['light'] } as never] })).toThrow(/light.*dark|both/);
  });
  it('revalidates themes through the theme scoper', () => {
    const raw = {
      id: 'example/paper',
      name: 'paper',
      version: '1.0.0',
      protocol: 'reactive-md-theme-1',
      colorSchemes: ['light', 'dark'],
      css: [{ id: 'paper.css', css: '.card { color: red; }' }],
    };
    const config = createLocalConfig({ themes: [raw as never] });
    expect(config.themes[0].css[0].css).toContain('[data-rmd-theme="paper"] .card');
    expect(() => createLocalConfig({
      themes: [{ ...raw, css: [{ id: 'paper.css', css: ':root { --ink: black; }' }] } as never],
    })).toThrow(/host document/);
    expect(() => createLocalConfig({
      themes: [{ ...raw, css: [{ id: 'paper.css', css: '.a { background: url(https://example.com/x) }' }] } as never],
    })).toThrow(/data:/);
  });

  it('keeps themes and editor copy out of the configuration key', () => {
    const rating = ratingManifest();
    const first = defineLocalTheme({
      id: 'example/paper',
      name: 'paper',
      version: '1.0.0',
      css: [{ id: 'paper.css', css: '[data-rmd-theme="paper"] { --accent: green; }' }],
    });
    const second = defineLocalTheme({
      id: 'example/paper',
      name: 'paper',
      version: '1.0.0',
      css: [{ id: 'paper.css', css: '[data-rmd-theme="paper"] { --accent: blue; }' }],
    });
    const plain = createLocalConfig({ components: [rating] });
    const themed = createLocalConfig({ components: [rating], themes: [first] });
    const restyled = createLocalConfig({ components: [rating], themes: [second] });
    expect(themed.key).toBe(plain.key);
    expect(restyled.key).toBe(plain.key);

    const decorated = createLocalConfig({
      components: [defineLocalComponent({
        ...rating,
        authoring: { title: { en: 'Rating' }, insertText: '<rating bind="score" label="x">' },
      })],
    });
    expect(decorated.key).toBe(plain.key);

    const changed = createLocalConfig({
      components: [defineLocalComponent({
        ...rating,
        props: { ...rating.props, max: { ...rating.props.max, default: 4 } },
      })],
    });
    expect(changed.key).not.toBe(plain.key);

    const capabilityChanged = createLocalConfig({
      components: [defineLocalComponent({
        ...rating,
        capabilities: { ...rating.capabilities, offline: false },
      })],
    });
    expect(capabilityChanged.key).not.toBe(plain.key);

    const bindingChanged = createLocalConfig({
      components: [defineLocalComponent({
        ...rating,
        bindings: {
          value: {
            ...rating.bindings!.value,
            constraints: { ...rating.bindings!.value.constraints!, step: { literal: 2 } },
          },
        },
      })],
    });
    expect(bindingChanged.key).not.toBe(plain.key);
  });
});

describe('SDK prop normalization', () => {
  it('fills defaults and reports missing optional props as null', () => {
    const definition = propsDefinition();
    const props = resolveLocalComponentProps(definition, { label: 'Rate' }, runtime);
    expect(props).toEqual({
      label: 'Rate',
      max: 5,
      zero: 5,
      empty: 'fallback',
      flag: false,
      mode: 'a',
      note: null,
      frozen: null,
    });
    expect(Object.isFrozen(props)).toBe(true);
  });

  it('keeps explicit 0, false and empty strings instead of defaults', () => {
    const definition = propsDefinition();
    const props = resolveLocalComponentProps(
      definition,
      { label: '', zero: '0', empty: '', flag: 'false', mode: 'b' },
      runtime,
    );
    expect(props.zero).toBe(0);
    expect(props.empty).toBe('');
    expect(props.flag).toBe(false);
    expect(props.mode).toBe('b');
  });

  it('accepts one full typed interpolation and mixed text for strings', () => {
    const definition = propsDefinition();
    expect(resolveLocalComponentProps(definition, { label: '{{ "hi" }}' }, runtime).label).toBe('hi');
    expect(resolveLocalComponentProps(definition, { label: 'pre {{ "hi" }} post' }, runtime).label).toBe('pre hi post');
    expect(resolveLocalComponentProps(definition, { label: 'x', max: '{{ 2 + 3 }}' }, runtime).max).toBe(5);
    expect(resolveLocalComponentProps(definition, { label: 'x', flag: '{{ true }}' }, runtime).flag).toBe(true);
  });

  it('throws descriptively for missing required, invalid and out-of-range values', () => {
    const definition = propsDefinition();
    expect(() => resolveLocalComponentProps(definition, {}, runtime)).toThrow(/required/);
    expect(() => resolveLocalComponentProps(definition, { label: 'x', max: 'abc' }, runtime)).toThrow(/number/);
    expect(() => resolveLocalComponentProps(definition, { label: 'x', max: '2.5' }, runtime)).toThrow(/integer/);
    expect(() => resolveLocalComponentProps(definition, { label: 'x', max: '11' }, runtime)).toThrow(/at most 10/);
    expect(() => resolveLocalComponentProps(definition, { label: 'x', mode: 'c' }, runtime)).toThrow(/one of/);
    expect(() => resolveLocalComponentProps(definition, { label: 'x', frozen: '{{ "y" }}' }, runtime)).toThrow(/static/);
    expect(() => resolveLocalComponentProps(definition, { label: 'x', max: '1 {{ 2 }}' }, runtime)).toThrow(/number literal/);
    expect(() => resolveLocalComponentProps(definition, { label: 'x', unknown: 'y' }, runtime)).toThrow(/does not declare/);
  });
});

describe('SDK binding constraints', () => {
  it('resolves literal bounds and prop references from attributes or defaults', () => {
    const definition = ratingManifest();
    expect(resolveLocalComponentBindingConstraints(definition, {})).toEqual({ min: 0, max: 5, step: 1 });
    expect(resolveLocalComponentBindingConstraints(definition, { max: '8' })).toEqual({ min: 0, max: 8, step: 1 });
    expect(resolveLocalComponentBindingConstraints(definition, { max: '{{ 2 + 3 }}' })).toEqual({ min: 0, step: 1 });
  });

  it('lowers literal constraints to the host binding shape', () => {
    const definition = ratingManifest();
    const binding = localComponentHostBinding(definition);
    expect(binding).toEqual({ kind: 'number', initialRule: 'nearest-zero', min: 0, step: 1 });
  });
});
