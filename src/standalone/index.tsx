import '../styles.css';
import './standalone.css';

export { REACTIVE_MD_MOUNTED_ATTRIBUTE, isReactiveMDMounted, mount, mountAll } from './session';
export type { ReactiveMDHandle, ReactiveMDMountOptions } from './session';
export { REACTIVE_MD_DOC_TAG, ReactiveMDDocElement, defineReactiveMDDoc } from './element';
export { parseMountPayload } from './payload';
export type { MountPayloadParseResult } from './payload';
export { prepareStandaloneDocument } from './prepare';
export type { PreparedStandaloneDocument } from './prepare';
export { diagnosticsFromError, ReactiveMDMountError } from './diagnostics';
export { REACTIVE_MD_DIAGNOSTICS_EVENT, REACTIVE_MD_STATE_CHANGE_EVENT } from './events';
export {
  REACTIVE_MD_STANDALONE_GENERATOR,
  REACTIVE_MD_STANDALONE_VERSION,
} from './version';

import { mountAll } from './session';

let autoRunScheduled = false;

/**
 * The shareable HTML export places an `application/reactive-md+json` payload
 * script before the bundled runtime. Scan exactly once; a later manual
 * `mountAll()` call still skips already mounted targets.
 */
function scheduleAutoMount(): void {
  if (autoRunScheduled || typeof document === 'undefined') return;
  autoRunScheduled = true;
  const run = (): void => {
    try {
      mountAll(document);
    } catch (error) {
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('Reactive MD: automatic mounting failed.', error);
      }
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    queueMicrotask(run);
  }
}

scheduleAutoMount();
