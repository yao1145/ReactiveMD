import { createLocalConfig, type LocalStyleResource, type LocalThemePackage } from 'reactive-md/sdk';
import { createReactConfig, type LocalReactComponent } from 'reactive-md/react';
import { readLocalExportResources } from 'reactive-md/export';
import type { LocalBuildNoticeInput } from 'reactive-md/build';
import type { PlaygroundExample } from './examples';

/** Demo host contributions; component manifests remain the public SDK contract. */
export interface DemoExtension {
  readonly components?: readonly LocalReactComponent[];
  readonly themes?: readonly LocalThemePackage[];
  /** Inline CSS, with data URLs for any fonts or images. */
  readonly resources?: readonly LocalStyleResource[];
  readonly examples?: readonly PlaygroundExample[];
  readonly notices?: readonly LocalBuildNoticeInput[];
}

export function createDemoExtensions(extensions: readonly DemoExtension[]) {
  const components = extensions.flatMap(extension => extension.components ?? []);
  const config = createLocalConfig({
    components: components.map(component => component.definition),
    themes: extensions.flatMap(extension => extension.themes ?? []),
  });
  const reactConfig = createReactConfig(config, { components });
  const styles = readLocalExportResources([
    ...extensions.flatMap(extension => extension.resources ?? []),
    ...config.themes.flatMap(theme => theme.css),
  ]);
  if (styles.diagnostics.length) throw new Error(styles.diagnostics.map(item => item.message).join('\n'));
  for (const component of config.components) {
    for (const id of component.styles ?? []) {
      if (!styles.resources.some(resource => resource.id === id)) {
        throw new Error(`Demo extension ${component.id} is missing style resource ${id}.`);
      }
    }
  }
  const examples = extensions.flatMap(extension => extension.examples ?? []);
  if (new Set(examples.map(example => example.id)).size !== examples.length) {
    throw new Error('Demo extensions contain duplicate example IDs.');
  }
  return Object.freeze({
    config: reactConfig.config,
    reactConfig,
    resources: styles.resources,
    css: styles.resources.map(resource => resource.css).join('\n'),
    examples: Object.freeze(examples),
    notices: Object.freeze(extensions.flatMap(extension => extension.notices ?? [])),
  });
}
