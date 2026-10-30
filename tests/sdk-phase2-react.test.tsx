import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/local';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import { getLocalComponentRegistry } from '../src/sdk/registry';
import defaultPreset from '../src/presets/default';
import { createDefaultReactPreset, DEFAULT_COMPONENT_VIEWS } from '../src/components/default-preset';
import {
  createReactConfig,
  defineReactComponent,
  type LocalComponentContext,
} from '../src/react/sdk';

const PROTOCOL = 'reactive-md-component/v1';
const COMPONENTS_DIR = fileURLToPath(new URL('../src/components/', import.meta.url));

describe('React preset composition', () => {
  it('keeps static context writes and resets read-only and freezes public values', () => {
    const definition = sliderAlias();
    const config = createLocalConfig({ components: [definition] });
    let captured: LocalComponentContext | undefined;
    const implementation = defineReactComponent(definition, { render: context => { captured = context; return null; } });
    const compiled = compileLocal('<slider-alias bind="score" label="Score" initial="2">', { config });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      expect(runtime.setParameter('score', 7)).toEqual([]);
      renderToStaticMarkup(createElement(LocalDocumentView, { document: compiled.document, runtime, mode: 'static', reactConfig: createReactConfig(config, { components: [implementation] }) }));
      const context = captured!;
      expect(context).toBeDefined();
      const revision = runtime.snapshot().revision;
      expect(context.bindings.value.set(9).ok).toBe(false);
      expect(context.bindings.setMany({ value: 9 }).ok).toBe(false);
      expect(context.runtime.set(context.content, 9).length).toBeGreaterThan(0);
      expect(context.runtime.setMany(context.content, { value: 9 }).length).toBeGreaterThan(0);
      context.runtime.reset(context.content);
      expect(runtime.getParameter('score')).toBe(7);
      expect(runtime.snapshot().revision).toBe(revision);
      expect(Object.isFrozen(context.runtime.evaluate('[1, 2]'))).toBe(true);
      expect(Object.isFrozen(context.content.range)).toBe(true);
      expect(Object.isFrozen(context.instance.range)).toBe(true);
    } finally { runtime.dispose(); }
  });

  it('registers declared external implementations from an additional preset', () => {
    const definition = sliderAlias();
    const config = createLocalConfig({ components: [definition] });
    const implementation = defineReactComponent(definition, { render: SliderAliasView });
    const combined = createReactConfig(config, { components: [], presets: [{ id: 'example/controls', version: '1.0.0', components: [implementation] }] });
    expect(combined.components).toEqual([implementation]);
  });

  it('rejects a preset that replaces a default component', () => {
    const slider = defaultPreset.components.find(item => item.name === 'slider')!;
    const replacement = defineReactComponent(slider, { render: () => null });
    expect(() => createReactConfig(createLocalConfig(), { components: [], presets: [{ id: 'example/override', version: '1.0.0', components: [replacement] }] })).toThrow(/more than one/);
  });

  it('checks preset implementations against the installed contracts', () => {
    const implementation = defineReactComponent(sliderAlias(), { render: SliderAliasView });
    expect(() => createReactConfig(createLocalConfig(), { components: [], presets: [{ id: 'example/uninstalled', version: '1.0.0', components: [implementation] }] })).toThrow(/installed manifest/);
  });
});

function capabilities() {
  return { interactive: true, static: true, ssr: true, offline: true };
}

function sliderAlias() {
  return defineLocalComponent({
    id: 'example/slider-alias',
    name: 'slider-alias',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      label: { kind: 'string', coerce: 'text' },
      min: { kind: 'number', dynamic: true, default: 0 },
      max: { kind: 'number', dynamic: true, default: 100 },
      step: { kind: 'number', positive: true, default: 1 },
    },
    bindings: {
      value: {
        kind: 'number',
        family: 'number',
        bind: 'bind',
        initial: 'initial',
        initialRule: 'min',
        constraints: {
          min: { prop: 'min' },
          max: { prop: 'max' },
          step: { prop: 'step' },
        },
      },
    },
    structure: { rule: 'none', label: 'required' },
    capabilities: capabilities(),
  });
}

function coordinateAlias() {
  return defineLocalComponent({
    id: 'example/coordinate-alias',
    name: 'coordinate-alias',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      label: { kind: 'string', coerce: 'text' },
      'x-min': { kind: 'number', default: -5 },
      'x-max': { kind: 'number', default: 5 },
      'y-min': { kind: 'number', default: -5 },
      'y-max': { kind: 'number', default: 5 },
      step: { kind: 'number', positive: true, default: 1 },
    },
    bindings: {
      x: {
        kind: 'number',
        family: 'number',
        bind: 'bind-x',
        initial: 'initial-x',
        initialRule: 'nearest-zero',
        exclusive: true,
      },
      y: {
        kind: 'number',
        family: 'number',
        bind: 'bind-y',
        initial: 'initial-y',
        initialRule: 'nearest-zero',
        exclusive: true,
      },
    },
    structure: { rule: 'none', label: 'required' },
    capabilities: capabilities(),
  });
}

function collectionAlias() {
  return defineLocalComponent({
    id: 'example/tags-alias',
    name: 'tags-alias',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'container',
    props: { label: { kind: 'string', coerce: 'text' } },
    bindings: {
      value: {
        kind: 'array',
        family: 'multi-select',
        bind: 'bind',
        initial: 'initial',
        initialRule: 'empty-array',
        exclusive: true,
      },
    },
    structure: {
      rule: 'options',
      label: 'required',
      child: 'option',
      children: ['option'],
      min: 1,
    },
    capabilities: capabilities(),
  });
}

const SliderAliasView = (context: LocalComponentContext) => (
  <span className="alias-slider" data-value={String(context.bindings.get('value'))}>
    {String(context.props.label ?? '')}
  </span>
);

const CoordinateAliasView = (context: LocalComponentContext) => (
  <span
    className="alias-coordinate"
    data-x={String(context.bindings.get('x'))}
    data-y={String(context.bindings.get('y'))}
    data-frozen={String(Boolean(Object.isFrozen(context.bindings.get('x'))))}
  >
    {String(context.props.label ?? '')}
  </span>
);

const CollectionAliasView = (context: LocalComponentContext) => {
  const value = context.bindings.get('value');
  const options = context.children.options();
  return (
    <span
      className="alias-tags"
      data-count={String(value === null ? 0 : (value as readonly string[]).length)}
      data-frozen={String(Object.isFrozen(value))}
      data-options={options.map((option) => option.value).join(',')}
    >
      {String(context.props.label ?? '')}
    </span>
  );
};

describe('builtin React preset', () => {
  it('binds every default manifest through defineReactComponent', () => {
    const preset = createDefaultReactPreset();
    expect(preset.id).toBe(defaultPreset.id);
    expect(preset.components.length).toBe(defaultPreset.components.length);
    const names = new Set<string>();
    for (const component of preset.components) {
      expect(component.definition.id.startsWith('reactive-md/')).toBe(true);
      expect(component.digest.length).toBeGreaterThan(0);
      expect(DEFAULT_COMPONENT_VIEWS[component.definition.name]).toBeTypeOf('function');
      expect(names.has(component.definition.name)).toBe(false);
      names.add(component.definition.name);
    }
    expect([...names].sort()).toEqual(defaultPreset.components.map((item) => item.name).sort());
  });

  it('exposes the same manifests through the public registry helper', () => {
    const registry = getLocalComponentRegistry();
    expect(registry.map((item) => item.id).sort()).toEqual(
      defaultPreset.components.map((item) => item.id).sort(),
    );
  });
});

describe('external clones use the same public primitives', () => {
  it('shares a scalar binding between builtin and alias components', () => {
    const config = createLocalConfig({ components: [sliderAlias()] });
    const reactConfig = createReactConfig(config, {
      components: [defineReactComponent(sliderAlias(), { render: SliderAliasView })],
    });
    const compiled = compileLocal(
      '<slider bind="score" label="Builtin" initial="2">\n<slider-alias bind="score" label="Alias">',
      { config },
    );
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      expect(runtime.getParameters()).toEqual({ score: 2 });
      const markup = renderToStaticMarkup(createElement(LocalDocumentView, {
        document: compiled.document,
        runtime,
        reactConfig,
        mode: 'static',
      }));
      expect(markup).toContain('alias-slider');
      expect(markup).toContain('data-value="2"');
    } finally {
      runtime.dispose();
    }
  });

  it('supports named slots and atomic setMany through the public context', () => {
    const definition = coordinateAlias();
    const config = createLocalConfig({ components: [definition] });
    const reactConfig = createReactConfig(config, {
      components: [defineReactComponent(definition, { render: CoordinateAliasView })],
    });
    const compiled = compileLocal(
      '<coordinate-alias label="Position" bind-x="px" bind-y="py" initial-x="1" initial-y="-2">',
      { config },
    );
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      expect(runtime.getParameters()).toEqual({ px: 1, py: -2 });
      const markup = renderToStaticMarkup(createElement(LocalDocumentView, {
        document: compiled.document,
        runtime,
        reactConfig,
        mode: 'static',
      }));
      expect(markup).toContain('data-x="1"');
      expect(markup).toContain('data-y="-2"');
    } finally {
      runtime.dispose();
    }
  });

  it('projects option children and immutable arrays to external components', () => {
    const definition = collectionAlias();
    const config = createLocalConfig({ components: [definition] });
    const reactConfig = createReactConfig(config, {
      components: [defineReactComponent(definition, { render: CollectionAliasView })],
    });
    const compiled = compileLocal(
      '<tags-alias bind="tags" label="Tags">\n<option value="a">Alpha</option>\n<option value="b">Beta</option>\n</tags-alias>',
      { config },
    );
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      expect(runtime.getParameters()).toEqual({ tags: [] });
      const markup = renderToStaticMarkup(createElement(LocalDocumentView, {
        document: compiled.document,
        runtime,
        reactConfig,
        mode: 'static',
      }));
      expect(markup).toContain('data-options="a,b"');
      expect(markup).toContain('data-frozen="true"');
    } finally {
      runtime.dispose();
    }
  });
});

describe('builtin renderer boundary', () => {
  it('keeps component modules off private AST/local imports', () => {
    for (const file of readdirSync(COMPONENTS_DIR)) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      const source = readFileSync(`${COMPONENTS_DIR}${file}`, 'utf8');
      expect(source.includes("from '../local/"), `${file} imports a private local module`).toBe(false);
      expect(source.includes('runtime.document'), `${file} reads runtime.document`).toBe(false);
      expect(source.includes('type LocalNode'), `${file} reads the internal AST type`).toBe(false);
    }
  });

  it('renders default builtins without an explicit reactConfig', () => {
    const compiled = compileLocal('<slider bind="n" label="Amount" initial="3">');
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const runtime = createLocalRuntime(compiled.document);
    try {
      const markup = renderToStaticMarkup(createElement(LocalDocumentView, {
        document: compiled.document,
        runtime,
        mode: 'static',
      }));
      expect(markup).toContain('local-slider');
      expect(markup).toContain('Amount');
    } finally {
      runtime.dispose();
    }
  });
});
