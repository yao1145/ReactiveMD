import { LOCAL_PRESET_PROTOCOL, LOCAL_REACT_PRESET_PROTOCOL } from '../sdk/version';
import { createReactHostWithBase, deriveLocalReactPreset, type LocalReactHostInput, type LocalReactPresetPackage } from './package-core';
import { LocalDocumentViewCore, type LocalDocumentViewProps } from './rendering/document/LocalDocumentViewCore';
import { LocalReactiveDocumentCore } from './rendering/document/LocalReactiveDocumentCore';
import type { LocalReactiveDocumentProps } from './rendering/document/LocalDocumentViewCore';
import { createDeferredReactConfigWithDefaults, type CreateDeferredLocalReactConfigOptions, type LocalReactConfig } from './sdk-core';
import type { LocalConfig } from '../sdk/types';
import type { LocalReactComponent } from './component-api';

export { LocalStaticDocumentView } from './rendering/document/LocalStaticDocumentView';
export type { LocalReactPresetPackage, LocalReactHost } from './package-core';
export { deriveLocalReactPreset } from './package-core';
export type { LocalDocumentViewProps, LocalReactiveDocumentProps } from './rendering/document/LocalDocumentViewCore';
export type { CreateDeferredLocalReactConfigOptions, LocalReactComponentResolver, LocalReactTraceContext } from './sdk-core';

const empty: LocalReactPresetPackage = {
  protocol: LOCAL_REACT_PRESET_PROTOCOL,
  preset: { protocol: LOCAL_PRESET_PROTOCOL, id: 'reactive-md/empty', version: '1.0.0', components: [] },
  components: [],
};

export type LocalPackedReactHostInput = Omit<LocalReactHostInput, 'presets'> & {
  readonly presets?: readonly LocalReactPresetPackage[];
};

export function createReactHost(input: LocalPackedReactHostInput = {}) {
  const installed = new Map<string, LocalReactComponent>();
  const presets = (input.presets ?? []).map(pack => {
    const repeated: string[] = [];
    for (const component of pack.components) {
      const { id, name } = component.definition;
      const previous = installed.get(id);
      if (previous === undefined) installed.set(id, component);
      else if (previous.digest === component.digest && previous.render === component.render && previous.renderStatic === component.renderStatic) repeated.push(name);
    }
    return repeated.length ? deriveLocalReactPreset(pack, { exclude: repeated }) : pack;
  });
  return createReactHostWithBase({ ...input, presets }, empty);
}

export function createDeferredReactConfig(input: LocalConfig, options: CreateDeferredLocalReactConfigOptions) {
  return createDeferredReactConfigWithDefaults(input, options, []);
}

let baseConfig: LocalReactConfig | undefined;
const getBaseConfig = () => baseConfig ??= createReactHost().reactConfig;

export function LocalDocumentView(props: LocalDocumentViewProps) {
  return <LocalDocumentViewCore {...props} getBaseConfig={getBaseConfig} />;
}

export function LocalReactiveDocument(props: LocalReactiveDocumentProps) {
  return <LocalReactiveDocumentCore {...props} useBaseCompileConfig getBaseConfig={getBaseConfig} />;
}
