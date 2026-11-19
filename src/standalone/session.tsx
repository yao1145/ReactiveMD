import { LocalDocumentView } from '../local/rendering/document/LocalDocumentView';
import {
  createStandaloneMountWithView,
  mountAllWithView,
  type ReactiveMDMountOptions,
  type StandaloneHostHooks,
} from './session-core';

export { isReactiveMDMounted, REACTIVE_MD_MOUNTED_ATTRIBUTE } from './session-core';
export type { ReactiveMDMountOptions, ReactiveMDHandle, StandaloneHostHooks } from './session-core';

export function createStandaloneMount(element: HTMLElement, options: ReactiveMDMountOptions, hooks?: StandaloneHostHooks) {
  return createStandaloneMountWithView(element, options, LocalDocumentView, hooks);
}

export function mount(element: HTMLElement, options: ReactiveMDMountOptions) {
  return createStandaloneMount(element, options);
}

export function mountAll(root?: ParentNode, host: Pick<ReactiveMDMountOptions, 'reactConfig'> = {}) {
  return mountAllWithView(LocalDocumentView, root, host);
}
