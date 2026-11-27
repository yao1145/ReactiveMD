import { LOCAL_PRESET_PROTOCOL, LOCAL_REACT_PRESET_PROTOCOL } from '../sdk/version';
import { createReactHostWithBase, type LocalReactHostInput, type LocalReactPresetPackage } from './package-core';
import { LocalDocumentViewCore, type LocalDocumentViewProps } from './rendering/document/LocalDocumentViewCore';
import { LocalReactiveDocumentCore } from './rendering/document/LocalReactiveDocumentCore';
import type { LocalReactiveDocumentProps } from './rendering/document/LocalDocumentViewCore';
import { createDeferredReactConfigWithDefaults, type CreateDeferredLocalReactConfigOptions, type LocalReactConfig } from './sdk-core';
import type { LocalConfig } from '../sdk/types';

export { LocalStaticDocumentView } from './rendering/document/LocalStaticDocumentView';
export type { LocalReactPresetPackage, LocalReactHost } from './package-core';
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
  return createReactHostWithBase({ ...input, presets: input.presets ?? [] }, empty);
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
