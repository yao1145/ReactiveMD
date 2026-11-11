/**
 * Versioned, bounded component state and an in-memory state registry.
 *
 * This module defines the save protocol. It does not decide where bytes live:
 * the host can export a snapshot, pass it back to a new runtime, or persist it
 * through a browser backend. Multi-instance writing is deliberately explicit;
 * there is no cross-tab synchronization.
 */

import type { Diagnostic } from '../local/contracts/types';
import { componentStateKey, resolveDocumentId } from './identity';
import {
  normalizeRandomState,
  type LocalRandomState,
} from './random';

export const LOCAL_COMPONENT_STATE_FORMAT = 'reactive-md-component-state/v1' as const;
export const LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT =
  'reactive-md-component-state-document/v1' as const;

export const MAX_COMPONENT_STATE_BYTES = 16 * 1024;
export const MAX_COMPONENT_STATE_TOTAL_BYTES = 256 * 1024;
export const MAX_COMPONENT_STATE_DEPTH = 16;
export const MAX_COMPONENT_STATE_ITEMS = 10_000;
export const MAX_COMPONENT_STATE_STRING = 100_000;
export const MAX_COMPONENT_STATE_DOCUMENT_INPUT = 1024 * 1024;

const MAX_COMPONENT_NAME = 128;
const MAX_COMPONENT_VERSION = 64;
const MAX_STATE_KEY = 512;
const MAX_STATE_VERSION = 1_000_000;
const MAX_CONFIG_KEY = 128;
const CONTROL_TEXT = /[\u0000-\u001f\u007f-\u009f]/;

const textEncoder = new TextEncoder();

export type LocalComponentStateData =
  | null
  | boolean
  | number
  | string
  | readonly LocalComponentStateData[]
  | { readonly [key: string]: LocalComponentStateData };

export interface LocalComponentStateRecord {
  readonly format: typeof LOCAL_COMPONENT_STATE_FORMAT;
  readonly component: string;
  readonly componentVersion: string;
  readonly stateVersion: number;
  readonly key: string;
  readonly documentId?: string;
  readonly data: LocalComponentStateData;
  readonly random?: LocalRandomState;
}

export interface LocalComponentStateDocument {
  readonly format: typeof LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT;
  /**
   * Semantic configuration that produced these records. Sidecars written
   * before this field existed restore through the existing record checks; a
   * present value must match the current config key or one of its legacy
   * aliases.
   */
  readonly configKey?: string;
  readonly records: Readonly<Record<string, LocalComponentStateRecord>>;
}

export interface LocalComponentStateSaveResult {
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
  readonly record?: LocalComponentStateRecord;
}

export interface LocalComponentStateRestoreResult {
  readonly accepted: readonly string[];
  readonly skipped: readonly string[];
  readonly diagnostics: Diagnostic[];
}

export interface LocalComponentStateHandleInput {
  readonly nodeId: string;
  readonly component: string;
  readonly componentVersion: string;
  readonly stateKey?: string;
  /** Default state version when `save` does not override it. */
  readonly stateVersion?: number;
}

export interface LocalComponentStateHandle {
  readonly key: string;
  readonly component: string;
  readonly componentVersion: string;
  readonly duplicate: boolean;
  load(): LocalComponentStateRecord | null;
  save(
    data: unknown,
    options?: { version?: number; random?: LocalRandomState },
  ): LocalComponentStateSaveResult;
  clear(): void;
}

export interface LocalComponentStateRegistry {
  readonly documentId: string;
  readonly sourceDigest: string;
  key(input: Omit<LocalComponentStateHandleInput, 'component' | 'componentVersion' | 'stateVersion'>): string;
  handle(input: LocalComponentStateHandleInput): LocalComponentStateHandle;
  load(key: string): LocalComponentStateRecord | null;
  clear(key: string): void;
  snapshot(): LocalComponentStateDocument;
  restore(input: unknown): LocalComponentStateRestoreResult;
  /** Write any pending sidecar now instead of waiting for `writeDelayMs`. */
  flush(): void;
  diagnostics(): readonly Diagnostic[];
  subscribe(listener: () => void): () => void;
}

/**
 * Persistence port. The registry owns the save protocol and calls this after
 * every successful save or clear; with `writeDelayMs` it may call once for
 * several changes. It never syncs across tabs and never reads after creation.
 * Implementations may be in-memory, browser storage or a host service.
 */
export interface LocalComponentStateStorage {
  /**
   * Return the persisted sidecar (JSON text or a JSON-safe value), or `null`
   * when nothing is stored. The registry validates the payload like any other
   * sidecar and skips what does not match.
   */
  read(): unknown;
  /** Persist one complete sidecar. Throwing leaves the in-memory state intact. */
  write(document: LocalComponentStateDocument): void;
  /** Delete the persisted sidecar. */
  remove(): void;
}

export type LocalComponentStateParseResult =
  | {
    readonly ok: true;
    readonly document: LocalComponentStateDocument;
    readonly records: Readonly<Record<string, LocalComponentStateRecord>>;
    readonly diagnostics: Diagnostic[];
    readonly skipped: readonly string[];
  }
  | { readonly ok: false; readonly diagnostics: Diagnostic[] };

function diagnostic(code: string, message: string, severity: 'error' | 'warning' = 'error'): Diagnostic {
  return {
    code,
    message,
    severity,
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isWellFormedText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return false;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** A configuration key is an opaque, bounded identity string. */
function isConfigKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CONFIG_KEY
    && !CONTROL_TEXT.test(value)
    && isWellFormedText(value);
}

function configKeyAccepted(
  saved: string,
  current: string | undefined,
  legacy: readonly string[],
): boolean {
  if (current === undefined) return true;
  return saved === current || legacy.includes(saved);
}

function cloneData(value: unknown, depth: number): LocalComponentStateData {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_COMPONENT_STATE_STRING) {
      throw new RangeError(`strings exceed ${MAX_COMPONENT_STATE_STRING} characters`);
    }
    if (!isWellFormedText(value)) throw new TypeError('strings must be well-formed Unicode');
    return value;
  }
  if (depth >= MAX_COMPONENT_STATE_DEPTH) {
    throw new RangeError(`nesting exceeds ${MAX_COMPONENT_STATE_DEPTH} levels`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COMPONENT_STATE_ITEMS) {
      throw new RangeError(`arrays exceed ${MAX_COMPONENT_STATE_ITEMS} items`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('arrays cannot use symbol keys');
    }
    return value.map((entry) => cloneData(entry, depth + 1));
  }
  if (isPlainRecord(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('objects cannot use symbol keys');
    }
    const keys = Object.keys(value);
    if (keys.length > MAX_COMPONENT_STATE_ITEMS) {
      throw new RangeError(`objects exceed ${MAX_COMPONENT_STATE_ITEMS} keys`);
    }
    const output: Record<string, LocalComponentStateData> = {};
    for (const key of keys) {
      if (key === '__proto__') throw new TypeError('the key "__proto__" is not allowed');
      if (key.length > MAX_COMPONENT_STATE_STRING) {
        throw new RangeError(`keys exceed ${MAX_COMPONENT_STATE_STRING} characters`);
      }
      if (!isWellFormedText(key)) throw new TypeError('keys must be well-formed Unicode');
      output[key] = cloneData(value[key], depth + 1);
    }
    return output;
  }
  throw new TypeError('values must be JSON-safe primitives, arrays or plain objects');
}

function inspectData(value: unknown): LocalComponentStateData {
  return cloneData(value, 0);
}

function cloneRecord(record: LocalComponentStateRecord): LocalComponentStateRecord {
  return Object.freeze({
    ...record,
    data: cloneData(record.data, 0),
    ...(record.random === undefined
      ? {}
      : { random: normalizeRandomState(record.random) ?? record.random }),
  });
}

function normalizeRecord(value: unknown): {
  ok: true;
  record: LocalComponentStateRecord;
} | {
  ok: false;
  diagnostics: Diagnostic[];
} {
  if (!isPlainRecord(value)) {
    return { ok: false, diagnostics: [diagnostic('local.runtime.state.shape', 'A component state record must be a plain object.')] };
  }
  const allowed = new Set([
    'format', 'component', 'componentVersion', 'stateVersion',
    'key', 'documentId', 'data', 'random',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        diagnostics: [diagnostic('local.runtime.state.key', `Unknown component state key "${key}".`)],
      };
    }
  }
  if (value.format !== LOCAL_COMPONENT_STATE_FORMAT) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.runtime.state.format', `Unsupported component state format; expected "${LOCAL_COMPONENT_STATE_FORMAT}".`)],
    };
  }
  const component = value.component;
  if (typeof component !== 'string' || component.trim() === '' || component.length > MAX_COMPONENT_NAME) {
    return { ok: false, diagnostics: [diagnostic('local.runtime.state.component', 'Component name must be a non-empty string.')] };
  }
  const componentVersion = value.componentVersion;
  if (typeof componentVersion !== 'string' || componentVersion.trim() === '' || componentVersion.length > MAX_COMPONENT_VERSION) {
    return { ok: false, diagnostics: [diagnostic('local.runtime.state.component-version', 'Component version must be a non-empty string.')] };
  }
  const stateVersion = value.stateVersion;
  if (typeof stateVersion !== 'number' || !Number.isInteger(stateVersion)
    || stateVersion < 0 || stateVersion > MAX_STATE_VERSION) {
    return { ok: false, diagnostics: [diagnostic('local.runtime.state.version', 'State version must be a non-negative integer.')] };
  }
  const key = value.key;
  if (typeof key !== 'string' || key.trim() === '' || key.length > MAX_STATE_KEY) {
    return { ok: false, diagnostics: [diagnostic('local.runtime.state.key-name', 'State key must be a non-empty string.')] };
  }
  const documentId = value.documentId;
  if (documentId !== undefined
    && (typeof documentId !== 'string' || documentId.trim() === '' || documentId.length > 256)) {
    return { ok: false, diagnostics: [diagnostic('local.runtime.state.document', 'State documentId must be a non-empty string.')] };
  }
  let data: LocalComponentStateData;
  try {
    data = inspectData(value.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, diagnostics: [diagnostic('local.runtime.state.data', `Invalid component state data: ${message}.`)] };
  }
  let random: LocalRandomState | undefined;
  if (value.random !== undefined) {
    random = normalizeRandomState(value.random) ?? undefined;
    if (random === undefined) {
      return { ok: false, diagnostics: [diagnostic('local.runtime.state.random', 'Invalid random state.')] };
    }
  }
  const record: LocalComponentStateRecord = {
    format: LOCAL_COMPONENT_STATE_FORMAT,
    component,
    componentVersion,
    stateVersion,
    key,
    ...(documentId === undefined ? {} : { documentId }),
    data,
    ...(random === undefined ? {} : { random }),
  };
  const bytes = textEncoder.encode(JSON.stringify(record)).length;
  if (bytes > MAX_COMPONENT_STATE_BYTES) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.runtime.state.size', `Component state exceeds the ${MAX_COMPONENT_STATE_BYTES}-byte limit.`)],
    };
  }
  return { ok: true, record: Object.freeze(record) };
}

function parseDocumentInput(input: unknown): {
  ok: true;
  configKey?: string;
  records: Record<string, LocalComponentStateRecord>;
  diagnostics: Diagnostic[];
  skipped: string[];
} | {
  ok: false;
  diagnostics: Diagnostic[];
} {
  let payload = input;
  if (typeof input === 'string') {
    if (input.length > MAX_COMPONENT_STATE_DOCUMENT_INPUT) {
      return {
        ok: false,
        diagnostics: [diagnostic('local.runtime.state.size', 'The component state payload is too large.')],
      };
    }
    try {
      payload = JSON.parse(input);
    } catch {
      return {
        ok: false,
        diagnostics: [diagnostic('local.runtime.state.json', 'The component state payload is not valid JSON.')],
      };
    }
  }
  if (!isPlainRecord(payload)) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.runtime.state.shape', 'The component state document must be a plain object.')],
    };
  }
  if (payload.format !== LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.runtime.state.document-format', `Unsupported component state document format; expected "${LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT}".`)],
    };
  }
  const configKey = payload.configKey;
  if (configKey !== undefined && !isConfigKey(configKey)) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.runtime.state.config-key', 'The component state configKey must be a non-empty bounded string.')],
    };
  }
  if (!isPlainRecord(payload.records)) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.runtime.state.records', 'Component state records must be a plain object.')],
    };
  }
  const records: Record<string, LocalComponentStateRecord> = {};
  const diagnostics: Diagnostic[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  for (const key of Object.keys(payload.records)) {
    const normalized = normalizeRecord(payload.records[key]);
    if (!normalized.ok) {
      skipped.push(key);
      diagnostics.push(...normalized.diagnostics);
      continue;
    }
    if (normalized.record.key !== key) {
      skipped.push(key);
      diagnostics.push(diagnostic(
        'local.runtime.state.key-mismatch',
        `Component state record "${key}" declares a different key "${normalized.record.key}".`,
      ));
      continue;
    }
    totalBytes += textEncoder.encode(JSON.stringify(normalized.record)).length;
    if (totalBytes > MAX_COMPONENT_STATE_TOTAL_BYTES) {
      skipped.push(key);
      diagnostics.push(diagnostic(
        'local.runtime.state.total-size',
        `Component state exceeds the ${MAX_COMPONENT_STATE_TOTAL_BYTES}-byte document limit.`,
      ));
      continue;
    }
    records[key] = normalized.record;
  }
  return { ok: true, ...(configKey === undefined ? {} : { configKey }), records, diagnostics, skipped };
}

/**
 * Validate a sidecar without creating a registry. Individual records that fail
 * validation are skipped and reported; a payload that is not a sidecar at all
 * returns `ok: false`.
 */
export function parseLocalComponentStateDocument(input: unknown): LocalComponentStateParseResult {
  const parsed = parseDocumentInput(input);
  if (!parsed.ok) return parsed;
  const records: Record<string, LocalComponentStateRecord> = {};
  for (const [key, record] of Object.entries(parsed.records)) records[key] = record;
  return {
    ok: true,
    document: Object.freeze({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      ...(parsed.configKey === undefined ? {} : { configKey: parsed.configKey }),
      records: Object.freeze(records),
    }),
    records: Object.freeze(records),
    diagnostics: parsed.diagnostics,
    skipped: parsed.skipped,
  };
}

export interface CreateLocalComponentStateRegistryOptions {
  readonly documentId?: string;
  readonly sourceDigest: string;
  /** Sidecar payload to restore before the first render. */
  readonly initial?: unknown;
  /**
   * Persistence port. When set and `initial` is omitted, the registry restores
   * the stored sidecar; later saves and clears write the complete sidecar back.
   */
  readonly storage?: LocalComponentStateStorage;
  /**
   * Coalesce persistence writes. Memory always updates immediately; with a
   * positive delay the complete sidecar is written at most once per window, so
   * high-frequency saves do not serialize and store on every change. Call
   * `flush()` to write pending state now, for example on `pagehide`. Defaults
   * to 0, which writes synchronously after every save or clear.
   */
  readonly writeDelayMs?: number;
  /**
   * Keys currently present in the document. A function is evaluated at each
   * restore so live document updates are reflected.
   */
  readonly knownKeys?: ReadonlySet<string> | (() => ReadonlySet<string>);
  /**
   * Current semantic configuration key. When set, snapshots and persisted
   * sidecars carry it and restore skips records written by another config.
   */
  readonly configKey?: string;
  /** Legacy configuration identities accepted during restore. */
  readonly legacyConfigKeys?: readonly string[];
}

export function createLocalComponentStateRegistry(
  options: CreateLocalComponentStateRegistryOptions,
): LocalComponentStateRegistry {
  const documentId = resolveDocumentId(options);
  const sourceDigest = options.sourceDigest;
  const knownKeys = options.knownKeys;
  const configKey = options.configKey;
  if (configKey !== undefined && !isConfigKey(configKey)) {
    throw new TypeError('configKey must be a non-empty bounded string.');
  }
  const legacyConfigKeys = Object.freeze((options.legacyConfigKeys ?? []).filter(isConfigKey));
  const writeDelayMs = options.writeDelayMs ?? 0;
  if (typeof writeDelayMs !== 'number' || !Number.isFinite(writeDelayMs) || writeDelayMs < 0) {
    throw new TypeError('writeDelayMs must be a non-negative finite number.');
  }
  const records = new Map<string, LocalComponentStateRecord>();
  const owners = new Map<string, string>();
  const duplicateKeys = new Set<string>();
  const listeners = new Set<() => void>();
  const diagnostics: Diagnostic[] = [];
  const storage = options.storage;
  /** Last storage failure; repeating the same message does not add diagnostics. */
  let storageFailure: string | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistPending = false;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  function persistSidecar(): boolean {
    if (storage === undefined) return true;
    try {
      const document = registry.snapshot();
      if (Object.keys(document.records).length === 0) storage.remove();
      else storage.write(document);
      storageFailure = null;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== storageFailure) {
        storageFailure = message;
        diagnostics.push(diagnostic(
          'local.runtime.state.storage',
          `The component state could not be persisted: ${message}`,
          'warning',
        ));
      }
      return false;
    }
  }

  const clearPersistTimer = (): void => {
    if (persistTimer === null) return;
    clearTimeout(persistTimer);
    persistTimer = null;
  };

  /**
   * Write pending state now. A failed backend keeps the pending flag so the
   * next save, flush or disposal retries instead of dropping the last save.
   */
  function flushPersist(): void {
    if (!persistPending) return;
    clearPersistTimer();
    if (persistSidecar()) persistPending = false;
  }

  const schedulePersist = (): void => {
    if (storage === undefined) return;
    if (writeDelayMs <= 0) {
      persistSidecar();
      return;
    }
    persistPending = true;
    if (persistTimer !== null) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flushPersist();
    }, Math.min(writeDelayMs, 2_147_483_647));
  };

  const totalBytes = (excluding?: string): number => {
    let total = 0;
    for (const [key, record] of records) {
      if (key === excluding) continue;
      total += textEncoder.encode(JSON.stringify(record)).length;
    }
    return total;
  };

  const registry: LocalComponentStateRegistry = {
    documentId,
    sourceDigest,

    key(input): string {
      return componentStateKey({
        documentId,
        sourceDigest,
        nodeId: input.nodeId,
        stateKey: input.stateKey,
      });
    },

    handle(input): LocalComponentStateHandle {
      const key = registry.key({ nodeId: input.nodeId, stateKey: input.stateKey });
      const owner = owners.get(key);
      let duplicate = false;
      if (owner !== undefined && owner !== input.nodeId) {
        duplicate = true;
        if (!duplicateKeys.has(key)) {
          duplicateKeys.add(key);
          diagnostics.push(diagnostic(
            'local.runtime.state.duplicate-key',
            `Component state key "${key}" is used by more than one component instance.`,
          ));
        }
      } else {
        owners.set(key, input.nodeId);
      }

      const handle: LocalComponentStateHandle = {
        key,
        component: input.component,
        componentVersion: input.componentVersion,
        duplicate,
        load(): LocalComponentStateRecord | null {
          if (duplicate) return null;
          const record = records.get(key);
          return record === undefined ? null : cloneRecord(record);
        },
        save(data, saveOptions): LocalComponentStateSaveResult {
          if (duplicate) {
            return {
              ok: false,
              diagnostics: [diagnostic(
                'local.runtime.state.duplicate-key',
                `Component state key "${key}" is used by more than one component instance.`,
              )],
            };
          }
          const version = saveOptions?.version ?? input.stateVersion ?? 0;
          const normalized = normalizeRecord({
            format: LOCAL_COMPONENT_STATE_FORMAT,
            component: input.component,
            componentVersion: input.componentVersion,
            stateVersion: version,
            key,
            documentId,
            data,
            ...(saveOptions?.random === undefined ? {} : { random: saveOptions.random }),
          });
          if (!normalized.ok) return { ok: false, diagnostics: normalized.diagnostics };
          const bytes = textEncoder.encode(JSON.stringify(normalized.record)).length;
          if (totalBytes(key) + bytes > MAX_COMPONENT_STATE_TOTAL_BYTES) {
            return {
              ok: false,
              diagnostics: [diagnostic(
                'local.runtime.state.total-size',
                `Component state exceeds the ${MAX_COMPONENT_STATE_TOTAL_BYTES}-byte document limit.`,
              )],
            };
          }
          records.set(key, normalized.record);
          // Mark the write first: a subscriber may replace this runtime and
          // flush or dispose it before notify() returns.
          schedulePersist();
          notify();
          return { ok: true, diagnostics: [], record: cloneRecord(normalized.record) };
        },
        clear(): void {
          if (duplicate) return;
          if (records.delete(key)) {
            schedulePersist();
            notify();
          }
        },
      };
      return Object.freeze(handle);
    },

    load(key): LocalComponentStateRecord | null {
      const record = records.get(key);
      return record === undefined ? null : cloneRecord(record);
    },

    clear(key): void {
      if (records.delete(key)) {
        schedulePersist();
        notify();
      }
    },

    snapshot(): LocalComponentStateDocument {
      const output: Record<string, LocalComponentStateRecord> = {};
      for (const [key, record] of records) output[key] = cloneRecord(record);
      return Object.freeze({
        format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
        ...(configKey === undefined ? {} : { configKey }),
        records: Object.freeze(output),
      });
    },

    restore(input): LocalComponentStateRestoreResult {
      const parsed = parseDocumentInput(input);
      if (!parsed.ok) {
        diagnostics.push(...parsed.diagnostics);
        return { accepted: [], skipped: [], diagnostics: parsed.diagnostics };
      }
      if (parsed.configKey !== undefined && !configKeyAccepted(parsed.configKey, configKey, legacyConfigKeys)) {
        const skipped = [...new Set([...parsed.skipped, ...Object.keys(parsed.records)])];
        parsed.diagnostics.push(diagnostic(
          'local.runtime.state.config-mismatch',
          `Saved component state belongs to configuration "${parsed.configKey}", not "${configKey}".`,
          'warning',
        ));
        diagnostics.push(...parsed.diagnostics);
        return { accepted: [], skipped, diagnostics: parsed.diagnostics };
      }
      const accepted: string[] = [];
      const known = typeof knownKeys === 'function' ? knownKeys() : knownKeys;
      for (const [key, record] of Object.entries(parsed.records)) {
        if (record.documentId !== undefined && record.documentId !== documentId) {
          parsed.skipped.push(key);
          parsed.diagnostics.push(diagnostic(
            'local.runtime.state.document-mismatch',
            `Saved state key "${key}" belongs to a different document.`,
          ));
          continue;
        }
        if (known !== undefined && !known.has(key)) {
          parsed.skipped.push(key);
          parsed.diagnostics.push(diagnostic(
            'local.runtime.state.unknown-component',
            `Saved state key "${key}" does not match any component in this document.`,
          ));
          continue;
        }
        records.set(key, record);
        accepted.push(key);
      }
      if (parsed.diagnostics.length) diagnostics.push(...parsed.diagnostics);
      if (accepted.length) notify();
      return {
        accepted,
        skipped: parsed.skipped,
        diagnostics: parsed.diagnostics,
      };
    },

    flush(): void {
      flushPersist();
    },

    diagnostics(): readonly Diagnostic[] {
      return Object.freeze([...diagnostics]);
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  let initial = options.initial;
  if (initial === undefined && storage !== undefined) {
    try {
      const stored = storage.read();
      if (stored !== null) initial = stored;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(diagnostic(
        'local.runtime.state.storage',
        `The component state could not be read: ${message}`,
        'warning',
      ));
    }
  }
  if (initial !== undefined) {
    registry.restore(initial);
  }

  return Object.freeze(registry);
}
