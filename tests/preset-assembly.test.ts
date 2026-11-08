import { describe, expect, it } from 'vitest';
import { createLocalConfig, readLocalConfig, validateLocalDocumentConfig, DEFAULT_PRESET_ID, DEFAULT_PRESET_VERSION } from '../src/sdk/config';
import { defineLocalComponent, localComponentDigest } from '../src/sdk/manifest';
import { defineLocalPreset } from '../src/sdk/preset';
import { LOCAL_COMPONENT_PROTOCOL, LOCAL_PRESET_PROTOCOL } from '../src/sdk/version';
import { defaultPreset } from '../src/presets/default';
import { controlsPack, dataPack, visualsPack } from '../src/presets/packs';
import { createStandardCompiler } from '../src/compiler/standard';
import { createReactConfig } from '../src/react/sdk';
import { defineReactComponent } from '../src/react/component-api';
import { createReactHost, defineReactComponentPackage } from '../src/react/package';
import { createLocalComponentCatalog } from '../src/authoring/catalog';
import {
  createLocalBundleManifest,
  createLocalRestorationRequirements,
  validateLocalRestorationRequirements,
} from '../src/export/restoration';
import type { LocalComponentDefinition } from '../src/sdk/types';
import type { LocalDocument } from '../src/local/contracts/types';

const capabilities = { interactive: true, static: true, ssr: true, offline: true };

function component(overrides: Partial<LocalComponentDefinition> = {}): LocalComponentDefinition {
  return defineLocalComponent({
    id: 'example/probe',
    name: 'probe',
    version: '1.0.0',
    protocol: LOCAL_COMPONENT_PROTOCOL,
    form: 'leaf',
    props: {},
    capabilities,
    ...overrides,
  });
}

function preset(id: string, components: readonly LocalComponentDefinition[], dependencies: readonly { id: string; version: string }[] = []) {
  return defineLocalPreset({
    protocol: LOCAL_PRESET_PROTOCOL,
    id,
    version: '1.0.0',
    components,
    ...(dependencies.length === 0 ? {} : { dependencies }),
  });
}

const baseSlider = defaultPreset.components.find((item) => item.name === 'slider') as LocalComponentDefinition;

function sliderReplacement(overrides: Partial<LocalComponentDefinition> = {}): LocalComponentDefinition {
  return defineLocalComponent({
    ...baseSlider,
    version: '1.1.0',
    replaces: { id: baseSlider.id, version: baseSlider.version },
    ...overrides,
  } as LocalComponentDefinition);
}

describe('preset assembly', () => {
  it('round-trips a v2 configuration and rebuilds derived fields', () => {
    const config = createLocalConfig({ components: [component()] });
    const clone = readLocalConfig(JSON.parse(JSON.stringify(config)));
    expect(clone.key).toBe(config.key);
    expect(clone.registry.map((item) => item.id)).toEqual(config.registry.map((item) => item.id));
    expect(clone.replacements).toEqual(config.replacements);
    const tampered = {
      ...JSON.parse(JSON.stringify(config)),
      key: 'rmd-0000000000000000',
      registry: [],
      components: [],
      legacyKeys: [],
    };
    const rebuilt = readLocalConfig(tampered);
    expect(rebuilt.key).toBe(config.key);
    expect(rebuilt.registry.map((item) => item.id)).toEqual(config.registry.map((item) => item.id));
  });

  it('supports an empty preset set', () => {
    const config = createLocalConfig({ presets: [] });
    expect(config.registry).toEqual([]);
    expect(config.presets).toEqual([]);
    expect(createLocalComponentCatalog(config, 'en')).toEqual([]);
    const reactConfig = createReactConfig(config, { components: [] });
    expect(reactConfig.implementations).toEqual([]);
    const compiled = createStandardCompiler({ config }).compile('<slider bind="value">');
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.diagnostics.some((item) => item.code === 'local.component.unknown'
        || item.code === 'local.html')).toBe(true);
    }
  });

  it('composes presets with stable dependency order', () => {
    const alpha = component({ id: 'example/alpha', name: 'alpha' });
    const beta = component({ id: 'example/beta', name: 'beta' });
    const first = preset('example/first', [alpha]);
    const second = preset('example/second', [beta], [{ id: first.id, version: first.version }]);
    const forward = createLocalConfig({ presets: [first, second] });
    const reverse = createLocalConfig({ presets: [second, first] });
    expect(forward.key).toBe(reverse.key);
    expect(forward.registry.map((item) => item.name)).toEqual(['alpha', 'beta']);
    expect(() => createLocalConfig({ presets: [second] })).toThrow(/requires missing preset/);
    const cyclic = preset('example/cyclic', [component({ id: 'example/cyclic-a', name: 'cyclic-a' })], [{ id: 'example/cyclic', version: '1.0.0' }]);
    expect(() => createLocalConfig({ presets: [cyclic] })).toThrow(/cycle/);
  });

  it('ships disjoint named packs and resolves pack dependencies', () => {
    const controls = createLocalConfig({ presets: [controlsPack] });
    expect(controls.registry.some((item) => item.name === 'slider')).toBe(true);
    expect(controls.registry.some((item) => item.name === 'chart')).toBe(false);
    const visuals = createLocalConfig({ presets: [visualsPack, dataPack] });
    expect(visuals.registry.some((item) => item.name === 'chart')).toBe(true);
    expect(visuals.registry.some((item) => item.name === 'table')).toBe(true);
    expect(() => createLocalConfig({ presets: [defaultPreset, controlsPack] })).toThrow(/declared more than once/);
  });

  it('compiles components supplied only by a custom preset', () => {
    const only = preset('example/only', [component({ id: 'example/probe', name: 'probe' })]);
    const config = createLocalConfig({ presets: [only] });
    const compiled = createStandardCompiler({ config }).compile('<probe>');
    expect(compiled.ok, compiled.ok ? '' : JSON.stringify(compiled.diagnostics)).toBe(true);
    const missing = createStandardCompiler({ config: createLocalConfig({ presets: [] }) }).compile('<probe>');
    expect(missing.ok).toBe(false);
  });

  it('applies an explicit slider replacement and selects its React implementation', () => {
    const sliderPro = sliderReplacement();
    const config = createLocalConfig({ components: [sliderPro] });
    expect(config.registry.find((item) => item.name === 'slider')?.version).toBe('1.1.0');
    expect(config.replacements).toHaveLength(1);
    expect(config.replacements[0]).toMatchObject({
      id: baseSlider.id,
      name: 'slider',
      fromVersion: baseSlider.version,
      toVersion: '1.1.0',
    });
    expect(config.key).not.toBe(createLocalConfig().key);

    const implementation = defineReactComponent(sliderPro, { render: () => null });
    const reactConfig = createReactConfig(config, { components: [implementation] });
    expect(reactConfig.components).toHaveLength(1);
    const selected = reactConfig.implementations.find((item) => item.definition.name === 'slider');
    expect(selected?.definition.version).toBe('1.1.0');
    expect(selected?.digest).toBe(localComponentDigest(sliderPro));
  });

  it('rejects incompatible replacements', () => {
    const changedProp = sliderReplacement({
      props: { ...baseSlider.props, min: { ...baseSlider.props.min, default: 1 } },
    });
    expect(() => createLocalConfig({ components: [changedProp] })).toThrow(/changed the semantics of prop "min"/);

    const downgraded = sliderReplacement({ capabilities: { ...baseSlider.capabilities, offline: false } });
    expect(() => createLocalConfig({ components: [downgraded] })).toThrow(/downgraded a declared capability/);

    const second = sliderReplacement({ version: '1.2.0' });
    expect(() => createLocalConfig({ components: [sliderReplacement(), second] })).toThrow(/more than one replacement/);

    expect(() => createLocalConfig({ components: [sliderReplacement()], presets: [] })).toThrow(/no base contribution/);
    expect(() => createLocalConfig({ components: [sliderReplacement()], replacements: 'forbid' })).toThrow(/forbidden/);
  });

  it('selects resources by active registry and replacement ownership', () => {
    const sliderPro = sliderReplacement({ styles: ['example/slider-pro.css'] });
    const implementation = defineReactComponent(sliderPro, { render: () => null });
    const host = createReactHost({
      components: [implementation],
      resources: [{ id: 'example/slider-pro.css', css: '.local-document .slider-pro { color: red; }' }],
    });
    expect(host.resources.map((item) => item.id)).toEqual(['example/slider-pro.css']);
    expect(() => createReactHost({ components: [implementation] })).toThrow(/missing style resource example\/slider-pro.css/);
  });

  it('reads a v1 configuration through the compatibility profile', () => {
    const probe = component();
    const legacy = {
      protocol: 'reactive-md-config/v1',
      presets: [{ id: DEFAULT_PRESET_ID, version: DEFAULT_PRESET_VERSION }],
      components: [probe],
      themes: [],
    };
    const config = readLocalConfig(legacy);
    expect(config.protocol).toBe('reactive-md-config/v2');
    expect(config.legacyKeys.length).toBeGreaterThan(0);
    const document = { componentConfigKey: config.legacyKeys[0].key } as LocalDocument;
    expect(validateLocalDocumentConfig(document, config)).toEqual([]);
    expect(() => readLocalConfig({
      ...legacy,
      components: [component({ id: 'example/v1-replacer', name: 'v1-replacer', replaces: { id: 'example/v1-replacer' } })],
    })).toThrow(/replaces is not supported/);
  });

  it('seals bundles and restoration requirements with the assembly identity', () => {
    const config = createLocalConfig();
    const compiled = createStandardCompiler({ config }).compile('# Title');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const manifest = createLocalBundleManifest('window.ready = true;', config);
    expect(manifest.assembly?.configKey).toBe(config.key);
    expect(manifest.assembly?.components.length).toBe(config.registry.length);
    expect(manifest.seal).toMatch(/^rmd-/);

    const requirements = createLocalRestorationRequirements(compiled.document, config, 'offline');
    expect(requirements.assembly?.configKey).toBe(config.key);
    expect(validateLocalRestorationRequirements(requirements, {
      config,
      source: compiled.document.source,
    })).toEqual([]);
    expect(validateLocalRestorationRequirements({
      ...requirements,
      assembly: undefined,
    }, { config, source: compiled.document.source })).toEqual([]);
    expect(validateLocalRestorationRequirements({
      ...requirements,
      configKey: 'rmd-0000000000000000',
    }, { config, source: compiled.document.source }).some((item) => item.code === 'local.extension.restore-config')).toBe(true);
  });

  it('keeps resource conflicts and component CSS validation explicit', () => {
    const pkg = defineReactComponentPackage({
      id: 'example/rating',
      name: 'rating',
      version: '1.0.0',
      capabilities,
      css: '.local-document .rating { color: var(--ink); }',
      render: () => null,
    });
    const host = createReactHost({ packages: [pkg] });
    expect(host.resources.map((item) => item.id)).toEqual(['example/rating.css']);
    expect(() => createReactHost({
      packages: [pkg],
      resources: [{ id: 'example/rating.css', css: '.different {}' }],
    })).toThrow(/conflicting contents/);
  });
});
