import { MAX_LOCAL_DIAGNOSTICS, MAX_LOCAL_DIAGNOSTIC_LENGTH } from './limits';
import { createLocalRuntime } from './runtime';
import { LOCAL_SYNTAX_VERSION } from './version';
import type {
  Diagnostic,
  LocalBinding,
  LocalDocument,
  LocalNode,
  LocalRuntime,
  LocalValue,
} from './types';

/** Version tag for the portable, shareable parameter state format. */
export const LOCAL_STATE_FORMAT = 'reactive-md-state/v1' as const;

/** Default payload budget: one mebibyte of JSON text. */
const DEFAULT_MAX_STATE_LENGTH = 1024 * 1024;

/** FNV-1a is an integrity check, not a security signature. */
const DIGEST_PATTERN = /^fnv1a32:[0-9a-f]{8}$/;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const TOP_LEVEL_KEYS = new Set(['format', 'syntax', 'sourceDigest', 'parameters', 'generator']);
const GENERATOR_KEYS = new Set(['name', 'version']);

const textEncoder = new TextEncoder();

export interface LocalStateGenerator {
  name: string;
  version: string;
}

export interface LocalStateFile {
  format: typeof LOCAL_STATE_FORMAT;
  /** Syntax revision the state was produced for (`local-draft-2`). */
  syntax: string;
  /** Deterministic digest of the document source. */
  sourceDigest: string;
  /** Public binding name -> serializable value. */
  parameters: Record<string, LocalValue>;
  generator?: LocalStateGenerator;
}

export type LocalStateParseResult =
  | { ok: true; file: LocalStateFile }
  | { ok: false; diagnostics: Diagnostic[] };

export type LocalStateResolution =
  | { ok: true; file: LocalStateFile; state: Readonly<Record<string, LocalValue>> }
  | { ok: false; diagnostics: Diagnostic[] };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function diagnostic(code: string, message: string): Diagnostic {
  const text = message.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
    ? `${message.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
    : message;
  return {
    code,
    message: text,
    severity: 'error',
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

function pushDiagnostic(list: Diagnostic[], code: string, message: string): void {
  if (list.length < MAX_LOCAL_DIAGNOSTICS) list.push(diagnostic(code, message));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reject unpaired UTF-16 surrogates; JSON cannot represent them portably. */
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

/** FNV-1a over the UTF-8 bytes of the source. */
export function localSourceDigest(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('localSourceDigest requires a source string.');
  }
  const bytes = textEncoder.encode(source);
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

type NormalizedValue = { ok: true; value: LocalValue } | { ok: false; message: string };

/** Accept only JSON-safe primitive values and string arrays; clone arrays. */
function normalizeStateValue(value: unknown): NormalizedValue {
  if (typeof value === 'string') {
    if (!isWellFormedText(value)) return { ok: false, message: 'contains malformed Unicode.' };
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, message: 'must be a finite number.' };
    return { ok: true, value };
  }
  if (typeof value === 'boolean' || value === null) return { ok: true, value };
  if (Array.isArray(value)) {
    const clone: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const entry: unknown = value[index];
      if (typeof entry !== 'string') return { ok: false, message: 'must be an array of strings.' };
      if (!isWellFormedText(entry)) return { ok: false, message: 'contains malformed Unicode.' };
      clone.push(entry);
    }
    return { ok: true, value: Object.freeze(clone) as unknown as LocalValue };
  }
  return { ok: false, message: 'must be a string, finite number, boolean, null or string array.' };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezeFile(file: LocalStateFile): LocalStateFile {
  Object.freeze(file.parameters);
  if (file.generator) Object.freeze(file.generator);
  return Object.freeze(file);
}

function normalizeGenerator(generator: LocalStateGenerator): LocalStateGenerator {
  if (!generator || typeof generator !== 'object' || Array.isArray(generator)) {
    throw new TypeError('generator must be an object with string name and version.');
  }
  if (typeof generator.name !== 'string' || typeof generator.version !== 'string') {
    throw new TypeError('generator must have string name and version.');
  }
  if (!isWellFormedText(generator.name) || !isWellFormedText(generator.version)) {
    throw new TypeError('generator name and version must be well-formed Unicode strings.');
  }
  return Object.freeze({ name: generator.name, version: generator.version });
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    const sample = value.length > 48 ? `${value.slice(0, 48)}…` : value;
    return `"${sample}"`;
  }
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** Size in UTF-8 bytes, short-circuiting once the budget is exceeded. */
function payloadLength(text: string, maxLength: number): number {
  if (text.length > maxLength) return text.length;
  return textEncoder.encode(text).byteLength;
}

/** Measure an already parsed payload by serializing it as JSON. */
function measureSerialized(value: unknown, maxLength: number): number | null {
  let text: string;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') return null;
    text = serialized;
  } catch {
    return null;
  }
  return payloadLength(text, maxLength);
}

function readMaxLength(options?: { maxLength?: number }): number {
  if (options === undefined) return DEFAULT_MAX_STATE_LENGTH;
  if (options === null || typeof options !== 'object') {
    throw new TypeError('parseLocalState options must be an object.');
  }
  const { maxLength } = options;
  if (maxLength === undefined) return DEFAULT_MAX_STATE_LENGTH;
  if (typeof maxLength !== 'number' || !Number.isSafeInteger(maxLength) || maxLength <= 0) {
    throw new RangeError('maxLength must be a finite positive integer.');
  }
  return maxLength;
}

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

/**
 * Capture every public binding from a runtime state. Internal `@...` binding
 * keys are intentionally ignored so a full runtime snapshot can be passed in;
 * unknown keys, missing public keys and non-serializable values are rejected.
 */
export function createLocalStateFile(
  document: LocalDocument,
  state: Readonly<Record<string, LocalValue>>,
  generator?: LocalStateGenerator,
): LocalStateFile {
  if (!document || document.syntax !== 'local' || typeof document.source !== 'string') {
    throw new TypeError('createLocalStateFile requires a compiled local document.');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('createLocalStateFile requires a state object.');
  }

  const publicKeys = Object.keys(document.bindings)
    .filter((key) => !key.startsWith('@'))
    .sort();
  const publicSet = new Set(publicKeys);
  const captured = new Map<string, LocalValue>();

  for (const key of Object.keys(state)) {
    if (key.startsWith('@')) {
      if (!Object.hasOwn(document.bindings, key)) {
        throw new Error(`Cannot persist parameter "${key}": it is not a binding of this document.`);
      }
      continue;
    }
    if (!publicSet.has(key)) {
      throw new Error(`Cannot persist parameter "${key}": it is not a public binding of this document.`);
    }
    const result = normalizeStateValue(state[key]);
    if (!result.ok) {
      throw new TypeError(`Cannot persist parameter "${key}": the value ${result.message}`);
    }
    captured.set(key, result.value);
  }

  const parameters: Record<string, LocalValue> = {};
  for (const key of publicKeys) {
    if (!captured.has(key)) {
      throw new Error(`Cannot persist the document: parameter "${key}" is missing from the supplied state.`);
    }
    parameters[key] = captured.get(key) as LocalValue;
  }

  const file: LocalStateFile = {
    format: LOCAL_STATE_FORMAT,
    syntax: LOCAL_SYNTAX_VERSION,
    sourceDigest: localSourceDigest(document.source),
    parameters,
  };
  if (generator !== undefined) file.generator = normalizeGenerator(generator);
  return freezeFile(file);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function parseLocalStateUnsafe(input: unknown, maxLength: number): LocalStateParseResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string): void => pushDiagnostic(diagnostics, code, message);

  let payload: unknown = input;
  if (typeof input === 'string') {
    if (payloadLength(input, maxLength) > maxLength) {
      return {
        ok: false,
        diagnostics: [diagnostic(
          'local.state.size',
          `The state payload exceeds the ${maxLength}-byte limit.`,
        )],
      };
    }
    if (!isWellFormedText(input)) {
      return { ok: false, diagnostics: [diagnostic('local.state.utf', 'The state payload contains malformed Unicode.')] };
    }
    try {
      payload = JSON.parse(input);
    } catch (error) {
      return {
        ok: false,
        diagnostics: [diagnostic('local.state.json', `The state payload is not valid JSON: ${errorText(error)}`)],
      };
    }
  } else {
    const length = measureSerialized(input, maxLength);
    if (length === null) {
      return { ok: false, diagnostics: [diagnostic('local.state.shape', 'The state payload must be a JSON object.')] };
    }
    if (length > maxLength) {
      return {
        ok: false,
        diagnostics: [diagnostic(
          'local.state.size',
          `The state payload exceeds the ${maxLength}-byte limit.`,
        )],
      };
    }
  }

  if (!isPlainRecord(payload)) {
    return { ok: false, diagnostics: [diagnostic('local.state.shape', 'The state payload must be a JSON object.')] };
  }
  if (Object.getOwnPropertySymbols(payload).length > 0) {
    fail('local.state.shape', 'The state payload cannot use symbol keys.');
  }

  for (const key of Object.keys(payload)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail('local.state.key', `Unknown top-level state key "${key}".`);
    }
  }

  const format = payload.format;
  if (format !== LOCAL_STATE_FORMAT) {
    fail('local.state.format', `Unsupported state format ${describeValue(format)}; expected "${LOCAL_STATE_FORMAT}".`);
  }

  const syntax = payload.syntax;
  if (syntax !== LOCAL_SYNTAX_VERSION) {
    fail('local.state.syntax', `Unsupported state syntax ${describeValue(syntax)}; expected "${LOCAL_SYNTAX_VERSION}".`);
  }

  const sourceDigest = payload.sourceDigest;
  if (typeof sourceDigest !== 'string' || !DIGEST_PATTERN.test(sourceDigest)) {
    fail('local.state.digest', 'sourceDigest must match "fnv1a32:" followed by 8 lowercase hexadecimal digits.');
  }

  const parameters: Record<string, LocalValue> = {};
  const rawParameters = payload.parameters;
  if (!isPlainRecord(rawParameters)) {
    fail('local.state.parameters', 'parameters must be a JSON object of public binding values.');
  } else {
    for (const key of Object.keys(rawParameters).sort()) {
      if (key === '__proto__') {
        fail('local.state.parameter.prototype', 'Parameter names cannot be "__proto__".');
        continue;
      }
      if (key.startsWith('@')) {
        fail('local.state.parameter.internal', `Internal parameter "${key}" cannot be persisted.`);
        continue;
      }
      const result = normalizeStateValue(rawParameters[key]);
      if (!result.ok) {
        fail('local.state.parameter.value', `Parameter "${key}" ${result.message}`);
        continue;
      }
      parameters[key] = result.value;
    }
  }

  let generator: LocalStateGenerator | undefined;
  if (Object.hasOwn(payload, 'generator')) {
    const rawGenerator = payload.generator;
    if (!isPlainRecord(rawGenerator)) {
      fail('local.state.generator', 'generator must be an object with string name and version.');
    } else {
      for (const key of Object.keys(rawGenerator)) {
        if (!GENERATOR_KEYS.has(key)) {
          fail('local.state.generator', `generator has unknown key "${key}".`);
        }
      }
      if (typeof rawGenerator.name !== 'string' || typeof rawGenerator.version !== 'string') {
        fail('local.state.generator', 'generator must have string name and version.');
      } else if (!isWellFormedText(rawGenerator.name) || !isWellFormedText(rawGenerator.version)) {
        fail('local.state.utf', 'generator contains malformed Unicode.');
      } else {
        generator = Object.freeze({ name: rawGenerator.name, version: rawGenerator.version });
      }
    }
  }

  if (diagnostics.length) return { ok: false, diagnostics };

  const file: LocalStateFile = {
    format: LOCAL_STATE_FORMAT,
    syntax: LOCAL_SYNTAX_VERSION,
    sourceDigest: sourceDigest as string,
    parameters,
  };
  if (generator) file.generator = generator;
  return { ok: true, file: freezeFile(file) };
}

/**
 * Parse a serialized state file (or an already parsed value). Malformed input
 * never throws; it produces diagnostics under `local.state.*` at 1:1.
 */
export function parseLocalState(
  input: string | unknown,
  options?: { maxLength?: number },
): LocalStateParseResult {
  const maxLength = readMaxLength(options);
  try {
    return parseLocalStateUnsafe(input, maxLength);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.state.invalid', `Cannot read the local state: ${errorText(error)}`)],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Binding plans                                                       */
/* ------------------------------------------------------------------ */

interface PublicBindingPlan {
  key: string;
  binding: LocalBinding;
  node?: LocalNode;
  /** Set when the binding belongs to a multi-slot component. */
  slot?: string;
}

interface SlotGroupPlan {
  node: LocalNode;
  slots: { slot: string; key: string }[];
}

interface BindingPlans {
  plans: PublicBindingPlan[];
  groups: SlotGroupPlan[];
}

function indexNodes(document: LocalDocument): Map<string, LocalNode> {
  const index = new Map<string, LocalNode>();
  const walk = (nodes: LocalNode[]): void => {
    for (const node of nodes) {
      index.set(node.id, node);
      if (node.children) walk(node.children);
    }
  };
  walk(document.nodes);
  return index;
}

function collectBindingPlans(document: LocalDocument): BindingPlans {
  const nodes = indexNodes(document);
  const slotBindings = new Map<string, { node: LocalNode; slot: string }>();
  const groups: SlotGroupPlan[] = [];

  for (const [nodeId, slots] of Object.entries(document.bindingSlots ?? {})) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    const group: SlotGroupPlan = { node, slots: [] };
    for (const [slot, key] of Object.entries(slots)) {
      // Internal slots still belong to the group: seeding a temporary runtime
      // from a live snapshot must restore them atomically with public slots.
      group.slots.push({ slot, key });
      if (!key.startsWith('@')) slotBindings.set(key, { node, slot });
    }
    if (group.slots.length) groups.push(group);
  }

  const plans: PublicBindingPlan[] = [];
  for (const [key, binding] of Object.entries(document.bindings)) {
    if (key.startsWith('@')) continue;
    const slot = slotBindings.get(key);
    if (slot) {
      plans.push({ key, binding, node: slot.node, slot: slot.slot });
      continue;
    }
    const owner = binding.owner && nodes.has(binding.owner)
      ? binding.owner
      : binding.nodeIds.find((id) => nodes.has(id));
    plans.push({ key, binding, node: owner ? nodes.get(owner) : undefined });
  }
  return { plans, groups };
}

/** Write a value map through the runtime, batching multi-slot components. */
function writeValues(
  runtime: LocalRuntime,
  plans: BindingPlans,
  values: Readonly<Record<string, LocalValue>>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const plan of plans.plans) {
    if (plan.slot !== undefined) continue;
    if (!Object.hasOwn(values, plan.key)) continue;
    if (!plan.node) {
      diagnostics.push(diagnostic(
        'local.state.document',
        `The document has no component for parameter "${plan.key}".`,
      ));
      continue;
    }
    diagnostics.push(...runtime.set(plan.node, values[plan.key]));
  }

  for (const group of plans.groups) {
    const payload: Record<string, LocalValue> = {};
    let any = false;
    for (const { slot, key } of group.slots) {
      if (!Object.hasOwn(values, key)) continue;
      payload[slot] = values[key];
      any = true;
    }
    if (any) diagnostics.push(...runtime.setMany(group.node, payload));
  }

  return diagnostics;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

function publicStateSnapshot(
  runtime: LocalRuntime,
  expectedKeys: string[],
): Readonly<Record<string, LocalValue>> {
  const snapshot = runtime.snapshot();
  const state: Record<string, LocalValue> = {};
  for (const key of expectedKeys) {
    const value = snapshot.state[key];
    state[key] = Array.isArray(value)
      ? (Object.freeze([...value]) as unknown as LocalValue)
      : value;
  }
  return Object.freeze(state);
}

function resolveInternal(
  document: LocalDocument,
  input: string | unknown,
  baseline?: Readonly<Record<string, LocalValue>>,
): LocalStateResolution {
  const parsed = parseLocalState(input);
  if (!parsed.ok) return parsed;

  if (
    !document
    || document.syntax !== 'local'
    || typeof document.source !== 'string'
    || !Array.isArray(document.nodes)
    || !document.bindings
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.state.document', 'resolveLocalState requires a compiled local document.')],
    };
  }

  if (parsed.file.syntax !== LOCAL_SYNTAX_VERSION) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'local.state.syntax',
        `This state file uses syntax "${parsed.file.syntax}", but this build accepts "${LOCAL_SYNTAX_VERSION}".`,
      )],
    };
  }

  if (parsed.file.sourceDigest !== localSourceDigest(document.source)) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'local.state.source',
        'This state file was created for a different document (source digest mismatch).',
      )],
    };
  }

  const bindingPlans = collectBindingPlans(document);
  const expected = new Set(bindingPlans.plans.map((plan) => plan.key));
  const diagnostics: Diagnostic[] = [];

  for (const key of Object.keys(parsed.file.parameters)) {
    if (!expected.has(key)) {
      pushDiagnostic(
        diagnostics,
        'local.state.parameter.unknown',
        `The state contains unknown parameter "${key}" for this document.`,
      );
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(parsed.file.parameters, key)) {
      pushDiagnostic(
        diagnostics,
        'local.state.parameter.missing',
        `The state is missing parameter "${key}".`,
      );
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };

  let temporary: LocalRuntime;
  try {
    temporary = createLocalRuntime(document);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.state.document', `Cannot validate this document: ${errorText(error)}`)],
    };
  }

  try {
    if (baseline) {
      // For applyLocalState, validate against the live runtime's current slot
      // values so a public slot is checked against its anonymous counterpart.
      const seed = writeValues(temporary, bindingPlans, baseline);
      if (seed.length) return { ok: false, diagnostics: seed };
    }

    const errors = writeValues(temporary, bindingPlans, parsed.file.parameters);
    if (errors.length) return { ok: false, diagnostics: errors };

    const expectedKeys = [...expected].sort();
    return {
      ok: true,
      file: parsed.file,
      state: publicStateSnapshot(temporary, expectedKeys),
    };
  } finally {
    temporary.dispose();
  }
}

/**
 * Verify a state file against a compiled document and normalize its values
 * through a throwaway runtime. No live runtime is created or mutated.
 */
export function resolveLocalState(
  document: LocalDocument,
  input: string | unknown,
): LocalStateResolution {
  try {
    return resolveInternal(document, input);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnostic('local.state.invalid', `Cannot resolve the local state: ${errorText(error)}`)],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

/**
 * Validate the file against the document (using the runtime's current state as
 * the baseline) and then write the normalized public values. Multi-slot
 * components are written atomically with `setMany`.
 */
export function applyLocalState(runtime: LocalRuntime, file: LocalStateFile): Diagnostic[] {
  let resolution: LocalStateResolution;
  try {
    resolution = resolveInternal(runtime.document, file, runtime.snapshot().state);
  } catch (error) {
    return [diagnostic('local.state.invalid', `Cannot apply the local state: ${errorText(error)}`)];
  }
  if (!resolution.ok) return resolution.diagnostics;

  const bindingPlans = collectBindingPlans(runtime.document);
  try {
    return writeValues(runtime, bindingPlans, resolution.state);
  } catch (error) {
    return [diagnostic('local.state.invalid', `Cannot apply the local state: ${errorText(error)}`)];
  }
}

/* ------------------------------------------------------------------ */
/* Serialization                                                       */
/* ------------------------------------------------------------------ */

/**
 * Produce stable JSON in a canonical key order. The CLI is responsible for
 * wrapping the result in an HTML/script context; no HTML escaping happens here.
 */
export function serializeLocalState(file: LocalStateFile): string {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new TypeError('serializeLocalState requires a state file.');
  }
  if (!file.parameters || typeof file.parameters !== 'object' || Array.isArray(file.parameters)) {
    throw new TypeError('serializeLocalState requires an object of parameters.');
  }

  const parameters: Record<string, LocalValue> = Object.create(null);
  for (const key of Object.keys(file.parameters).sort()) {
    if (key === '__proto__' || key.startsWith('@')) {
      throw new TypeError(`Cannot serialize parameter "${key}".`);
    }
    const result = normalizeStateValue(file.parameters[key]);
    if (!result.ok) {
      throw new TypeError(`Cannot serialize parameter "${key}": the value ${result.message}`);
    }
    parameters[key] = result.value;
  }

  const output: Record<string, unknown> = {
    format: file.format,
    syntax: file.syntax,
    sourceDigest: file.sourceDigest,
    parameters,
  };
  if (file.generator !== undefined) {
    const generator = normalizeGenerator(file.generator);
    output.generator = { name: generator.name, version: generator.version };
  }
  return JSON.stringify(output);
}
