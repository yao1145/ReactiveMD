import { LocalDocumentViewCore, type LocalDocumentViewProps } from '../local/rendering/LocalDocumentViewCore';
import type { LocalReactConfig } from '../react/sdk-core';
import { mountAllWithView } from './session-core';

function ConfiguredDocumentView(props: LocalDocumentViewProps) {
  const { reactConfig } = props;
  if (!reactConfig) throw new TypeError('A standalone host requires an installed React configuration.');
  return <LocalDocumentViewCore {...props} getBaseConfig={() => reactConfig} />;
}

/** Mount with the bundle's own implementations. */
export function mountAll(root: ParentNode | undefined, host: { readonly reactConfig: LocalReactConfig }) {
  return mountAllWithView(ConfiguredDocumentView, root, host);
}
