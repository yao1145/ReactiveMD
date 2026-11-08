import { createLocalConfig } from '../sdk/config';
import { defineLocalComponent, localComponentDigest } from '../sdk/manifest';
import { readLocalPresetPackage } from '../sdk/preset';
import { LOCAL_COMPONENT_PROTOCOL, LOCAL_REACT_PRESET_PROTOCOL, type LocalComponentDefinition, type LocalConfig, type LocalPresetPackage } from '../sdk/types';
import type { LocalStyleResource, LocalThemePackage } from '../sdk/theme';
import { readLocalExportResources } from '../export/resources';
import { createReactConfig, type LocalReactConfig } from './sdk';
import { defineReactComponent, type LocalReactComponent, type LocalReactComponentImplementation } from './component-api';
import defaultPreset from '../presets/default';
import { createDefaultReactPreset } from '../components/default-preset';

export interface LocalPackageNotice {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly license?: string;
  readonly url?: string;
  readonly text?: string;
}

export type LocalReactComponentPackageInput = Omit<LocalComponentDefinition, 'protocol' | 'form' | 'props'>
  & Partial<Pick<LocalComponentDefinition, 'protocol' | 'form' | 'props'>>
  & LocalReactComponentImplementation & {
    readonly css?: string;
    readonly resources?: readonly LocalStyleResource[];
  };

export interface LocalReactPackage {
  readonly components: readonly LocalReactComponent[];
  readonly resources?: readonly LocalStyleResource[];
  readonly themes?: readonly LocalThemePackage[];
  readonly notices?: readonly LocalPackageNotice[];
}

export interface LocalReactComponentPackage extends LocalReactPackage {
  readonly definition: LocalComponentDefinition;
  readonly resources: readonly LocalStyleResource[];
}

/**
 * Pairs one semantic preset with the React implementations and resources the
 * host installs for it. The pairing is validated by manifest identity, not by
 * array position or preset version alone.
 */
export interface LocalReactPresetPackage {
  readonly protocol: typeof LOCAL_REACT_PRESET_PROTOCOL;
  readonly preset: LocalPresetPackage;
  readonly components: readonly LocalReactComponent[];
  readonly resources?: readonly LocalStyleResource[];
  readonly notices?: readonly LocalPackageNotice[];
}

function readResources(resources: readonly LocalStyleResource[]): readonly LocalStyleResource[] {
  const checked = readLocalExportResources(resources);
  if (checked.diagnostics.length) throw new TypeError(checked.diagnostics.map(item => `[${item.code}] ${item.message}`).join('\n'));
  return checked.resources;
}

/** Validate a semantic preset and its React pairing. */
export function defineReactPreset(input: LocalReactPresetPackage): LocalReactPresetPackage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('defineReactPreset requires a preset package object.');
  }
  if (input.protocol !== LOCAL_REACT_PRESET_PROTOCOL) {
    throw new TypeError(`React preset protocol must be "${LOCAL_REACT_PRESET_PROTOCOL}".`);
  }
  const preset = readLocalPresetPackage(input.preset);
  if (!Array.isArray(input.components)) {
    throw new TypeError('React preset components must be an array.');
  }
  const expected = new Map(preset.components.map((component) => [component.id, component]));
  const seen = new Set<string>();
  const components: LocalReactComponent[] = [];
  for (const component of input.components) {
    const definition = component?.definition;
    if (!definition || typeof definition.id !== 'string') {
      throw new TypeError('React preset contains a component without a manifest definition.');
    }
    const declared = expected.get(definition.id);
    if (!declared) {
      throw new TypeError(`React preset "${preset.id}" has no semantic component "${definition.id}".`);
    }
    if (localComponentDigest(declared) !== localComponentDigest(definition) || component.digest !== localComponentDigest(definition)) {
      throw new TypeError(`React preset component "${definition.id}" does not match its semantic manifest.`);
    }
    if (seen.has(definition.id)) {
      throw new TypeError(`React preset "${preset.id}" declares "${definition.id}" more than once.`);
    }
    seen.add(definition.id);
    components.push(component);
  }
  const missing = preset.components.filter((component) => !seen.has(component.id)).map((component) => component.id);
  if (missing.length > 0) {
    throw new TypeError(`React preset "${preset.id}" is missing implementations for: ${missing.join(', ')}.`);
  }
  const resources = input.resources === undefined ? Object.freeze([]) : readResources(input.resources);
  return Object.freeze({
    protocol: LOCAL_REACT_PRESET_PROTOCOL,
    preset,
    components: Object.freeze(components),
    resources,
    ...(input.notices === undefined ? {} : { notices: Object.freeze([...input.notices]) }),
  });
}

/** Default semantic preset paired with the built-in React implementation table. */
export const defaultReactPresetPackage: LocalReactPresetPackage = defineReactPreset({
  protocol: LOCAL_REACT_PRESET_PROTOCOL,
  preset: defaultPreset,
  components: createDefaultReactPreset().components,
});

/** One authoring declaration; its manifest stays plain data for Worker use. */
export function defineReactComponentPackage(input: LocalReactComponentPackageInput): LocalReactComponentPackage {
  const { render, renderStatic, css, resources = [], ...manifest } = input;
  const styles = manifest.styles ?? [...new Set(css === undefined ? resources.map(item => item.id) : [`${manifest.id}.css`, ...resources.map(item => item.id)])];
  if (css !== undefined && styles.length === 0) throw new TypeError('Inline css requires a style resource identity.');
  const definition = defineLocalComponent({ ...manifest,
    protocol: manifest.protocol === undefined ? LOCAL_COMPONENT_PROTOCOL : manifest.protocol,
    form: manifest.form === undefined ? 'leaf' : manifest.form, props: manifest.props === undefined ? {} : manifest.props,
    ...(styles.length ? { styles } : {}),
  });
  if (css !== undefined && typeof css !== 'string') throw new TypeError('Component css must be an inline string.');
  const checked = readResources([
    ...(css === undefined ? [] : [{ id: styles[0] ?? `${definition.id}.css`, css }]), ...resources,
  ]);
  for (const id of definition.styles ?? []) {
    if (!checked.some(item => item.id === id)) throw new TypeError(`Component ${definition.id} is missing style resource ${id}.`);
  }
  const component = defineReactComponent(definition, { render, ...(renderStatic === undefined ? {} : { renderStatic }) });
  return Object.freeze({ definition, components: Object.freeze([component]), resources: checked });
}

export interface LocalReactHostInput {
  /**
   * React preset packages. Omitted keeps the default preset; `[]` installs no
   * preset. Explicit packages/components never restore the default silently.
   */
  readonly presets?: readonly (LocalReactPresetPackage | 'default')[];
  readonly replacements?: 'allow' | 'forbid';
  readonly packages?: readonly LocalReactPackage[];
  readonly components?: readonly LocalReactComponent[];
  readonly themes?: readonly LocalThemePackage[];
  readonly resources?: readonly LocalStyleResource[];
  readonly notices?: readonly LocalPackageNotice[];
}

export interface LocalReactHost {
  readonly config: LocalReactConfig['config'];
  readonly reactConfig: LocalReactConfig;
  readonly compileOptions: Readonly<{ config: LocalReactConfig['config'] }>;
  readonly resources: readonly LocalStyleResource[];
  readonly css: string;
  readonly notices: readonly LocalPackageNotice[];
}

/**
 * Select the resources owned by the active registry, then explicit host
 * resources, then theme resources. Resources that no active component, host
 * input or selected theme references are not carried into the host result.
 */
function selectLocalResources(
  config: LocalConfig,
  owned: readonly LocalStyleResource[],
  explicit: readonly LocalStyleResource[],
  themes: readonly LocalThemePackage[],
): readonly LocalStyleResource[] {
  const pool = new Map<string, string>();
  const add = (resource: LocalStyleResource, source: string): void => {
    const existing = pool.get(resource.id);
    if (existing !== undefined && existing !== resource.css) {
      throw new TypeError(`Style resource "${resource.id}" has conflicting contents in ${source}.`);
    }
    if (existing === undefined) pool.set(resource.id, resource.css);
  };
  for (const resource of readResources(owned)) add(resource, 'a component or preset package');
  for (const resource of readResources(explicit)) add(resource, 'host resources');
  for (const theme of themes) {
    for (const resource of theme.css) add(resource, `theme "${theme.id}"`);
  }
  const selected: LocalStyleResource[] = [];
  const seen = new Set<string>();
  for (const component of config.registry) {
    for (const id of component.styles ?? []) {
      if (seen.has(id)) continue;
      const css = pool.get(id);
      if (css === undefined) throw new TypeError(`Component ${component.id} is missing style resource ${id}.`);
      seen.add(id);
      selected.push(Object.freeze({ id, css }));
    }
  }
  for (const resource of explicit) {
    if (seen.has(resource.id)) continue;
    const css = pool.get(resource.id) as string;
    seen.add(resource.id);
    selected.push(Object.freeze({ id: resource.id, css }));
  }
  for (const theme of themes) {
    for (const resource of theme.css) {
      if (seen.has(resource.id)) continue;
      seen.add(resource.id);
      selected.push(Object.freeze({ id: resource.id, css: resource.css }));
    }
  }
  return Object.freeze(selected);
}

/** Compose packages once for compiler, renderer, authoring and export. */
export function createReactHost(input: LocalReactHostInput = {}): LocalReactHost {
  const presetInputs = input.presets;
  const semanticPresets = presetInputs === undefined
    ? undefined
    : presetInputs.map((preset) => preset === 'default' ? defaultPreset : preset.preset);
  const presetComponents = presetInputs === undefined
    ? []
    : presetInputs.flatMap((preset) => preset === 'default' ? [] : preset.components);
  const presetResources = presetInputs === undefined
    ? []
    : presetInputs.flatMap((preset) => preset === 'default' ? [] : preset.resources ?? []);
  const packages = input.packages ?? [];
  const components = [...packages.flatMap(item => item.components), ...(input.components ?? [])];
  const config = createLocalConfig({
    ...(semanticPresets === undefined ? {} : { presets: semanticPresets }),
    components: components.map(item => item.definition),
    ...(input.replacements === undefined ? {} : { replacements: input.replacements }),
    themes: [...packages.flatMap(item => item.themes ?? []), ...(input.themes ?? [])],
  });
  const reactConfig = createReactConfig(config, { components: [...presetComponents, ...components] });
  const resources = selectLocalResources(
    config,
    [...presetResources, ...packages.flatMap(item => item.resources ?? [])],
    input.resources ?? [],
    config.themes,
  );
  const notices = Object.freeze([
    ...(presetInputs === undefined ? [] : presetInputs.flatMap((preset) => preset === 'default' ? [] : preset.notices ?? [])),
    ...packages.flatMap(item => item.notices ?? []),
    ...(input.notices ?? []),
  ]);
  return Object.freeze({
    config: reactConfig.config, reactConfig,
    compileOptions: Object.freeze({ config: reactConfig.config }), resources,
    css: resources.map(item => item.css).join('\n'),
    notices,
  });
}
