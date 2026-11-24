import { createReactHost } from '../../package';
import type { LocalReactConfig } from '../../sdk-core';
import {
  LocalDocumentViewCore,
  type LocalDocumentViewProps,
  type LocalReactiveDocumentProps,
} from './LocalDocumentViewCore';
import { LocalReactiveDocumentCore } from './LocalReactiveDocumentCore';

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
