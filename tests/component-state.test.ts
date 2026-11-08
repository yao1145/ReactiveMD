import { describe, expect, it } from 'vitest';
import {
  LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
  LOCAL_COMPONENT_STATE_FORMAT,
  MAX_COMPONENT_STATE_BYTES,
  createLocalComponentStateRegistry,
  parseLocalComponentStateDocument,
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
