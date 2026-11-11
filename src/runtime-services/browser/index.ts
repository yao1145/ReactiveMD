/**
 * Browser adapter for the component-state persistence port.
 *
 * This module belongs to the browser layer, not the pure `reactive-md/runtime`
 * entry: it reads `localStorage` lazily and never at import time, so server
 * builds can import it without touching `window`.
 */

import type {
  LocalComponentStateDocument,
  LocalComponentStateStorage,
} from '../component-state';
import { MAX_COMPONENT_STATE_DOCUMENT_INPUT } from '../component-state';
import { normalizeDocumentId } from '../identity';

/** The subset of the Web Storage API this adapter needs. */
export interface LocalWebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CreateLocalBrowserStateStorageOptions {
  /**
   * Document identity used to scope the storage key. Use the same value the
   * runtime receives as `documentId`; a source digest is a valid identity but
   * changes when the source changes.
   */
  readonly documentId: string;
  /** Defaults to `globalThis.localStorage`. */
  readonly storage?: LocalWebStorageLike;
  /** Defaults to `reactive-md:component-state:v1:`. */
  readonly keyPrefix?: string;
}

export interface LocalBrowserStateStorage extends LocalComponentStateStorage {
  /** The exact key this backend reads and writes. */
  readonly key: string;
}

export const LOCAL_COMPONENT_STATE_STORAGE_PREFIX = 'reactive-md:component-state:v1:';

const MAX_KEY_PREFIX_LENGTH = 128;

/** Anything that can write pending component state now. */
export interface ComponentStateFlushTarget {
  flush(): void;
}

interface PageLifecycleTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface VisibilityLifecycleTarget extends PageLifecycleTarget {
  readonly visibilityState: string;
}

export interface ComponentStatePageLifecycle {
  /** Window-like object that receives `pagehide`; defaults to the global window. */
  readonly page?: PageLifecycleTarget;
  /** Document-like object that receives `visibilitychange`; defaults to the global document. */
  readonly document?: VisibilityLifecycleTarget;
}

/**
 * Flush pending component-state writes when the page is hidden or unloaded.
 * Timers stop in the background, so the last coalesced save would otherwise
 * wait for the next visible frame. Returns a disposer that only unsubscribes;
 * the runtime flushes on disposal.
 */
export function flushComponentStateOnPageHide(
  target: ComponentStateFlushTarget,
  lifecycle: ComponentStatePageLifecycle = {},
): () => void {
  const scope = globalThis as unknown as Partial<PageLifecycleTarget> & {
    readonly document?: VisibilityLifecycleTarget;
  };
  const page = lifecycle.page
    ?? (typeof scope.addEventListener === 'function' ? scope as PageLifecycleTarget : undefined);
  const document_ = lifecycle.document
    ?? (typeof scope.document?.addEventListener === 'function' ? scope.document : undefined);
  if (page === undefined || document_ === undefined) return () => {};
  const flush = (): void => {
    target.flush();
  };
  const onVisibilityChange = (): void => {
    if (document_.visibilityState === 'hidden') flush();
  };
  page.addEventListener('pagehide', flush);
  document_.addEventListener('visibilitychange', onVisibilityChange);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    page.removeEventListener('pagehide', flush);
    document_.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

function browserStorage(): LocalWebStorageLike {
  let candidate: unknown;
  try {
    candidate = (globalThis as { localStorage?: unknown }).localStorage;
  } catch (error) {
    throw new TypeError(
      `localStorage is unavailable in this context: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    candidate === null
    || typeof candidate !== 'object'
    || typeof (candidate as LocalWebStorageLike).getItem !== 'function'
    || typeof (candidate as LocalWebStorageLike).setItem !== 'function'
    || typeof (candidate as LocalWebStorageLike).removeItem !== 'function'
  ) {
    throw new TypeError('localStorage is unavailable in this context; pass options.storage instead.');
  }
  return candidate as LocalWebStorageLike;
}

/**
 * Persist one document's component-state sidecar in Web Storage. The backend
 * performs no cross-tab synchronization: the registry reads once at creation
 * and hands this backend a complete sidecar whenever it writes. Create the
 * registry with `writeDelayMs` to coalesce high-frequency saves.
 */
export function createLocalBrowserStateStorage(
  options: CreateLocalBrowserStateStorageOptions,
): LocalBrowserStateStorage {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createLocalBrowserStateStorage requires an options object.');
  }
  const documentId = normalizeDocumentId(options.documentId);
  if (documentId === undefined) {
    throw new TypeError('createLocalBrowserStateStorage requires a valid documentId.');
  }
  const keyPrefix = options.keyPrefix ?? LOCAL_COMPONENT_STATE_STORAGE_PREFIX;
  if (typeof keyPrefix !== 'string' || keyPrefix.length === 0 || keyPrefix.length > MAX_KEY_PREFIX_LENGTH) {
    throw new TypeError(`keyPrefix must be a non-empty string of at most ${MAX_KEY_PREFIX_LENGTH} characters.`);
  }
  const storage = options.storage ?? browserStorage();
  const key = `${keyPrefix}${documentId}`;

  return Object.freeze({
    key,
    read(): unknown {
      const text = storage.getItem(key);
      return text === null ? null : text;
    },
    write(document: LocalComponentStateDocument): void {
      const text = JSON.stringify(document);
      if (text.length > MAX_COMPONENT_STATE_DOCUMENT_INPUT) {
        throw new RangeError(
          `The serialized component state exceeds the ${MAX_COMPONENT_STATE_DOCUMENT_INPUT}-character storage budget.`,
        );
      }
      storage.setItem(key, text);
    },
    remove(): void {
      storage.removeItem(key);
    },
  });
}
