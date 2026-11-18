import { createReactHost } from '../../react/package';
import type { LocalReactConfig } from '../../react/sdk-core';
import {
  LocalDocumentViewCore,
  LocalReactiveDocumentCore,
  type LocalDocumentViewProps,
  type LocalReactiveDocumentProps,
} from './LocalDocumentViewCore';

export { textProblem } from './LocalDocumentViewCore';
export type { LocalDocumentViewProps, LocalReactiveDocumentProps, LocalUrlPolicy, LocalImageResolver } from './LocalDocumentViewCore';

let baseConfig: LocalReactConfig | undefined;
const getBaseConfig = () => baseConfig ??= createReactHost().reactConfig;

export function LocalDocumentView(props: LocalDocumentViewProps) {
  return <LocalDocumentViewCore {...props} getBaseConfig={getBaseConfig} />;
}

export function LocalReactiveDocument(props: LocalReactiveDocumentProps) {
  return <LocalReactiveDocumentCore {...props} getBaseConfig={getBaseConfig} />;
}
