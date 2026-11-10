import { describe, expect, it } from 'vitest';
import { createLocalConfig, readLocalConfig, validateLocalDocumentConfig, DEFAULT_PRESET_ID, DEFAULT_PRESET_VERSION } from '../src/sdk/config';
import type { LocalCompatProfile } from '../src/sdk/compat-profile';
import { defineLocalComponent, localComponentDigest } from '../src/sdk/manifest';
import { defineLocalPreset, localPresetDigest } from '../src/sdk/preset';
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
import type { LocalComponentDefinition, LocalPresetPackage } from '../src/sdk/types';
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

  it('projects preset authoring overrides without changing semantic identity', () => {
    const palette = component({
      id: 'example/palette',
      name: 'palette',
      props: { tone: { kind: 'string' } },
      authoring: {
        title: { en: 'Palette', zh: '调色板' },
        description: { en: 'Manifest description', zh: '清单描述' },
        category: 'data',
        insertText: '<palette tone="warm">',
      },
    });
    const overridden = defineLocalPreset({
      protocol: LOCAL_PRESET_PROTOCOL,
      id: 'example/authoring',
      version: '1.0.0',
      components: [palette],
      authoring: [{
        componentId: 'example/palette',
        authoring: { title: { en: 'Palette Pro' }, category: 'visuals' },
      }],
    });
    const plain = preset('example/authoring', [palette]);
    const config = createLocalConfig({ presets: [overridden] });

    expect(config.registry.find((item) => item.name === 'palette')?.authoring).toEqual({
      title: { en: 'Palette Pro' },
      description: { en: 'Manifest description', zh: '清单描述' },
      category: 'visuals',
      insertText: '<palette tone="warm">',
    });
    expect(createLocalComponentCatalog(config, 'en').find((item) => item.name === 'palette')).toMatchObject({
      title: 'Palette Pro',
      description: 'Manifest description',
      category: 'visuals',
      insertText: '<palette tone="warm">',
    });

    expect(config.key).toBe(createLocalConfig({ presets: [plain] }).key);
    expect(localPresetDigest(overridden)).toBe(localPresetDigest(plain));

    // Default preset components keep their richer localized copy for fields
    // the preset override does not replace.
    const sliderPreset = (authoring?: LocalPresetPackage['authoring']) => defineLocalPreset({
      protocol: LOCAL_PRESET_PROTOCOL,
      id: 'example/slider-authoring',
      version: '1.0.0',
      components: [baseSlider],
      ...(authoring ? { authoring } : {}),
    });
    const plainSlider = createLocalConfig({ presets: [sliderPreset()] });
    const overrideSlider = createLocalConfig({
      presets: [sliderPreset([{
        componentId: baseSlider.id,
        authoring: { title: { en: 'Slider Plus' } },
      }])],
    });
    const plainSliderEntry = createLocalComponentCatalog(plainSlider, 'zh')
      .find((item) => item.name === 'slider');
    const sliderEntry = createLocalComponentCatalog(overrideSlider, 'zh')
      .find((item) => item.name === 'slider');
    expect(sliderEntry?.title).toBe('Slider Plus');
    expect(sliderEntry?.description).toBe(plainSliderEntry?.description);
    expect(sliderEntry?.insertText).toBe(plainSliderEntry?.insertText);
    expect(overrideSlider.key).toBe(plainSlider.key);
  });

  it('falls back from replacement authoring to the base component fields', () => {
    const base = component({
      id: 'example/widget',
      name: 'widget',
      props: { label: { kind: 'string' } },
      authoring: {
        title: { en: 'Widget' },
        description: { en: 'Base widget' },
        category: 'data',
        insertText: '<widget label="Sample">',
      },
    });
    const replacer = component({
      ...base,
      version: '1.1.0',
      replaces: { id: base.id, version: base.version },
      authoring: { title: { en: 'Widget Pro' } },
    });
    const config = createLocalConfig({ presets: [], components: [base, replacer] });

    const definition = config.registry.find((item) => item.name === 'widget');
    expect(definition?.version).toBe('1.1.0');
    expect(definition?.authoring).toEqual({
      title: { en: 'Widget Pro' },
      description: { en: 'Base widget' },
      category: 'data',
      insertText: '<widget label="Sample">',
    });
    expect(createLocalComponentCatalog(config, 'en').find((item) => item.name === 'widget')).toMatchObject({
      title: 'Widget Pro',
      description: 'Base widget',
      category: 'data',
      insertText: '<widget label="Sample">',
    });

    const variant = createLocalConfig({
      presets: [],
      components: [
        component({ ...base, authoring: { title: { en: 'Other' } } }),
        component({ ...replacer, authoring: { description: { en: 'Other' } } }),
      ],
    });
    expect(variant.key).toBe(config.key);
    expect(variant.replacements).toEqual(config.replacements);
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
    expect(config.legacyKeys[0].profile).toBe('reactive-md-config/v1');
    const document = { componentConfigKey: config.legacyKeys[0].key } as LocalDocument;
    expect(validateLocalDocumentConfig(document, config)).toEqual([]);
    expect(() => readLocalConfig({
      ...legacy,
      components: [component({ id: 'example/v1-replacer', name: 'v1-replacer', replaces: { id: 'example/v1-replacer' } })],
    })).toThrow(/replaces is not supported/);
  });

  it('reads a non-default legacy identity only through an exact profile hit', () => {
    // Test-only data: no released SDK line ever used this identity. It proves
    // the lookup path; the built-in table still contains only verified entries.
    const profile: LocalCompatProfile = {
      name: 'test/legacy-default@0.6.9',
      protocol: 'reactive-md-config/v1',
      sdkRange: '0.6.9',
      targetProtocol: 'reactive-md-config/v2',
      targetSdkRange: '0.7.0',
      preset: { id: 'reactive-md/legacy-default', version: '0.6.9' },
      legacyKeys: [{ profile: 'reactive-md-config/v1', algorithm: 'external-components/v1' }],
      source: 'test-only profile; no released SDK is claimed',
    };
    const legacy = {
      protocol: 'reactive-md-config/v1',
      presets: [{ id: 'reactive-md/legacy-default', version: '0.6.9' }],
      components: [],
      themes: [],
    };
    expect(() => readLocalConfig(legacy)).toThrow(/local\.config\.migration-unsupported/);
    const config = readLocalConfig(legacy, [profile]);
    expect(config.protocol).toBe('reactive-md-config/v2');
    expect(config.presets).toMatchObject([{ id: 'reactive-md/legacy-default', version: '0.6.9' }]);
    const alias = config.legacyKeys.find((entry) => entry.profile === 'reactive-md-config/v1');
    expect(alias).toBeDefined();
    expect(alias?.key).not.toBe(config.key);
  });

  it('reports an unsupported legacy identity as a migration diagnostic', () => {
    expect(() => readLocalConfig({
      protocol: 'reactive-md-config/v1',
      presets: [{ id: 'reactive-md/unknown-default', version: '1.0.0' }],
      components: [],
      themes: [],
    })).toThrow(/local\.config\.migration-unsupported/);
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
