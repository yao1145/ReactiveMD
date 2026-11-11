import { describe, expect, it } from 'vitest';
import {
  LOCAL_COMPONENT_STATE_STORAGE_PREFIX,
  createLocalBrowserStateStorage,
  flushComponentStateOnPageHide,
} from '../src/runtime-services/browser';
import {
  LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
  LOCAL_COMPONENT_STATE_FORMAT,
  type LocalComponentStateDocument,
} from '../src/runtime-services';

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    },
  };
}

function documentFixture(): LocalComponentStateDocument {
  const key = 'doc:doc:state:demo';
  return {
    format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
    records: {
      [key]: {
        format: LOCAL_COMPONENT_STATE_FORMAT,
        component: 'example/game',
        componentVersion: '1.0.0',
        stateVersion: 1,
        key,
        documentId: 'doc',
        data: { score: 4 },
      },
    },
  };
}

describe('browser component state storage', () => {
  it('scopes the key by documentId and persists JSON text', () => {
    const storage = fakeStorage();
    const backend = createLocalBrowserStateStorage({ documentId: 'doc', storage });
    expect(backend.key).toBe(`${LOCAL_COMPONENT_STATE_STORAGE_PREFIX}doc`);
    expect(backend.read()).toBeNull();

    backend.write(documentFixture());
    const text = storage.getItem(backend.key);
    expect(typeof text).toBe('string');
    expect(JSON.parse(text ?? '{}').records['doc:doc:state:demo'].data).toEqual({ score: 4 });
    expect(backend.read()).toBe(text);

    backend.remove();
    expect(backend.read()).toBeNull();
  });

  it('accepts a custom prefix and keeps it bounded', () => {
    const storage = fakeStorage();
    const backend = createLocalBrowserStateStorage({
      documentId: 'doc',
      storage,
      keyPrefix: 'test:',
    });
    expect(backend.key).toBe('test:doc');
    expect(() => createLocalBrowserStateStorage({ documentId: 'doc', storage, keyPrefix: '' }))
      .toThrow(/keyPrefix/);
    expect(() => createLocalBrowserStateStorage({
      documentId: 'doc',
      storage,
      keyPrefix: 'x'.repeat(129),
    })).toThrow(/keyPrefix/);
  });

  it('rejects invalid document identities', () => {
    const storage = fakeStorage();
    for (const documentId of ['', '   ', 'bad\u0000id', 'x'.repeat(257), 7, null]) {
      expect(() => createLocalBrowserStateStorage({
        documentId: documentId as unknown as string,
        storage,
      })).toThrow(/documentId/);
    }
  });

  it('leaves an unavailable default storage to the caller', () => {
    expect(() => createLocalBrowserStateStorage({ documentId: 'doc' }))
      .toThrow(/localStorage is unavailable/);
  });
});

function lifecycleTarget(initialVisibility = 'visible') {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState: initialVisibility,
    addEventListener(type: string, listener: () => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string): void {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    count(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

describe('component state page lifecycle', () => {
  it('flushes on pagehide and when the page becomes hidden', () => {
    const page = lifecycleTarget();
    const document = lifecycleTarget();
    let flushes = 0;
    const dispose = flushComponentStateOnPageHide({ flush: () => { flushes += 1; } }, { page, document });

    page.dispatch('pagehide');
    expect(flushes).toBe(1);

    document.visibilityState = 'visible';
    document.dispatch('visibilitychange');
    expect(flushes).toBe(1);
    document.visibilityState = 'hidden';
    document.dispatch('visibilitychange');
    expect(flushes).toBe(2);

    dispose();
    page.dispatch('pagehide');
    document.dispatch('visibilitychange');
    expect(flushes).toBe(2);
    expect(page.count('pagehide')).toBe(0);
    expect(document.count('visibilitychange')).toBe(0);
    dispose();
  });

  it('does nothing without a browser document', () => {
    const dispose = flushComponentStateOnPageHide({ flush: () => {} });
    expect(typeof dispose).toBe('function');
    dispose();
  });
});
