/**
 * Stable identities for document- and component-scoped runtime services.
 *
 * Node ids (`local-<serial>`) are only stable inside one compiled document.
 * They are deliberately never used as a persistent identity on their own.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const textEncoder = new TextEncoder();

const STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DOCUMENT_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/;

export interface LocalDocumentIdentityInput {
  /** Host-supplied stable identity. Falls back to the source digest. */
  readonly documentId?: string;
  /** Deterministic digest of the current source. */
  readonly sourceDigest: string;
}

export interface LocalComponentIdentityInput extends LocalDocumentIdentityInput {
  readonly nodeId: string;
  readonly stateKey?: string;
}

export interface LocalComponentSeedInput {
  /** Explicit component prop; wins over every host default. */
  readonly explicitSeed?: number;
  /** Host document seed. */
  readonly documentSeed: number;
  readonly componentId: string;
  readonly nodeId: string;
  readonly stateKey?: string;
}

/** FNV-1a over UTF-8 bytes. Integrity helper only, never a signature. */
export function fnv1a32(value: string): number {
  const bytes = textEncoder.encode(value);
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** The same digest format used by `reactive-md-state/v1`. */
export function localSourceDigest(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('localSourceDigest requires a source string.');
  }
  return `fnv1a32:${fnv1a32(source).toString(16).padStart(8, '0')}`;
}

export function normalizeDocumentId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return DOCUMENT_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Persistent component key. Explicit `state-key` values are portable across
 * source edits; without one only the current node identity is known.
 */
export function normalizeStateKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return STATE_KEY_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function resolveDocumentId(input: LocalDocumentIdentityInput): string {
  return normalizeDocumentId(input.documentId) ?? input.sourceDigest;
}

export function componentStateKey(input: LocalComponentIdentityInput): string {
  const documentId = resolveDocumentId(input);
  const stateKey = normalizeStateKey(input.stateKey);
  const scope = stateKey === undefined
    ? `node:${input.nodeId}`
    : `state:${stateKey}`;
  const encoded = encodeURIComponent(documentId);
  // Keep the generated key inside MAX_STATE_KEY even for long or non-ASCII
  // document ids. The full id is stored in the record for validation.
  const documentPart = encoded.length <= 256
    ? encoded
    : `h${fnv1a32(documentId).toString(16).padStart(8, '0')}`;
  return `doc:${documentPart}:${scope}`;
}

/** Derive an independent 32-bit seed. Pure: call order never matters. */
export function deriveSeed(seed: number, label: string): number {
  return fnv1a32(`${seed >>> 0}:${label}`);
}

export function resolveComponentSeed(input: LocalComponentSeedInput): number {
  if (typeof input.explicitSeed === 'number' && Number.isFinite(input.explicitSeed)) {
    return Math.trunc(input.explicitSeed) >>> 0;
  }
  const stateKey = normalizeStateKey(input.stateKey);
  const scope = stateKey === undefined ? `node:${input.nodeId}` : `state:${stateKey}`;
  return deriveSeed(input.documentSeed, `${input.componentId}|${scope}`);
}

export function toUint32(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) >>> 0 : 0;
}
