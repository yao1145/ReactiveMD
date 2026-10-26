import { describe, expect, it } from 'vitest';
import {
  DocumentLibrary,
  LIBRARY_STORAGE_KEY,
  documentFileStem,
  normalizeDocumentName,
  parseLibraryText,
  uniqueDocumentName,
  type LibraryStorage,
} from '../src/document-library';

class MemoryStorage implements LibraryStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('read blocked');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.values.set(key, value);
  }
}

function manualTimers() {
  let callback: (() => void) | null = null;
  return {
    setTimer(next: () => void, _delay: number): ReturnType<typeof setTimeout> {
      callback = next;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(_handle: ReturnType<typeof setTimeout>): void {
      callback = null;
    },
    run(): void {
      const pending = callback;
      callback = null;
      pending?.();
    },
    get pending(): boolean {
      return callback !== null;
    },
  };
}

function setup(options: { storage?: MemoryStorage; now?: number } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const timers = manualTimers();
  let clock = options.now ?? 1_000;
  let nextId = 0;
  const library = new DocumentLibrary({
    storage: () => storage,
    now: () => clock,
    createId: () => `doc-${++nextId}`,
    saveDelay: 10,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return {
    library,
    storage,
    timers,
    setClock(value: number) { clock = value; },
  };
}

function reopen(storage: MemoryStorage) {
  return new DocumentLibrary({
    storage: () => storage,
    now: () => 9_000,
    createId: () => 'unused',
  });
}

describe('document library persistence', () => {
  it('saves a document and reopens it with the same id, name and source', () => {
    const { library, storage, timers } = setup();
    const created = library.createDocument({ name: 'Project notes', source: '# Notes' });
    expect(created).not.toBeNull();
    const id = created!.id;
    expect(library.getSnapshot().selectedId).toBe(id);
    expect(library.getSnapshot().saveStatus).toBe('saved');
    expect(storage.values.has(LIBRARY_STORAGE_KEY)).toBe(true);

    library.updateSource(id, '# Notes\n\nEdited');
    expect(library.getSnapshot().saveStatus).toBe('saving');
    expect(timers.pending).toBe(true);
    timers.run();
    expect(library.getSnapshot().saveStatus).toBe('saved');

    const reopened = reopen(storage);
    expect(reopened.getSnapshot().selectedId).toBe(id);
    expect(reopened.getSnapshot().documents).toEqual([
      expect.objectContaining({ id, name: 'Project notes', source: '# Notes\n\nEdited' }),
    ]);
  });

  it('flushes the latest edit before switching documents', () => {
    const { library, storage, timers } = setup();
    const first = library.createDocument({ name: 'First', source: 'one' })!;
    const second = library.createDocument({ name: 'Second', source: 'two' })!;
    expect(library.select(first.id)).not.toBeNull();

    library.updateSource(first.id, 'one edited');
    expect(timers.pending).toBe(true);

    library.select(second.id);
    expect(timers.pending).toBe(false);

    const reopened = reopen(storage);
    expect(reopened.getSnapshot().documents.find((item) => item.id === first.id)?.source)
      .toBe('one edited');
    expect(reopened.getSnapshot().selectedId).toBe(second.id);
  });

  it('keeps a duplicate independent from the original', () => {
    const { library } = setup();
    const original = library.createDocument({ name: 'Original', source: 'shared' })!;
    const copy = library.duplicate(original.id, 'Original copy');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(original.id);
    expect(library.getSnapshot().selectedId).toBe(copy!.id);

    library.updateSource(copy!.id, 'changed');
    const snapshot = library.getSnapshot();
    expect(snapshot.documents.find((item) => item.id === original.id)?.source).toBe('shared');
    expect(snapshot.documents.find((item) => item.id === copy!.id)?.source).toBe('changed');
  });

  it('renames without changing the source or the stable id', () => {
    const { library } = setup();
    const created = library.createDocument({ name: 'Before', source: 'body' })!;
    expect(library.rename(created.id, '  After  ')).toBe(true);
    const document = library.getSnapshot().documents.find((item) => item.id === created.id);
    expect(document).toMatchObject({ id: created.id, name: 'After', source: 'body' });
    expect(library.rename(created.id, '   ')).toBe(false);
  });
});

describe('document library recovery', () => {
  it('drops corrupted entries but keeps the valid remainder', () => {
    const storage = new MemoryStorage();
    storage.values.set(LIBRARY_STORAGE_KEY, JSON.stringify({
      version: 1,
      selectedId: 'missing',
      documents: [
        { id: 'valid', name: ' Valid name ', source: 'ok', createdAt: 1, updatedAt: 2 },
        { id: 'valid', name: 'Duplicate id', source: 'dropped' },
        { id: '', name: 'No id', source: 'dropped' },
        { id: 'blank', name: '   ', source: 'dropped' },
        { id: 'source-less', name: 'No source' },
        null,
      ],
    }));
    const library = new DocumentLibrary({ storage: () => storage, now: () => 50, createId: () => 'new' });
    const snapshot = library.getSnapshot();
    expect(snapshot.documents).toEqual([
      { id: 'valid', name: 'Valid name', source: 'ok', createdAt: 1, updatedAt: 2 },
    ]);
    expect(snapshot.selectedId).toBe('valid');
    expect(snapshot.problem).toBe('corrupt');
    expect(snapshot.saveStatus).toBe('saved');
  });

  it('starts empty when the stored JSON is unreadable', () => {
    const storage = new MemoryStorage();
    storage.values.set(LIBRARY_STORAGE_KEY, '{not json');
    const library = new DocumentLibrary({ storage: () => storage, now: () => 0, createId: () => 'doc' });
    expect(library.getSnapshot().documents).toEqual([]);
    expect(library.getSnapshot().selectedId).toBeNull();
    expect(library.getSnapshot().problem).toBe('corrupt');
  });

  it('rejects an unknown envelope version instead of guessing', () => {
    const storage = new MemoryStorage();
    storage.values.set(LIBRARY_STORAGE_KEY, JSON.stringify({
      version: 99,
      selectedId: null,
      documents: [{ id: 'kept', name: 'Kept', source: 'x' }],
    }));
    const library = new DocumentLibrary({ storage: () => storage, now: () => 0, createId: () => 'doc' });
    expect(library.getSnapshot().documents).toEqual([]);
    expect(library.getSnapshot().problem).toBe('corrupt');
    expect(parseLibraryText(storage.getItem(LIBRARY_STORAGE_KEY)).problem).toBe('corrupt');
  });
});

describe('document library storage failures', () => {
  it('keeps the library in memory after a failed write and recovers on retry', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const { library } = setup({ storage });
    const created = library.createDocument({ name: 'Kept', source: 'draft' });
    expect(created).not.toBeNull();
    expect(library.getSnapshot().saveStatus).toBe('failed');
    expect(library.getSnapshot().documents).toHaveLength(1);
    expect(storage.values.size).toBe(0);

    storage.failWrites = false;
    expect(library.retry()).toBe(true);
    expect(library.getSnapshot().saveStatus).toBe('saved');
    const reopened = reopen(storage);
    expect(reopened.getSnapshot().documents[0]).toMatchObject({ name: 'Kept', source: 'draft' });
  });

  it('never reports saved when the storage backend is blocked', () => {
    const library = new DocumentLibrary({
      storage: () => { throw new Error('blocked'); },
      now: () => 0,
      createId: () => 'doc',
    });
    expect(library.getSnapshot().problem).toBe('unavailable');
    expect(library.getSnapshot().saveStatus).toBe('failed');
    const created = library.createDocument({ name: 'In memory', source: 'text' });
    expect(created).not.toBeNull();
    expect(library.getSnapshot().documents[0]).toMatchObject({ name: 'In memory', source: 'text' });
    expect(library.getSnapshot().saveStatus).toBe('failed');
    expect(library.retry()).toBe(false);
  });

  it('does not treat a blocked read as an empty saved library', () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    const library = new DocumentLibrary({ storage: () => storage, now: () => 0, createId: () => 'doc' });
    expect(library.getSnapshot().problem).toBe('unavailable');
    expect(library.getSnapshot().saveStatus).toBe('failed');
  });
});

describe('document library naming', () => {
  it('normalizes names and rejects empty ones', () => {
    expect(normalizeDocumentName('   ')).toBeNull();
    expect(normalizeDocumentName('  Project   notes  ')).toBe('Project notes');
    expect(normalizeDocumentName('x'.repeat(200))).toHaveLength(80);
  });

  it('makes duplicated names unique', () => {
    expect(uniqueDocumentName([], 'Notes')).toBe('Notes');
    expect(uniqueDocumentName(['Notes'], 'Notes')).toBe('Notes (2)');
    expect(uniqueDocumentName(['Notes', 'Notes (2)'], 'Notes')).toBe('Notes (3)');
  });

  it('derives a safe export stem while keeping the document language', () => {
    expect(documentFileStem('Quarter/Plan: Q1?')).toBe('Quarter-Plan- Q1');
    expect(documentFileStem('季度计划')).toBe('季度计划');
    expect(documentFileStem('   ')).toBe('document');
  });
});
