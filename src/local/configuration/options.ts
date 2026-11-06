import { MAX_LOCAL_HOST_COMPONENTS } from './limits';
import { LOCAL_HTML_FLAGS, LOCAL_RECOVERY_STRATEGY_VERSION, readOptionCheck } from './options-core';
import type { LocalOptionCheck } from './options-core';
import type { LocalCompileOptions } from '../contracts/types';
import { localComponentConfigKey, localConfigKey, readLocalConfig } from '../../sdk/config';
import { getLocalComponentRegistry } from '../../sdk/registry';
import defaultPreset from '../../presets/default';
import { STANDARD_PARSER_CAPABILITIES } from '../parsing/parser-standard';

export { LOCAL_HTML_FLAGS, LOCAL_RECOVERY_STRATEGY_VERSION };
export type { LocalHtmlFlag, LocalOptionCheck } from './options-core';

/**
 * Compatibility entry: validates the full instance configuration, including
 * themes, and always honors the default preset. The rules themselves live in
 * `options-core.ts`; this module only supplies the standard assembly.
 */
export function readLocalCompileOptions(options: LocalCompileOptions | undefined): LocalOptionCheck {
  return readOptionCheck(options, {
    defaults: getLocalComponentRegistry(),
    preset: { id: defaultPreset.id, version: defaultPreset.version },
    defaultConfigKey: localComponentConfigKey(),
    readConfig: (value) => readLocalConfig(value),
    configKey: (config) => localComponentConfigKey(config),
    capabilities: STANDARD_PARSER_CAPABILITIES,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Signature work bounds: host schemas are small, extra metadata may not be. */
const MAX_SIGNATURE_ITEMS = 256;
const MAX_SIGNATURE_NODES = 4096;
const functionIdentities = new WeakMap<object, number>();
const symbolIdentities = new Map<symbol, number>();
const unreadableIdentities = new WeakMap<object, number>();
let optionIdentitySerial = 0;

function nextIdentity(): number {
  optionIdentitySerial += 1;
  return optionIdentitySerial;
}

/** Last-resort identity for values whose properties cannot be enumerated. */
function unreadableIdentity(value: unknown): string {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    const object = value as object;
    let id = unreadableIdentities.get(object);
    if (id === undefined) {
      id = nextIdentity();
      unreadableIdentities.set(object, id);
    }
    return `unreadable#${id}`;
  }
  return `unreadable:${typeof value}:${String(value)}`;
}

/**
 * Structural signature that cannot collide merely because a schema carries a
 * BigInt or a cycle. Unbounded arrays and objects are sampled instead of fully
 * enumerated. If enumeration itself fails, object identity keeps distinct
 * configurations distinct.
 */
function hostComponentsSignature(value: unknown): string {
  const stack: object[] = [];
  let nodes = 0;
  const encode = (input: unknown): string => {
    nodes += 1;
    if (nodes > MAX_SIGNATURE_NODES) throw new RangeError('signature budget');
    switch (typeof input) {
      case 'string': return `s${JSON.stringify(input)}`;
      case 'number': return `n${Object.is(input, -0) ? '-0' : String(input)}`;
      case 'boolean': return input ? 'b1' : 'b0';
      case 'undefined': return 'u';
      case 'bigint': return `g${input.toString()}`;
      case 'symbol': {
        let id = symbolIdentities.get(input);
        if (id === undefined) {
          id = nextIdentity();
          symbolIdentities.set(input, id);
        }
        return `y${id}`;
      }
      case 'function': {
        let id = functionIdentities.get(input);
        if (id === undefined) {
          id = nextIdentity();
          functionIdentities.set(input, id);
        }
        return `f${id}`;
      }
      default: break;
    }
    if (input === null) return 'null';
    const object = input as object;
    const reference = stack.indexOf(object);
    if (reference >= 0) return `r${reference}`;
    stack.push(object);
    try {
      if (Array.isArray(object)) {
        const sample = Math.min(object.length, 8);
        if (object.length > MAX_SIGNATURE_ITEMS) {
          let out = `a#${object.length}[`;
          for (let index = 0; index < sample; index += 1) out += `${encode(object[index])},`;
          return `${out}]`;
        }
        let out = `a${object.length}[`;
        for (let index = 0; index < object.length; index += 1) out += `${encode(object[index])},`;
        return `${out}]`;
      }
      const keys = Object.keys(object);
      if (keys.length > MAX_SIGNATURE_ITEMS) {
        let out = `o#${keys.length}{`;
        for (const key of keys.slice(0, 8)) out += `${encode(key)},`;
        return `${out}}`;
      }
      keys.sort();
      let out = `o{`;
      for (const key of keys) out += `${encode(key)}:${encode((object as Record<string, unknown>)[key])},`;
      return `${out}}`;
    } finally {
      stack.pop();
    }
  };
  try {
    return encode(value);
  } catch {
    return unreadableIdentity(value);
  }
}

/**
 * Stable signature of the option values that affect compilation. Used to
 * recompile on flag/limit changes and to keep worker races keyed by more than
 * the source text. Unknown keys are deliberately ignored.
 */
export function localCompileOptionsKey(options?: LocalCompileOptions): string {
  if (options === undefined) options = {};
  if (!isRecord(options)) return 'invalid';
  const flags = LOCAL_HTML_FLAGS.map((flag) => {
    if (!Object.hasOwn(options, flag)) return '-';
    const value = options[flag];
    if (value === undefined) return '-';
    if (value === true) return '1';
    if (value === false) return '0';
    return '!';
  }).join('');
  let limitsKey = '';
  if (Object.hasOwn(options, 'limits')) {
    const limits = options.limits;
    if (limits === undefined) limitsKey = 'default';
    else if (!isRecord(limits)) limitsKey = 'invalid';
    else {
      const part = (name: string): string =>
        !Object.hasOwn(limits, name) || limits[name] === undefined ? 'default' : String(limits[name]);
      limitsKey = `${part('maxSyntaxNodes')}:${part('maxParseWork')}:${part('maxMarkdownDepth')}`;
    }
  }
  let hostSignature = '';
  if (Object.hasOwn(options, 'hostComponents') && options.hostComponents !== undefined) {
    const hostComponents = options.hostComponents;
    try {
      if (Array.isArray(hostComponents)) {
        // An empty array compiles exactly like an omitted option. Oversized
        // arrays are rejected before compilation; never enumerate them here.
        if (hostComponents.length > 0) {
          hostSignature = hostComponents.length > MAX_LOCAL_HOST_COMPONENTS
            ? `:hosts=oversize:${hostComponents.length}`
            : `:hosts=${hostComponentsSignature(hostComponents)}`;
        }
      } else {
        hostSignature = `:hosts=${hostComponentsSignature(hostComponents)}`;
      }
    } catch {
      hostSignature = `:hosts=${unreadableIdentity(hostComponents)}`;
    }
  }
  const breaks = !Object.hasOwn(options, 'markdownBreaks') || options.markdownBreaks === undefined
    ? '-'
    : options.markdownBreaks === true
      ? '1'
      : options.markdownBreaks === false
        ? '0'
        : '!';
  // Omitted, explicit `undefined` and `true` are the same strict identity.
  // Loose mode additionally carries the recovery strategy version, so a
  // strategy change cannot reuse results produced by different ranges.
  const strict = !Object.hasOwn(options, 'strict') || options.strict === undefined
    ? 'strict=1'
    : options.strict === true
      ? 'strict=1'
      : options.strict === false
        ? `strict=0:recovery=${LOCAL_RECOVERY_STRATEGY_VERSION}`
        : 'strict=!';
  let configKey = '';
  if (Object.hasOwn(options, 'config') && options.config !== undefined) {
    // Recompute from contents; a supplied key or digest is never trusted.
    configKey = `:config=${localConfigKey(options.config)}`;
  }
  return `${flags}:${limitsKey}:${breaks}:${strict}${hostSignature}${configKey}`;
}
