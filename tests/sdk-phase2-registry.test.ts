import { describe, expect, it } from 'vitest';
import {
  LOCAL_COMPONENTS,
  LOCAL_COMPONENT_NAMES,
  LOCAL_KERNEL_DECLARATIONS,
  getLocalComponent,
  localComponentNames,
} from '../src/local/schema';
import { readLocalCompileOptions } from '../src/local/options';
import { parseLocal } from '../src/local/parser';
import {
  DEFAULT_COMPONENT_DEFINITIONS,
  DEFAULT_COMPONENT_NAMES,
  componentSchemaFromDefinition,
  getLocalComponentDefinition,
  getLocalComponentRegistry,
  localComponentSchemas,
} from '../src/sdk/registry';
import {
  defineLocalComponent,
  readLocalComponentManifest,
} from '../src/sdk/manifest';
import { resolveLocalComponentProps } from '../src/sdk/props';
import { createLocalConfig } from '../src/sdk/config';
import defaultPreset from '../src/presets/default';
import type { LocalComponentDefinition, LocalConfig } from '../src/sdk/types';

const PROTOCOL = 'reactive-md-component/v1' as const;

function rating(): LocalComponentDefinition {
  return defineLocalComponent({
    id: 'example/rating',
    name: 'rating',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      label: { kind: 'string', required: true, coerce: 'text' },
      max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
    },
    bindings: {
      value: {
        kind: 'number',
        family: 'number',
        bind: 'bind',
        initial: 'initial',
        initialRule: 'nearest-zero',
        constraints: { min: { literal: 0 }, max: { prop: 'max' }, step: { literal: 1 } },
        maxItems: undefined,
      },
    },
    structure: { rule: 'none', label: 'required' },
    rules: [
      { kind: 'numeric-range', min: 'min', max: 'max', step: 'step' },
      { kind: 'value-length', min: 'min-length', max: 'max-length' },
    ],
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function namedSlot(): LocalComponentDefinition {
  return defineLocalComponent({
    id: 'example/track',
    name: 'track',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      'from-min': { kind: 'number', default: 0 },
      'from-max': { kind: 'number', default: 10 },
    },
    bindings: {
      from: {
        kind: 'number',
        family: 'number',
        bind: 'bind-from',
        initial: 'initial-from',
        initialRule: 'nearest-zero',
        exclusive: true,
        constraints: {
          min: { prop: 'from-min' },
          max: { prop: 'from-max' },
          step: { literal: 1 },
        },
      },
    },
    structure: { rule: 'none', label: 'required' },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function container(): LocalComponentDefinition {
  return defineLocalComponent({
    id: 'example/hint',
    name: 'hint',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'container',
    props: { title: { kind: 'string', coerce: 'text' } },
    structure: {
      rule: 'components',
      label: 'none',
      child: 'tag',
      children: ['tag'],
      min: 1,
    },
    rules: [{ kind: 'only-children', children: ['tag'], min: 1 }],
    capabilities: { interactive: false, static: true, ssr: true, offline: true },
  });
}

describe('default preset manifests', () => {
  it('exposes 46 rendered/structural manifests and 3 kernel declarations', () => {
    expect(DEFAULT_COMPONENT_DEFINITIONS).toHaveLength(46);
    expect(DEFAULT_COMPONENT_NAMES).toHaveLength(46);
    expect(LOCAL_KERNEL_DECLARATIONS.map((schema) => schema.name)).toEqual(['computed', 'const', 'external']);
    expect(LOCAL_COMPONENT_NAMES).toHaveLength(49);
  });

  it('builds every default manifest through defineLocalComponent with shared ids', () => {
    expect(defaultPreset.id).toBe('reactive-md/default');
    expect(defaultPreset.components).toBe(DEFAULT_COMPONENT_DEFINITIONS);
    for (const definition of DEFAULT_COMPONENT_DEFINITIONS) {
      expect(definition.id).toBe(`reactive-md/${definition.name}`);
      expect(definition.protocol).toBe(PROTOCOL);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(definition.capabilities.static).toBe(true);
      // Revalidation is idempotent and must not need a builtin bypass.
      expect(readLocalComponentManifest(definition).name).toBe(definition.name);
    }
  });

  it('keeps phase-one tag forms from the definitions', () => {
    expect([...localComponentNames('leaf')].sort()).toEqual(
      'anchor checkbox column computed const coordinate counter date edge external input number progress range-slider slider textarea timer toggle validation'.split(' ').sort(),
    );
    expect([...localComponentNames('inline')].sort()).toEqual(['badge', 'jump', 'text', 'tooltip']);
    for (const name of LOCAL_COMPONENT_NAMES) {
      expect(LOCAL_COMPONENTS[name]).toBeDefined();
      expect(getLocalComponent(name)?.form).toBe(LOCAL_COMPONENTS[name].form);
    }
  });
});

describe('schema projection', () => {
  it('projects props, implicit binding attributes and named slots', () => {
    const input = componentSchemaFromDefinition(getLocalComponentDefinition('input')!);
    expect(input.binding?.kind).toBe('string');
    expect(input.props.bind).toEqual({ kind: 'string', static: true });
    expect(input.props.initial).toEqual({ kind: 'string', static: true });
    expect(input.props.label.coerce).toBe('text');
    expect(input.structure?.rule).toBe('none');
    expect(input.rules?.some((rule) => rule.kind === 'value-length')).toBe(true);

    const range = componentSchemaFromDefinition(getLocalComponentDefinition('range-slider')!);
    expect(range.binding).toBeUndefined();
    expect(range.slots?.map((slot) => slot.name)).toEqual(['start', 'end']);
    expect(range.slotRelations).toEqual([{ lower: 'start', upper: 'end' }]);
    expect(range.props['bind-start']).toEqual({ kind: 'string', static: true });
    expect(range.props['initial-start']).toEqual({ kind: 'number', static: true });

    const coordinate = componentSchemaFromDefinition(getLocalComponentDefinition('coordinate')!);
    expect(coordinate.slots?.map((slot) => slot.name)).toEqual(['x', 'y']);
    expect(coordinate.slots?.[0].bind).toBe('bind-x');
  });

  it('preserves legacy child-rule names for structural components', () => {
    expect(componentSchemaFromDefinition(getLocalComponentDefinition('grid')!).childRule).toBe('cards');
    expect(componentSchemaFromDefinition(getLocalComponentDefinition('accordion')!).childRule).toBe('disclosures');
    expect(componentSchemaFromDefinition(getLocalComponentDefinition('data-table')!).childRule).toBe('columns');
    expect(componentSchemaFromDefinition(getLocalComponentDefinition('tabs')!).childRule).toBe('tabs');
    expect(componentSchemaFromDefinition(getLocalComponentDefinition('checklist')!).childRule).toBe('content');
  });

  it('uses one public rule vocabulary across builtins', () => {
    const kinds = new Set<string>();
    for (const definition of DEFAULT_COMPONENT_DEFINITIONS) {
      for (const rule of definition.rules ?? []) kinds.add(rule.kind);
      for (const rule of componentSchemaFromDefinition(definition).rules ?? []) kinds.add(rule.kind);
    }
    for (const kind of [
      'numeric-range', 'text-length', 'date-bounds', 'progress-bounds',
      'timer-duration', 'selection-requires', 'options-body', 'value-sequence',
      'only-children', 'diagram-body', 'quiz-body', 'checklist-body', 'anchor',
      'navigation', 'data-table', 'plot-math', 'timeline-table', 'retain',
      'self-binding-read', 'value-date', 'value-length', 'value-required',
    ]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it('keeps content-derived defaults out of the legacy initial prop', () => {
    const timer = componentSchemaFromDefinition(getLocalComponentDefinition('timer')!);
    expect(timer.props.initial).toBeUndefined();
    expect(timer.binding?.initialRule).toBe('duration');
    const checklist = componentSchemaFromDefinition(getLocalComponentDefinition('checklist')!);
    expect(checklist.props.initial).toBeUndefined();
    expect(checklist.binding?.kind).toBe('array');
  });
});

describe('manifest validation for phase-two capabilities', () => {
  it('accepts named slots, structure, rules and slot relations', () => {
    expect(namedSlot().bindings?.from?.bind).toBe('bind-from');
    const config = createLocalConfig({ components: [namedSlot()] });
    expect(getLocalComponentDefinition('track', config)).toBeDefined();
    const schema = localComponentSchemas(config).get('track');
    expect(schema?.slots?.[0].name).toBe('from');
  });

  it('rejects reserved slot names and duplicate binding attributes', () => {
    expect(() => defineLocalComponent({
      ...rating(),
      bindings: {
        ...rating().bindings,
        setMany: {
          ...rating().bindings!.value,
          bind: 'bind-other',
          initial: 'initial-other',
        },
      },
    })).toThrow(/reserved/);

    expect(() => defineLocalComponent({
      ...rating(),
      bindings: {
        one: { ...rating().bindings!.value, bind: 'bind-x', initial: 'initial-x' },
        two: { ...rating().bindings!.value, bind: 'bind-x', initial: 'initial-y' },
      },
    })).toThrow(/more than one binding/);
  });

  it('lowers legacy children to an equivalent structure', () => {
    const { structure: _structure, ...base } = rating();
    const inline = defineLocalComponent({
      ...base,
      form: 'container',
      children: { kind: 'inline', required: true },
    });
    expect(inline.structure).toBeUndefined();
    expect(componentSchemaFromDefinition(inline).structure).toEqual({ rule: 'inline', label: 'none', inlineOnly: true, noComponents: true, min: 1 });
    expect(readLocalComponentManifest(inline)).toEqual(inline);
    expect(inline.children).toEqual({ kind: 'inline', required: true });
    expect(() => defineLocalComponent({
      ...inline,
      children: { kind: 'inline' },
      structure: { rule: 'inline' },
    })).toThrow(/both/);
  });

  it('validates rule parameters and structure bounds', () => {
    expect(() => readLocalComponentManifest({
      ...rating(),
      rules: [{ kind: 'numeric-range', min: 'min', max: 'max', order: 'sideways' }],
    })).toThrow(/order/);
    expect(() => readLocalComponentManifest({
      ...container(),
      structure: { rule: 'components', min: 3, max: 1 },
    })).toThrow(/min/);
  });

  it('rejects a prop default that violates positive/color/coerce declarations', () => {
    expect(() => readLocalComponentManifest({
      ...rating(),
      props: { step: { kind: 'number', positive: true, default: 0 } },
    })).toThrow(/greater than zero/);
    expect(() => readLocalComponentManifest({
      ...rating(),
      props: { label: { kind: 'number', coerce: 'text' } },
    })).toThrow(/coerce/);
  });
});

function collection(kind: 'array' | 'number-array', family: 'collection' | 'multi-select' = 'collection'): LocalComponentDefinition {
  return defineLocalComponent({
    id: `example/${kind}`,
    name: kind === 'array' ? 'tags' : 'scores',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: { label: { kind: 'string' }, limit: { kind: 'number', integer: true, min: 0 } },
    bindings: {
      value: {
        kind,
        family,
        bind: 'bind',
        initial: 'initial',
        initialRule: 'empty-array',
        maxItems: { prop: 'limit' },
      },
    },
    structure: { rule: 'none', label: 'optional' },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

describe('collection bindings', () => {
  it('accepts string[] and number[] collections with maxItems', () => {
    expect(collection('array').bindings?.value.kind).toBe('array');
    expect(collection('array').bindings?.value.family).toBe('collection');
    expect(collection('number-array').bindings?.value.kind).toBe('number-array');
    expect(collection('number-array').bindings?.value.maxItems).toEqual({ prop: 'limit' });
  });

  it('rejects unsupported collection combinations and non-numeric named slots', () => {
    expect(() => collection('number-array', 'multi-select')).toThrow(/not supported/);
    expect(() => defineLocalComponent({
      ...rating(),
      bindings: {
        value: rating().bindings!.value,
        extra: {
          kind: 'string',
          family: 'text',
          bind: 'bind-extra',
          initial: 'initial-extra',
          initialRule: 'empty',
        },
      },
    })).toThrow(/numeric/);
  });
});

describe('resolved prop rules', () => {
  function probe(): LocalComponentDefinition {
    return defineLocalComponent({
      id: 'example/probe',
      name: 'probe',
      version: '1.0.0',
      protocol: PROTOCOL,
      form: 'leaf',
      props: {
        score: { kind: 'number', dynamic: true, positive: true },
        tint: { kind: 'string', dynamic: true, color: true },
        code: { kind: 'string', pattern: '^[a-z]+$' },
      },
      capabilities: { interactive: true, static: true, ssr: true, offline: true },
    });
  }

  const runtime = {
    evaluate(expression: string): string | number {
      if (expression === '0') return 0;
      if (expression === 'nope') return 'not-a-color';
      throw new Error(`unexpected expression ${expression}`);
    },
    text(): string {
      return 'ABC';
    },
  };

  it('rejects positive violations after dynamic evaluation', () => {
    expect(() => resolveLocalComponentProps(probe(), { score: '{{ 0 }}' }, runtime)).toThrow(/greater than zero/);
  });

  it('rejects invalid dynamic colors', () => {
    expect(() => resolveLocalComponentProps(probe(), { tint: '{{ nope }}' }, runtime)).toThrow(/named color/);
  });

  it('applies declared patterns to resolved mixed templates', () => {
    expect(() => resolveLocalComponentProps(probe(), { code: 'x{{ 1 }}' }, runtime)).toThrow(/pattern/);
  });
});

describe('registry validation and rule budgets', () => {
  it('rejects invalid, duplicate and reserved raw registry inputs', () => {
    const config = createLocalConfig();
    const forged = {
      ...config,
      components: [{ ...rating(), form: 'nope' }],
    } as unknown as LocalConfig;
    expect(() => getLocalComponentRegistry(forged)).toThrow(/form/);

    const duplicate = { ...config, components: [rating(), rating()] } as unknown as LocalConfig;
    expect(() => getLocalComponentRegistry(duplicate)).toThrow(/declared more than once/);

    const reserved = {
      ...config,
      components: [{ ...rating(), id: 'example/number', name: 'number' }],
    } as unknown as LocalConfig;
    expect(() => getLocalComponentRegistry(reserved)).toThrow(/conflicts with a built-in/);
  });

  it('never lets manifest rule budgets exceed kernel hard limits', () => {
    expect(() => readLocalComponentManifest({
      ...rating(),
      rules: [{ kind: 'plot-math', min: 'min', max: 'max', samples: 'samples', curves: 9999, points: 10 }],
    })).toThrow(/kernel limit/);
    expect(() => readLocalComponentManifest({
      ...rating(),
      rules: [{
        kind: 'data-table',
        rows: 'rows', key: 'key', child: 'column', childValue: 'value',
        label: 'label', maxRows: 'max-rows', defaultMaxRows: 10,
        documentRows: 10, documentCells: 10, maxColumns: 9999,
      }],
    })).toThrow(/kernel limit/);
  });
});

describe('unified registry and compile options', () => {
  it('merges default preset with external manifests', () => {
    const config = createLocalConfig({ components: [rating()] });
    const registry = getLocalComponentRegistry(config);
    expect(registry).toHaveLength(DEFAULT_COMPONENT_DEFINITIONS.length + 1);
    expect(getLocalComponentRegistry()).toBe(DEFAULT_COMPONENT_DEFINITIONS);
    expect(getLocalComponentDefinition('rating', config)?.id).toBe('example/rating');
    expect(getLocalComponentDefinition('input', config)?.name).toBe('input');
  });

  it('exposes one definition/schema map including kernel declarations', () => {
    const options = readLocalCompileOptions(undefined);
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    expect(options.registry).toHaveLength(46);
    expect(options.componentByName.get('number')?.name).toBe('number');
    expect(options.schemaByName.get('computed')?.form).toBe('leaf');
    expect(options.defaultComponentNames.has('slider')).toBe(true);
    expect(options.externalComponentNames.size).toBe(0);
    expect(options.preset).toEqual({ id: 'reactive-md/default', version: '0.6.1' });
  });

  it('adapts legacy host input into the same schema map', () => {
    const options = readLocalCompileOptions({
      hostComponents: [{
        name: 'gauge',
        form: 'leaf',
        props: { label: { kind: 'string', required: true } },
        binding: { kind: 'number', min: 0, max: 10 },
      }],
    });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    expect(options.schemaByName.get('gauge')?.legacyHost).toBe(true);
    expect(options.legacyHostNames.has('gauge')).toBe(true);
    expect(options.hostByName.has('gauge')).toBe(true);
    expect(parseLocal('<gauge label="x" bind="g" />', {
      hostComponents: [{
        name: 'gauge',
        form: 'leaf',
        props: { label: { kind: 'string', required: true } },
        binding: { kind: 'number' },
      }],
    }).nodes[0]?.type).toBe('hostComponent');
  });
});

describe('parser unified forms', () => {
  it('parses default preset tags from registry forms', () => {
    expect(parseLocal('<slider bind="x" />').nodes[0]?.type).toBe('component');
    expect(parseLocal('<card>body</card>').nodes[0]?.type).toBe('component');
    expect(parseLocal('<badge>x</badge>').nodes[0]?.children?.[0]).toMatchObject({ type: 'component', name: 'badge', children: [{ type: 'text', value: 'x' }] });
    expect(parseLocal('<computed name="n" value="{{ 1 + 1 }}" />').diagnostics).toEqual([]);
  });

  it('parses external leaf/container forms from config', () => {
    const config = createLocalConfig({ components: [container()] });
    const parsed = parseLocal('<hint title="hi"><tag /></hint>', { config });
    expect(parsed.nodes[0]?.type).toBe('hostComponent');
    expect(parsed.nodes[0]?.hostForm).toBe('container');
    expect(parsed.diagnostics.filter((entry) => entry.code === 'local.tag.shape')).toEqual([]);
  });

  it('suggests external names alongside builtins', () => {
    const config = createLocalConfig({ components: [rating()] });
    const parsed = parseLocal('<ratingg />', { config });
    const unknown = parsed.diagnostics.find((entry) => entry.code === 'local.component.unknown');
    expect(unknown?.message).toContain('rating');
  });
});
