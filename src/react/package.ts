import { createLocalConfig } from '../sdk/config';
import { defineLocalComponent } from '../sdk/manifest';
import { LOCAL_COMPONENT_PROTOCOL, type LocalComponentDefinition } from '../sdk/types';
import type { LocalStyleResource, LocalThemePackage } from '../sdk/theme';
import { readLocalExportResources } from '../export/resources';
import { createReactConfig, type LocalReactConfig } from './sdk';
import { defineReactComponent, type LocalReactComponent, type LocalReactComponentImplementation } from './component-api';

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

function readResources(resources: readonly LocalStyleResource[]): readonly LocalStyleResource[] {
  const checked = readLocalExportResources(resources);
  if (checked.diagnostics.length) throw new TypeError(checked.diagnostics.map(item => `[${item.code}] ${item.message}`).join('\n'));
  return checked.resources;
}

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

/** Compose packages once for compiler, renderer, authoring and export. */
export function createReactHost(input: LocalReactHostInput = {}): LocalReactHost {
  const packages = input.packages ?? [];
  const components = [...packages.flatMap(item => item.components), ...(input.components ?? [])];
  const config = createLocalConfig({
    components: components.map(item => item.definition),
    themes: [...packages.flatMap(item => item.themes ?? []), ...(input.themes ?? [])],
  });
  const reactConfig = createReactConfig(config, { components });
  const resources = readResources([
    ...packages.flatMap(item => item.resources ?? []), ...(input.resources ?? []),
    ...reactConfig.config.themes.flatMap(item => item.css),
  ]);
  for (const component of config.components) {
    for (const id of component.styles ?? []) {
      if (!resources.some(item => item.id === id)) throw new TypeError(`Component ${component.id} is missing style resource ${id}.`);
    }
  }
  return Object.freeze({
    config: reactConfig.config, reactConfig,
    compileOptions: Object.freeze({ config: reactConfig.config }), resources,
    css: resources.map(item => item.css).join('\n'),
    notices: Object.freeze([...packages.flatMap(item => item.notices ?? []), ...(input.notices ?? [])]),
  });
}
