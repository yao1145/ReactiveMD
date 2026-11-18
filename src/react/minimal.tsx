import { minimalReactPresetPackage } from '../components/minimal-preset';
import {
  LocalDocumentViewCore,
  LocalReactiveDocumentCore,
  type LocalDocumentViewProps,
  type LocalReactiveDocumentProps,
} from '../local/rendering/LocalDocumentViewCore';
import { createReactHostWithBase, type LocalReactHostInput } from './package-core';
import { createReactConfigWithDefaults, type CreateLocalReactConfigOptions, type LocalReactConfig } from './sdk-core';
import type { LocalConfig } from '../sdk/types';

export type { LocalDocumentViewProps, LocalReactiveDocumentProps, LocalUrlPolicy, LocalImageResolver } from '../local/rendering/LocalDocumentViewCore';
export { defineReactComponentPackage, defineReactPreset } from './package-core';
export type { LocalReactPackage, LocalReactPresetPackage, LocalReactHostInput, LocalReactHost } from './package-core';
export { defineReactComponent } from './sdk-core';
export type { LocalComponentContext, LocalReactConfig } from './sdk-core';

export function createReactHost(input: LocalReactHostInput = {}) {
  return createReactHostWithBase(input, minimalReactPresetPackage);
}

export function createReactConfig(input: LocalConfig, options: CreateLocalReactConfigOptions) {
  return createReactConfigWithDefaults(input, options, minimalReactPresetPackage.components);
}

let baseConfig: LocalReactConfig | undefined;
const getBaseConfig = () => baseConfig ??= createReactHost().reactConfig;

export function LocalDocumentView(props: LocalDocumentViewProps) {
  return <LocalDocumentViewCore {...props} getBaseConfig={getBaseConfig} />;
}

export function LocalReactiveDocument(props: LocalReactiveDocumentProps) {
  return <LocalReactiveDocumentCore {...props} useBaseCompileConfig getBaseConfig={getBaseConfig} />;
}
