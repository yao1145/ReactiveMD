/**
 * Personal document library for the Playground.
 *
 * The library is independent from the example drafts and the language choice:
 * examples keep their existing storage keys, while every personal document has
 * one stable id, one non-empty name and one source shared by both UI languages.
 *
 * The controller keeps all documents in memory. Browser storage is written
 * through a short debounce so typing stays cheap, and every path that leaves a
 * document (switching documents, switching to examples, hiding or unloading the
 * page) flushes the pending write first. A failed write keeps the in-memory
 * library intact and reports `failed`; a later retry writes the same data again.
 */

export const LIBRARY_STORAGE_KEY = 'reactive-md:documents:v1';

/** Remembers whether the Playground was last showing the personal library. */
export const LIBRARY_MODE_STORAGE_KEY = 'reactive-md:documents:mode';

export const LIBRARY_VERSION = 1;
export const MAX_DOCUMENT_NAME_LENGTH = 80;

const DEFAULT_SAVE_DELAY = 500;

export type LibraryMode = 'example' | 'documents';
export type LibrarySaveStatus = 'saved' | 'saving' | 'failed';
export type LibraryProblem = 'corrupt' | 'unavailable' | null;

export interface LibraryDocument {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LibraryState {
  documents: readonly LibraryDocument[];
  selectedId: string | null;
}

export interface LibrarySnapshot extends LibraryState {
  saveStatus: LibrarySaveStatus;
  problem: LibraryProblem;
}

export interface LibraryLoadResult extends LibraryState {
  problem: LibraryProblem;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface DocumentLibraryOptions {
  /** Returns the storage backend; may throw when the browser blocks it. */
  storage?: () => LibraryStorage | undefined;
  now?: () => number;
  createId?: () => string;
  saveDelay?: number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

function emptyState(): LibraryState {
  return { documents: [], selectedId: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Trim a user-supplied name and enforce the non-empty, bounded contract. */
export function normalizeDocumentName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.slice(0, MAX_DOCUMENT_NAME_LENGTH).trim();
}

/**
 * Pick a readable file stem for exports. Names stay in their original
 * language; only characters that browsers or file systems reject are replaced.
 */
export function documentFileStem(name: string): string {
  const stem = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  return stem || 'document';
}

/** Return `desired`, or the first free `desired (2)`, `desired (3)` variant. */
export function uniqueDocumentName(existing: readonly string[], desired: string): string {
  const base = normalizeDocumentName(desired) ?? 'Document';
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

/**
 * Validate one stored library. Entries with a missing id, empty name or
 * non-string source are dropped; duplicate ids keep the first entry. A broken
 * envelope or any dropped entry sets `problem` to `corrupt` while the valid
 * remainder still loads.
 */
export function readStoredLibrary(raw: unknown, now = Date.now()): LibraryLoadResult {
  if (!isRecord(raw) || raw.version !== LIBRARY_VERSION || !Array.isArray(raw.documents)) {
    return { ...emptyState(), problem: 'corrupt' };
  }

  let corrupt = false;
  const seen = new Set<string>();
  const documents: LibraryDocument[] = [];
  for (const entry of raw.documents) {
    if (!isRecord(entry)) {
      corrupt = true;
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? normalizeDocumentName(entry.name) : null;
    if (!id || !name || typeof entry.source !== 'string' || seen.has(id)) {
      corrupt = true;
      continue;
    }
    seen.add(id);
    const createdAt = isFiniteNumber(entry.createdAt) ? entry.createdAt : now;
    documents.push({
      id,
      name,
      source: entry.source,
      createdAt,
      updatedAt: isFiniteNumber(entry.updatedAt) ? entry.updatedAt : createdAt,
    });
  }

  const requested = typeof raw.selectedId === 'string' ? raw.selectedId : null;
  const selectedId = requested && seen.has(requested) ? requested : documents[0]?.id ?? null;
  if (requested && requested !== selectedId) corrupt = true;

  return {
    documents,
    selectedId,
    problem: corrupt ? 'corrupt' : null,
  };
}

/** Parse one `getItem` value. Unreadable JSON never throws. */
export function parseLibraryText(text: string | null, now = Date.now()): LibraryLoadResult {
  if (text === null) return { ...emptyState(), problem: null };
  try {
    return readStoredLibrary(JSON.parse(text), now);
  } catch {
    return { ...emptyState(), problem: 'corrupt' };
  }
}

export function serializeLibrary(state: LibraryState): string {
  return JSON.stringify({
    version: LIBRARY_VERSION,
    selectedId: state.selectedId,
    documents: state.documents,
  });
}

function defaultCreateId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class DocumentLibrary {
  private documents: readonly LibraryDocument[];
  private selectedId: string | null;
  private saveStatus: LibrarySaveStatus;
  private problem: LibraryProblem;
  private dirty = false;
  private timer: TimerHandle | null = null;
  private listeners = new Set<() => void>();
  private snapshot: LibrarySnapshot;

  private readonly storage: () => LibraryStorage | undefined;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly saveDelay: number;
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  constructor(options: DocumentLibraryOptions = {}) {
    this.storage = options.storage ?? (() => undefined);
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? defaultCreateId;
    this.saveDelay = Math.max(0, options.saveDelay ?? DEFAULT_SAVE_DELAY);
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

    const loaded = this.load();
    this.documents = loaded.documents;
    this.selectedId = loaded.selectedId;
    this.problem = loaded.problem;
    this.saveStatus = loaded.problem === 'unavailable' ? 'failed' : 'saved';
    this.snapshot = this.makeSnapshot();
  }

  getSnapshot = (): LibrarySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getDocument(id: string | null): LibraryDocument | null {
    if (!id) return null;
    return this.documents.find((document) => document.id === id) ?? null;
  }

  /** Create a named document, persist it and make it the current document. */
  createDocument(input: { name: string; source?: string }): LibraryDocument | null {
    const name = normalizeDocumentName(input.name);
    if (!name) return null;
    this.flush();
    const document: LibraryDocument = {
      id: this.makeId(),
      name,
      source: input.source ?? '',
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.documents = [...this.documents, document];
    this.selectedId = document.id;
    this.dirty = true;
    this.write();
    return document;
  }

  /** Select a document. Pending edits of the previous document are flushed. */
  select(id: string): LibraryDocument | null {
    const document = this.getDocument(id);
    if (!document) return null;
    if (this.selectedId === id) return document;
    this.flush();
    this.selectedId = id;
    this.dirty = true;
    this.write();
    return document;
  }

  rename(id: string, name: string): boolean {
    const normalized = normalizeDocumentName(name);
    const document = this.getDocument(id);
    if (!document || !normalized) return false;
    if (document.name === normalized) return true;
    this.documents = this.documents.map((item) => (
      item.id === id ? { ...item, name: normalized, updatedAt: this.now() } : item
    ));
    this.schedule();
    return true;
  }

  /** Copy one document into an independent, separately named document. */
  duplicate(id: string, name: string): LibraryDocument | null {
    const source = this.getDocument(id);
    const normalized = normalizeDocumentName(name);
    if (!source || !normalized) return null;
    this.flush();
    const document: LibraryDocument = {
      id: this.makeId(),
      name: normalized,
      source: source.source,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.documents = [...this.documents, document];
    this.selectedId = document.id;
    this.dirty = true;
    this.write();
    return document;
  }

  /** Mirror one editor change in memory immediately, then save after a pause. */
  updateSource(id: string, source: string): boolean {
    const document = this.getDocument(id);
    if (!document || document.source === source) return false;
    this.documents = this.documents.map((item) => (
      item.id === id ? { ...item, source, updatedAt: this.now() } : item
    ));
    this.schedule();
    return true;
  }

  /** Write any pending change now. Returns false when storage rejected it. */
  flush(): boolean {
    this.cancelTimer();
    if (!this.dirty) return this.saveStatus === 'failed' ? this.write(true) : true;
    return this.write(false);
  }

  /** Retry a failed write without discarding the in-memory library. */
  retry(): boolean {
    return this.write(true);
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }

  private load(): LibraryLoadResult {
    let storage: LibraryStorage | undefined;
    try {
      storage = this.storage();
    } catch {
      return { ...emptyState(), problem: 'unavailable' };
    }
    if (!storage) return { ...emptyState(), problem: 'unavailable' };
    try {
      return parseLibraryText(storage.getItem(LIBRARY_STORAGE_KEY), this.now());
    } catch {
      return { ...emptyState(), problem: 'unavailable' };
    }
  }

  private makeSnapshot(): LibrarySnapshot {
    return Object.freeze({
      documents: this.documents,
      selectedId: this.selectedId,
      saveStatus: this.saveStatus,
      problem: this.problem,
    });
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private schedule(): void {
    this.dirty = true;
    this.saveStatus = 'saving';
    this.cancelTimer();
    this.publish();
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.write(false);
    }, this.saveDelay);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  private write(force = false): boolean {
    this.cancelTimer();
    if (!this.dirty && !force) return this.saveStatus !== 'failed';
    try {
      const storage = this.storage();
      if (!storage) throw new Error('Storage is unavailable');
      storage.setItem(LIBRARY_STORAGE_KEY, serializeLibrary({
        documents: this.documents,
        selectedId: this.selectedId,
      }));
      this.dirty = false;
      this.saveStatus = 'saved';
      if (this.problem === 'unavailable') this.problem = null;
      this.publish();
      return true;
    } catch {
      this.saveStatus = 'failed';
      this.publish();
      return false;
    }
  }

  private makeId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = this.createId().trim();
      if (id && !this.documents.some((document) => document.id === id)) return id;
    }
    return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
