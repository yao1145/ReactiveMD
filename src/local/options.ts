import {
  DEFAULT_MAX_LOCAL_MARKDOWN_DEPTH,
  DEFAULT_MAX_LOCAL_PARSE_WORK,
  DEFAULT_MAX_LOCAL_SYNTAX_NODES,
  MAX_LOCAL_HOST_COMPONENTS,
  MAX_LOCAL_HOST_ENUM_VALUES,
  MAX_LOCAL_HOST_NAME_LENGTH,
  MAX_LOCAL_HOST_PATTERN_LENGTH,
} from './limits';
import { LOCAL_COMPONENT_NAMES } from './schema';
import { LOCAL_HTML_NAMES } from './html-names';
import type {
  LocalCompileOptions,
  LocalHostComponentSchema,
  LocalHostPropKind,
  LocalHostPropSchema,
  LocalHtmlPolicy,
} from './types';

/** Capability flags that select the temporary whole-document HTML branch. */
export const LOCAL_HTML_FLAGS = ['enableCss', 'enableJavaScript', 'enableExtendedHtml'] as const;

export type LocalHtmlFlag = (typeof LOCAL_HTML_FLAGS)[number];

export type LocalOptionCheck =
  | {
      ok: true;
      /** Validated syntax-node budget for this compilation. */
      maxSyntaxNodes: number;
      /** Validated deterministic parser work budget, in abstract units. */
      maxParseWork: number;
      /** Validated nested Markdown container depth budget. */
      maxMarkdownDepth: number;
      /** Effective HTML policy; every flag is false by default. */
      html: LocalHtmlPolicy;
      /** True when at least one capability flag is enabled. */
      htmlActive: boolean;
      /** Render ordinary Markdown soft line breaks as `break` nodes. */
      markdownBreaks: boolean;
      /** Validated host component schemas; empty when the option is absent. */
      hostComponents: readonly LocalHostComponentSchema[];
      /** Host tag name lookup; names are already lowercase kebab-case. */
      hostByName: ReadonlyMap<string, LocalHostComponentSchema>;
    }
  | { ok: false; message: string; key: string; detail?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HOST_COMPONENTS_KEY = 'local.options.invalid.host-components';
const HOST_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HOST_PROP_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'enum']);

/** Limit keys accepted under `options.limits`; anything else is a typo. */
const LIMIT_KEYS: ReadonlySet<string> = new Set(['maxSyntaxNodes', 'maxParseWork', 'maxMarkdownDepth']);

type LimitRead =
  | { ok: true; value: number }
  | { ok: false; message: string; key: string };

/**
 * Read one positive-safe-integer limit. An explicit `undefined` means the
 * default, matching every other optional compile option.
 */
function readLimit(limits: Record<string, unknown>, name: string, fallback: number): LimitRead {
  if (!Object.hasOwn(limits, name)) return { ok: true, value: fallback };
  const value = limits[name];
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    const suffix = name === 'maxSyntaxNodes'
      ? 'max-syntax-nodes'
      : name === 'maxParseWork'
        ? 'max-parse-work'
        : 'max-markdown-depth';
    return {
      ok: false,
      message: `Compile option limits.${name} must be a positive safe integer.`,
      key: `local.options.invalid.${suffix}`,
    };
  }
  return { ok: true, value };
}

type HostComponentCheck =
  | {
      ok: true;
      hostComponents: readonly LocalHostComponentSchema[];
      hostByName: ReadonlyMap<string, LocalHostComponentSchema>;
    }
  | { ok: false; message: string; key: string; detail: string };

/**
 * Reject regex constructs that can backtrack super-linearly on document-
 * controlled input. The accepted subset has no backreferences, lookarounds or
 * named groups, and never applies a quantifier to a group that contains a
 * quantifier or alternation.
 */
function hostPatternQuantifier(source: string, index: number): { length: number } | null {
  const char = source[index];
  if (char === '*' || char === '+' || char === '?') {
    return { length: source[index + 1] === '?' ? 2 : 1 };
  }
  if (char !== '{') return null;
  const match = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(index));
  if (!match) return null;
  return { length: match[0].length + (source[index + match[0].length] === '?' ? 1 : 0) };
}

function isSafeHostPattern(source: string): boolean {
  const groups: { quantified: boolean; alternation: boolean }[] = [];
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      const next = source[index + 1];
      if (next !== undefined && next >= '1' && next <= '9') return false;
      if (next === 'k' && source[index + 2] === '<') return false;
      escaped = true;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      continue;
    }
    if (char === '[') {
      inClass = true;
      continue;
    }
    if (char === '(') {
      // Non-capturing groups stay in the subset; lookarounds, named groups
      // and atomic groups do not.
      if (source[index + 1] === '?') {
        if (source[index + 2] !== ':') return false;
        groups.push({ quantified: false, alternation: false });
        index += 2;
        continue;
      }
      groups.push({ quantified: false, alternation: false });
      continue;
    }
    if (char === '|') {
      const group = groups[groups.length - 1];
      if (group) group.alternation = true;
      continue;
    }
    if (char === ')') {
      const group = groups.pop();
      if (!group) return false;
      const quantifier = hostPatternQuantifier(source, index + 1);
      if (quantifier && (group.quantified || group.alternation)) return false;
      const parent = groups[groups.length - 1];
      if (parent) {
        parent.quantified = parent.quantified || group.quantified || quantifier !== null;
        parent.alternation = parent.alternation || group.alternation;
      }
      if (quantifier) index += quantifier.length;
      continue;
    }
    const quantifier = hostPatternQuantifier(source, index);
    if (quantifier) {
      const group = groups[groups.length - 1];
      if (group) group.quantified = true;
      index += quantifier.length - 1;
    }
  }
  return groups.length === 0 && !escaped && !inClass;
}

function invalidHost(detail: string): { ok: false; message: string; key: string; detail: string } {
  return {
    ok: false,
    message: `Compile option hostComponents is invalid: ${detail}`,
    key: HOST_COMPONENTS_KEY,
    detail,
  };
}

/**
 * Validate and normalize host component schemas. Each accepted component is
 * rebuilt from known fields so the result stays plain, cloneable data and the
 * caller's objects are never mutated.
 */
function readLocalHostComponents(value: unknown): HostComponentCheck {
  const hostComponents: LocalHostComponentSchema[] = [];
  const hostByName = new Map<string, LocalHostComponentSchema>();
  if (value === undefined) return { ok: true, hostComponents, hostByName };
  if (!Array.isArray(value)) return invalidHost('must be an array.');
  if (value.length > MAX_LOCAL_HOST_COMPONENTS) {
    return invalidHost(`accepts at most ${MAX_LOCAL_HOST_COMPONENTS} components.`);
  }
  // Host names share the tag namespace with built-in components, P0 HTML tags
  // and the theme declaration.
  const reserved = new Set(
    [...LOCAL_COMPONENT_NAMES, ...LOCAL_HTML_NAMES].map((name) => name.toLowerCase()),
  );
  reserved.add('theme');
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    const lead = `hostComponents[${index}]`;
    if (!isRecord(entry)) return invalidHost(`${lead} must be an object.`);
    const name = entry.name;
    if (typeof name !== 'string') return invalidHost(`${lead} "name" must be a string.`);
    if (name.length > MAX_LOCAL_HOST_NAME_LENGTH) {
      return invalidHost(`${lead} "name" exceeds the ${MAX_LOCAL_HOST_NAME_LENGTH}-character limit.`);
    }
    if (!HOST_NAME.test(name)) return invalidHost(`${lead} "name" ${name} must use lowercase kebab-case.`);
    if (reserved.has(name.toLowerCase())) {
      return invalidHost(`${lead} "name" ${name} conflicts with a built-in component, HTML tag or theme.`);
    }
    if (hostByName.has(name.toLowerCase())) {
      return invalidHost(`${lead} "name" ${name} is declared more than once.`);
    }
    if (entry.form !== 'leaf') return invalidHost(`${lead} "form" must be "leaf".`);
    const rawProps = entry.props;
    if (!isRecord(rawProps)) return invalidHost(`${lead} "props" must be an object.`);
    const props: Record<string, LocalHostPropSchema> = {};
    for (const propName of Object.keys(rawProps)) {
      if (!HOST_NAME.test(propName)) {
        return invalidHost(`${lead} property "${propName}" must use lowercase kebab-case.`);
      }
      const raw: unknown = rawProps[propName];
      if (!isRecord(raw)) return invalidHost(`${lead} property "${propName}" must be an object.`);
      const kind = raw.kind;
      if (typeof kind !== 'string' || !HOST_PROP_KINDS.has(kind)) {
        const shown = typeof kind === 'string' ? `"${kind}"` : String(kind);
        return invalidHost(`property "${propName}" has unsupported kind ${shown}.`);
      }
      const prop: {
        kind: LocalHostPropKind;
        required?: boolean;
        static?: boolean;
        enum?: readonly string[];
        pattern?: string;
      } = { kind: kind as LocalHostPropKind };
      for (const flag of ['required', 'static'] as const) {
        // An explicit `undefined` is the same as omitting the optional field.
        if (!Object.hasOwn(raw, flag) || raw[flag] === undefined) continue;
        if (typeof raw[flag] !== 'boolean') {
          return invalidHost(`${lead} property "${propName}" "${flag}" must be a boolean.`);
        }
        prop[flag] = raw[flag];
      }
      const hasEnum = Object.hasOwn(raw, 'enum') && raw.enum !== undefined;
      if (kind !== 'enum') {
        if (hasEnum) {
          return invalidHost(`${lead} property "${propName}" has "enum" but kind is "${kind}".`);
        }
      } else {
        const values = raw.enum;
        if (!Array.isArray(values) || values.length === 0) {
          return invalidHost(`${lead} property "${propName}" "enum" must be a non-empty string array.`);
        }
        if (values.length > MAX_LOCAL_HOST_ENUM_VALUES) {
          return invalidHost(
            `${lead} property "${propName}" "enum" accepts at most ${MAX_LOCAL_HOST_ENUM_VALUES} values.`,
          );
        }
        const seen = new Set<string>();
        for (const item of values) {
          if (typeof item !== 'string') {
            return invalidHost(`${lead} property "${propName}" "enum" must be a non-empty string array.`);
          }
          if (item.length > MAX_LOCAL_HOST_NAME_LENGTH) {
            return invalidHost(
              `${lead} property "${propName}" enum value exceeds the ${MAX_LOCAL_HOST_NAME_LENGTH}-character limit.`,
            );
          }
          if (seen.has(item)) {
            return invalidHost(`${lead} property "${propName}" enum value "${item}" is declared more than once.`);
          }
          seen.add(item);
        }
        prop.enum = [...values] as string[];
      }
      const hasPattern = Object.hasOwn(raw, 'pattern') && raw.pattern !== undefined;
      if (kind !== 'string') {
        if (hasPattern) {
          return invalidHost(`${lead} property "${propName}" has "pattern" but kind is "${kind}".`);
        }
      } else if (hasPattern) {
        const pattern = raw.pattern;
        if (typeof pattern !== 'string') {
          return invalidHost(`${lead} property "${propName}" "pattern" must be a string.`);
        }
        if (pattern.length > MAX_LOCAL_HOST_PATTERN_LENGTH) {
          return invalidHost(
            `${lead} property "${propName}" "pattern" exceeds the ${MAX_LOCAL_HOST_PATTERN_LENGTH}-character limit.`,
          );
        }
        try {
          new RegExp(pattern);
        } catch {
          return invalidHost(`${lead} property "${propName}" "pattern" is not a valid regular expression.`);
        }
        if (!isSafeHostPattern(pattern)) {
          return invalidHost(
            `${lead} property "${propName}" "pattern" uses unsupported regex syntax; nested quantifiers, quantified alternation, backreferences and lookarounds are rejected.`,
          );
        }
        prop.pattern = pattern;
      }
      props[propName] = prop;
    }
    const component: LocalHostComponentSchema = { name, form: 'leaf', props };
    hostComponents.push(component);
    hostByName.set(name, component);
  }
  return { ok: true, hostComponents, hostByName };
}

/**
 * Read and validate host compile options once. Every call site (Markdown
 * parser, HTML compiler, worker and React component) uses the same rules so a
 * malformed flag can never silently fall back to the Markdown pipeline.
 */
export function readLocalCompileOptions(options: LocalCompileOptions | undefined): LocalOptionCheck {
  if (options === undefined) {
    return {
      ok: true,
      maxSyntaxNodes: DEFAULT_MAX_LOCAL_SYNTAX_NODES,
      maxParseWork: DEFAULT_MAX_LOCAL_PARSE_WORK,
      maxMarkdownDepth: DEFAULT_MAX_LOCAL_MARKDOWN_DEPTH,
      html: { enableCss: false, enableJavaScript: false, enableExtendedHtml: false },
      htmlActive: false,
      markdownBreaks: false,
      hostComponents: [],
      hostByName: new Map(),
    };
  }
  if (!isRecord(options)) {
    return { ok: false, message: 'Compile options must be an object.', key: 'local.options.invalid.object' };
  }

  const html: { enableCss: boolean; enableJavaScript: boolean; enableExtendedHtml: boolean } = {
    enableCss: false,
    enableJavaScript: false,
    enableExtendedHtml: false,
  };
  for (const flag of LOCAL_HTML_FLAGS) {
    if (!Object.hasOwn(options, flag)) continue;
    const value = options[flag];
    // An explicit `undefined` is the same as omitting the optional flag.
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      return {
        ok: false,
        message: `Compile option ${flag} must be a boolean.`,
        key: 'local.options.invalid.html-flag',
      };
    }
    html[flag] = value;
  }

  let markdownBreaks = false;
  if (Object.hasOwn(options, 'markdownBreaks')) {
    const value = options.markdownBreaks;
    // An explicit `undefined` is the same as omitting the optional flag.
    if (value !== undefined) {
      if (typeof value !== 'boolean') {
        return {
          ok: false,
          message: 'Compile option markdownBreaks must be a boolean.',
          key: 'local.options.invalid.markdown-breaks',
        };
      }
      markdownBreaks = value;
    }
  }

  const limits = options.limits;
  let maxSyntaxNodes = DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  let maxParseWork = DEFAULT_MAX_LOCAL_PARSE_WORK;
  let maxMarkdownDepth = DEFAULT_MAX_LOCAL_MARKDOWN_DEPTH;
  if (limits !== undefined) {
    if (!isRecord(limits)) {
      return { ok: false, message: 'Compile option limits must be an object.', key: 'local.options.invalid.limits' };
    }
    // Unknown limit keys are rejected instead of silently ignored: a typo must
    // never look like a raised budget.
    for (const key of Object.keys(limits)) {
      if (LIMIT_KEYS.has(key)) continue;
      if ((limits as Record<string, unknown>)[key] === undefined) continue;
      return {
        ok: false,
        message: `Compile option limits.${key} is not supported.`,
        key: 'local.options.invalid.limits-unknown',
        detail: key,
      };
    }
    const syntaxNodes = readLimit(limits, 'maxSyntaxNodes', maxSyntaxNodes);
    if (!syntaxNodes.ok) return syntaxNodes;
    maxSyntaxNodes = syntaxNodes.value;
    const parseWork = readLimit(limits, 'maxParseWork', maxParseWork);
    if (!parseWork.ok) return parseWork;
    maxParseWork = parseWork.value;
    const markdownDepth = readLimit(limits, 'maxMarkdownDepth', maxMarkdownDepth);
    if (!markdownDepth.ok) return markdownDepth;
    maxMarkdownDepth = markdownDepth.value;
  }

  const hosts = readLocalHostComponents(options.hostComponents);
  if (!hosts.ok) return hosts;

  return {
    ok: true,
    maxSyntaxNodes,
    maxParseWork,
    maxMarkdownDepth,
    html,
    htmlActive: html.enableCss || html.enableJavaScript || html.enableExtendedHtml,
    markdownBreaks,
    hostComponents: hosts.hostComponents,
    hostByName: hosts.hostByName,
  };
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
  if (options === undefined) return 'default';
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
  return `${flags}:${limitsKey}:${breaks}${hostSignature}`;
}
