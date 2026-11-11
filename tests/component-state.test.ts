import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
  LOCAL_COMPONENT_STATE_FORMAT,
  MAX_COMPONENT_STATE_BYTES,
  createLocalComponentStateRegistry,
  parseLocalComponentStateDocument,
  type LocalComponentStateDocument,
} from '../src/runtime-services';
import { createRandom } from '../src/runtime-services';

const sourceDigest = 'fnv1a32:12345678';

function record(key: string, data: unknown = { score: 1 }): unknown {
  return {
    format: LOCAL_COMPONENT_STATE_FORMAT,
    component: 'example/game',
    componentVersion: '1.0.0',
    stateVersion: 1,
    key,
    data,
  };
}

describe('component state registry', () => {
  it('saves, loads and snapshots one component', () => {
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateVersion: 1,
    });
    expect(handle.load()).toBeNull();
    const saved = handle.save({ score: 7, random: createRandom(9) }, { version: 1 });
    expect(saved.ok).toBe(true);
    expect(handle.load()?.data).toEqual({ score: 7, random: createRandom(9) });
    expect(registry.snapshot().format).toBe(LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT);
    expect(Object.keys(registry.snapshot().records)).toEqual([handle.key]);
  });

  it('restores valid records and skips invalid ones without failing the document', () => {
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const goodKey = registry.key({ nodeId: 'local-1' });
    const badKey = registry.key({ nodeId: 'local-2' });
    const result = registry.restore({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: {
        [goodKey]: record(goodKey, { score: 3 }),
        [badKey]: { ...(record(badKey) as Record<string, unknown>), data: { nested: undefined } },
      },
    });
    expect(result.accepted).toEqual([goodKey]);
    expect(result.skipped).toEqual([badKey]);
    expect(result.diagnostics.some((item) => item.code.startsWith('local.runtime.state'))).toBe(true);
    expect(registry.load(goodKey)?.data).toEqual({ score: 3 });
    expect(registry.load(badKey)).toBeNull();
  });

  it('rejects non-JSON data and oversized records', () => {
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
    });
    expect(handle.save({ value: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(handle.save({ value: () => 1 }).ok).toBe(false);
    expect(handle.save(JSON.parse('{"__proto__":{"x":1}}')).ok).toBe(false);
    const huge = 'x'.repeat(MAX_COMPONENT_STATE_BYTES);
    expect(handle.save({ value: huge }).ok).toBe(false);
  });

  it('detects duplicate explicit state keys', () => {
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const first = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateKey: 'demo',
    });
    const second = registry.handle({
      nodeId: 'local-2',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateKey: 'demo',
    });
    expect(second.duplicate).toBe(true);
    expect(second.load()).toBeNull();
    const result = second.save({ score: 1 });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('local.runtime.state.duplicate-key');
    expect(first.save({ score: 2 }).ok).toBe(true);
    second.clear();
    expect(first.load()?.data).toEqual({ score: 2 });
  });

  it('skips records that do not match a component in the document', () => {
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      knownKeys: new Set(['doc:doc:state:known']),
    });
    const result = registry.restore({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: {
        'doc:doc:state:known': record('doc:doc:state:known', { score: 1 }),
        'doc:doc:state:missing': record('doc:doc:state:missing', { score: 2 }),
      },
    });
    expect(result.accepted).toEqual(['doc:doc:state:known']);
    expect(result.skipped).toEqual(['doc:doc:state:missing']);
    expect(result.diagnostics.some((item) => item.code === 'local.runtime.state.unknown-component')).toBe(true);
  });

  it('skips records that belong to another document', () => {
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const key = registry.key({ nodeId: 'local-1' });
    const result = registry.restore({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: {
        [key]: { ...(record(key) as Record<string, unknown>), documentId: 'other' },
      },
    });
    expect(result.accepted).toEqual([]);
    expect(result.skipped).toEqual([key]);
    expect(result.diagnostics.some((item) => item.code === 'local.runtime.state.document-mismatch')).toBe(true);
  });

  it('re-evaluates known keys on each restore', () => {
    const known = new Set(['doc:doc:state:first']);
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      knownKeys: () => known,
    });
    const second = 'doc:doc:state:second';
    const payload = {
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: {
        'doc:doc:state:first': record('doc:doc:state:first', { score: 1 }),
        [second]: record(second, { score: 2 }),
      },
    };
    expect(registry.restore(payload).accepted).toEqual(['doc:doc:state:first']);
    known.add(second);
    expect(registry.restore(payload).accepted).toEqual(['doc:doc:state:first', second]);
  });

  it('notifies subscribers on save and clear', () => {
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    let changes = 0;
    const unsubscribe = registry.subscribe(() => { changes += 1; });
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
    });
    handle.save({ score: 1 });
    handle.save({ score: 2 });
    handle.clear();
    expect(changes).toBe(3);
    unsubscribe();
    handle.save({ score: 3 });
    expect(changes).toBe(3);
  });

  it('accepts a JSON string sidecar', () => {
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const key = registry.key({ nodeId: 'local-1' });
    const payload = JSON.stringify({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: { [key]: record(key, { score: 1 }) },
    });
    expect(registry.restore(payload).accepted).toEqual([key]);
  });

  it('keeps explicit keys stable across node id changes', () => {
    const first = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const firstHandle = first.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateKey: 'demo',
    });
    firstHandle.save({ score: 4 });
    const restored = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      initial: first.snapshot(),
    });
    const secondHandle = restored.handle({
      nodeId: 'local-99',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateKey: 'demo',
    });
    expect(secondHandle.load()?.data).toEqual({ score: 4 });
  });

  it('writes the current config key into snapshots and restores its own sidecar', () => {
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      configKey: 'rmd-current',
    });
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
    });
    handle.save({ score: 5 });
    expect(registry.snapshot().configKey).toBe('rmd-current');

    const restored = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      configKey: 'rmd-current',
      initial: registry.snapshot(),
    });
    expect(restored.load(handle.key)?.data).toEqual({ score: 5 });
    expect(restored.diagnostics()).toEqual([]);
  });

  it('accepts a sidecar that matches a legacy config key and re-stamps the current one', () => {
    const key = 'doc:doc:state:demo';
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      configKey: 'rmd-current',
      legacyConfigKeys: ['rmd-legacy'],
    });
    const result = registry.restore({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      configKey: 'rmd-legacy',
      records: { [key]: record(key, { score: 6 }) },
    });
    expect(result.accepted).toEqual([key]);
    expect(result.diagnostics).toEqual([]);
    expect(registry.snapshot().configKey).toBe('rmd-current');
  });

  it('skips every record written by another configuration with one warning', () => {
    const key = 'doc:doc:state:demo';
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      configKey: 'rmd-current',
    });
    const result = registry.restore({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      configKey: 'rmd-other',
      records: { [key]: record(key, { score: 7 }) },
    });
    expect(result.accepted).toEqual([]);
    expect(result.skipped).toEqual([key]);
    expect(result.diagnostics.filter((item) => item.code === 'local.runtime.state.config-mismatch')).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(registry.load(key)).toBeNull();
  });

  it('keeps old sidecars without a config key readable', () => {
    const key = 'doc:doc:state:demo';
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      configKey: 'rmd-current',
    });
    const result = registry.restore({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: { [key]: record(key, { score: 8 }) },
    });
    expect(result.accepted).toEqual([key]);
    expect(result.diagnostics).toEqual([]);
    expect(registry.snapshot().configKey).toBe('rmd-current');
  });

  it('rejects a malformed config key in a sidecar document', () => {
    const parsed = parseLocalComponentStateDocument({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      configKey: 7,
      records: {},
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.diagnostics[0]?.code).toBe('local.runtime.state.config-key');
    }
  });
});

describe('component state sidecar parsing', () => {
  it('returns a normalized document and reports skipped records', () => {
    const parsed = parseLocalComponentStateDocument({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: {
        good: record('good', { score: 2 }),
        bad: { ...(record('bad') as Record<string, unknown>), data: undefined },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.document.records)).toEqual(['good']);
    expect(parsed.skipped).toEqual(['bad']);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects payloads that are not a component state document', () => {
    const parsed = parseLocalComponentStateDocument({ format: 'other', records: {} });
    expect(parsed.ok).toBe(false);
    expect(parseLocalComponentStateDocument('not json').ok).toBe(false);
  });
});

describe('component state persistence port', () => {
  function memoryStorage(initial: string | null = null) {
    return {
      value: initial,
      writes: 0,
      reads: 0,
      removes: 0,
      read(): string | null {
        this.reads += 1;
        return this.value;
      },
      write(document: unknown): void {
        this.writes += 1;
        this.value = JSON.stringify(document);
      },
      remove(): void {
        this.removes += 1;
        this.value = null;
      },
    };
  }

  it('restores at creation and persists saves and clears', () => {
    const storage = memoryStorage();
    const registry = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest, storage });
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateKey: 'demo',
    });
    expect(storage.reads).toBe(1);
    expect(handle.load()).toBeNull();

    handle.save({ score: 3 });
    expect(storage.writes).toBe(1);
    expect(JSON.parse(storage.value ?? '{}').records[handle.key].data).toEqual({ score: 3 });

    handle.clear();
    expect(storage.removes).toBe(1);
    expect(storage.value).toBeNull();
  });

  it('coalesces rapid saves into one write when a delay is configured', () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const registry = createLocalComponentStateRegistry({
        documentId: 'doc',
        sourceDigest,
        storage,
        writeDelayMs: 200,
      });
      const handle = registry.handle({
        nodeId: 'local-1',
        component: 'example/game',
        componentVersion: '1.0.0',
      });
      handle.save({ score: 1 });
      handle.save({ score: 2 });
      handle.save({ score: 3 });
      expect(handle.load()?.data).toEqual({ score: 3 });
      expect(storage.writes).toBe(0);

      vi.advanceTimersByTime(199);
      expect(storage.writes).toBe(0);
      vi.advanceTimersByTime(1);
      expect(storage.writes).toBe(1);
      expect(JSON.parse(storage.value ?? '{}').records[handle.key].data).toEqual({ score: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes pending writes immediately and coalesces clears', () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const registry = createLocalComponentStateRegistry({
        documentId: 'doc',
        sourceDigest,
        storage,
        writeDelayMs: 200,
      });
      const handle = registry.handle({
        nodeId: 'local-1',
        component: 'example/game',
        componentVersion: '1.0.0',
      });
      handle.save({ score: 1 });
      registry.flush();
      expect(storage.writes).toBe(1);
      vi.advanceTimersByTime(200);
      expect(storage.writes).toBe(1);
      expect(registry.flush()).toBeUndefined();

      handle.save({ score: 2 });
      handle.clear();
      expect(storage.removes).toBe(0);
      vi.advanceTimersByTime(200);
      expect(storage.removes).toBe(1);
      expect(storage.value).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed write on the next flush', () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      let writes = 0;
      const values = new Map<string, string>();
      const storage = {
        read: () => null,
        write(document: LocalComponentStateDocument): void {
          writes += 1;
          if (fail) throw new Error('quota exceeded');
          values.set('sidecar', JSON.stringify(document));
        },
        remove(): void {
          values.delete('sidecar');
        },
      };
      const registry = createLocalComponentStateRegistry({
        documentId: 'doc',
        sourceDigest,
        storage,
        writeDelayMs: 200,
      });
      const handle = registry.handle({
        nodeId: 'local-1',
        component: 'example/game',
        componentVersion: '1.0.0',
      });
      handle.save({ score: 1 });
      vi.advanceTimersByTime(200);
      expect(writes).toBe(1);
      expect(values.size).toBe(0);

      // The backend recovers; the pending flag must survive the failure.
      fail = false;
      registry.flush();
      expect(writes).toBe(2);
      expect(JSON.parse(values.get('sidecar') ?? '{}').records[handle.key].data).toEqual({ score: 1 });
      registry.flush();
      expect(writes).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists a save before notifying subscribers', () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const registry = createLocalComponentStateRegistry({
        documentId: 'doc',
        sourceDigest,
        storage,
        writeDelayMs: 200,
      });
      const handle = registry.handle({
        nodeId: 'local-1',
        component: 'example/game',
        componentVersion: '1.0.0',
      });
      let restoredData: unknown;
      registry.subscribe(() => {
        // A host may replace the runtime from a notification.
        registry.flush();
        restoredData = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest, storage })
          .load(handle.key)?.data;
      });

      handle.save({ score: 2 });
      expect(storage.writes).toBe(1);
      expect(restoredData).toEqual({ score: 2 });
      vi.advanceTimersByTime(200);
      expect(storage.writes).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid write delay', () => {
    for (const writeDelayMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, '200']) {
      expect(() => createLocalComponentStateRegistry({
        documentId: 'doc',
        sourceDigest,
        writeDelayMs: writeDelayMs as unknown as number,
      })).toThrow(/writeDelayMs/);
    }
  });

  it('persists the current config key with every save', () => {
    const storage = memoryStorage();
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      configKey: 'rmd-current',
      storage,
    });
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
    });
    handle.save({ score: 4 });
    expect(JSON.parse(storage.value ?? '{}').configKey).toBe('rmd-current');
  });

  it('restores a stored sidecar before the first render', () => {
    const seed = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const handle = seed.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateKey: 'demo',
    });
    handle.save({ score: 9 });

    const storage = memoryStorage(JSON.stringify(seed.snapshot()));
    const restored = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest, storage });
    expect(restored.load(handle.key)?.data).toEqual({ score: 9 });
    // Restoring is not a save: the stored payload is left untouched.
    expect(storage.writes).toBe(0);
    expect(storage.removes).toBe(0);
  });

  it('lets an explicit sidecar win over storage', () => {
    const seed = createLocalComponentStateRegistry({ documentId: 'doc', sourceDigest });
    const handle = seed.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
      stateKey: 'demo',
    });
    handle.save({ score: 9 });

    const storage = memoryStorage(JSON.stringify(seed.snapshot()));
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      storage,
      initial: {
        format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
        records: { [handle.key]: record(handle.key, { score: 1 }) },
      },
    });
    expect(storage.reads).toBe(0);
    expect(registry.load(handle.key)?.data).toEqual({ score: 1 });
  });

  it('keeps in-memory state when the backend fails and reports a warning', () => {
    let writes = 0;
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      storage: {
        read: () => null,
        write() {
          writes += 1;
          throw new Error('quota exceeded');
        },
        remove() {},
      },
    });
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
    });
    expect(handle.save({ score: 1 }).ok).toBe(true);
    expect(handle.load()?.data).toEqual({ score: 1 });
    expect(writes).toBe(1);
    const diagnostics = registry.diagnostics().filter((item) => item.code === 'local.runtime.state.storage');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('reports a read failure without blocking the document', () => {
    const registry = createLocalComponentStateRegistry({
      documentId: 'doc',
      sourceDigest,
      storage: {
        read() {
          throw new Error('denied');
        },
        write() {},
        remove() {},
      },
    });
    expect(registry.diagnostics().some((item) => item.code === 'local.runtime.state.storage')).toBe(true);
    const handle = registry.handle({
      nodeId: 'local-1',
      component: 'example/game',
      componentVersion: '1.0.0',
    });
    expect(handle.save({ score: 1 }).ok).toBe(true);
  });
});
