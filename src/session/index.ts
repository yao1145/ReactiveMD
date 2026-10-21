import { compile, createRuntime } from '../core';
import type { CompiledDocument, Diagnostic, Json, Runtime, RuntimeOptions } from '../core';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface StoredDocument {
  version: 1;
  id: string;
  source: string;
  signature: string;
  state: Record<string, Json>;
}
export interface SessionOptions {
  id: string;
  storage?: StorageAdapter;
  runtime?: RuntimeOptions;
}
export interface CommittedDocument {
  document: CompiledDocument;
  runtime: Runtime;
  diagnostics: Diagnostic[];
}
export type SessionResult =
  | ({ ok: true; pending: false } & CommittedDocument)
  | { ok: false; pending: boolean; diagnostics: Diagnostic[]; current: CommittedDocument | null };

function storageKey(id: string) { return `reactive-md:document:${encodeURIComponent(id)}`; }
function record(value: unknown): value is Record<string, Json> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function safeKeys(value: unknown, depth = 0): boolean {
  if (depth > 80) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 10000 && value.every(v => safeKeys(v, depth + 1));
  if (!record(value)) return false;
  return Object.entries(value).every(([key, child]) =>
    !['__proto__', 'constructor', 'prototype'].includes(key) && safeKeys(child, depth + 1));
}
export function readSavedDocument(storage: StorageAdapter, id: string): StoredDocument | null {
  try {
    const text = storage.getItem(storageKey(id));
    if (!text || text.length > 2_000_000) return null;
    const value = JSON.parse(text) as StoredDocument;
    if (value.version !== 1 || value.id !== id || typeof value.source !== 'string' ||
        typeof value.signature !== 'string' || !record(value.state) || !safeKeys(value.state)) return null;
    return value;
  } catch { return null; }
}
function shape(value: Json): Json {
  if (value === null) return 'null';
  if (Array.isArray(value)) return ['array'];
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, shape(v)]));
  return typeof value;
}
function signature(document: CompiledDocument) {
  return JSON.stringify({ state: shape(document.initialState), bindings: document.bindings.map(({ componentId: _id, range: _range, ...binding }) => binding) });
}
function warning(code: string, message: string): Diagnostic {
  return { code, message, severity: 'warning', line: 1, column: 1, range: { start: 0, end: 0 } };
}
function compatible(previous: Record<string, Json>, initial: Record<string, Json>): Record<string, Json> {
  return Object.fromEntries(Object.entries(initial).map(([name, value]) => [name,
    Object.prototype.hasOwnProperty.call(previous, name) && JSON.stringify(shape(previous[name])) === JSON.stringify(shape(value))
      ? previous[name] : value]));
}

/** Owns one document identity. A stream commits only successfully compiled prefixes. */
export class DocumentSession {
  private committed: CommittedDocument | null = null;
  private buffer = '';
  private disposed = false;
  private unsubscribe: (() => void) | null = null;
  private restored = false;
  private streamingState: Record<string, Json> | null = null;
  constructor(readonly options: SessionOptions) {
    if (!options.id.trim()) throw new Error('文档 ID 不能为空');
  }
  current() { return this.committed; }
  private assertActive() { if (this.disposed) throw new Error('Document session has been disposed.'); }
  beginStream(prefix = '') {
    this.assertActive();
    this.buffer = prefix;
    this.streamingState = this.committed ? { ...this.committed.runtime.snapshot().state } : {};
  }
  append(chunk: string, final = false): SessionResult {
    this.assertActive();
    this.buffer += chunk;
    if (!final && '```reactive-md'.startsWith(this.buffer.trimStart())) {
      return { ok: false, pending: true, diagnostics: [], current: this.committed };
    }
    const result = this.update(this.buffer, { streaming: true, final, preserveState: true });
    if (final) this.streamingState = null;
    return result;
  }
  update(source: string, options: { streaming?: boolean; final?: boolean; preserveState?: boolean } = {}): SessionResult {
    this.assertActive();
    const result = compile(source);
    if (!result.ok) return {
      ok: false, pending: !!options.streaming && !options.final,
      diagnostics: result.diagnostics, current: this.committed,
    };
    const document = result.document;
    const diagnostics = [...result.diagnostics];
    let initialState: Record<string, Json> | undefined;
    if (this.committed && options.preserveState !== false) {
      initialState = compatible({ ...(options.streaming ? this.streamingState : {}), ...this.committed.runtime.snapshot().state }, document.initialState);
    } else if (!this.restored && this.options.storage && options.preserveState !== false) {
      const stored = readSavedDocument(this.options.storage, this.options.id);
      if (stored && stored.signature === signature(document) && stored.source === source) {
        initialState = stored.state;
      } else if (stored) {
        diagnostics.push(warning('session.restore.schema', '文档结构已更新，已使用当前文档的初始状态。'));
      }
    }
    let runtime: Runtime;
    try {
      runtime = createRuntime(document, { ...this.options.runtime, initialState });
    } catch (error) {
      if (!initialState) throw error;
      diagnostics.push(warning('session.restore.invalid', '保存的状态未通过当前文档校验，已恢复初始值。'));
      runtime = createRuntime(document, this.options.runtime);
    }
    this.restored = true;
    this.unsubscribe?.();
    this.committed?.runtime.dispose();
    this.committed = { document, runtime, diagnostics };
    this.unsubscribe = runtime.subscribe(['*'], () => this.persist());
    this.persist();
    return { ok: true, pending: false, ...this.committed };
  }
  private persist() {
    if (!this.options.storage || !this.committed) return;
    const { document, runtime } = this.committed;
    if (this.streamingState) Object.assign(this.streamingState, runtime.snapshot().state);
    const value: StoredDocument = {
      version: 1, id: this.options.id, source: document.source,
      signature: signature(document), state: { ...runtime.snapshot().state },
    };
    try { this.options.storage.setItem(storageKey(this.options.id), JSON.stringify(value)); }
    catch { /* Storage is optional; an unavailable browser store must not stop interaction. */ }
  }
  clearSaved() {
    try { this.options.storage?.removeItem(storageKey(this.options.id)); } catch { /* optional */ }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.committed?.runtime.dispose();
    this.committed = null;
  }
}
