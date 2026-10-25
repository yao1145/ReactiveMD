import {
  DEFAULT_MAX_LOCAL_SYNTAX_NODES,
  MAX_LOCAL_HOST_COMPONENTS,
  MAX_LOCAL_HOST_ENUM_VALUES,
  MAX_LOCAL_HOST_NAME_LENGTH,
  MAX_LOCAL_HOST_PATTERN_LENGTH,
} from './limits';
import { LOCAL_COMPONENT_NAMES } from './schema';
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
      /** Effective HTML policy; every flag is false by default. */
      html: LocalHtmlPolicy;
      /** True when at least one capability flag is enabled. */
      htmlActive: boolean;
      /** Validated host component schemas; empty when the option is absent. */
      hostComponents: readonly LocalHostComponentSchema[];
      /** Host tag name lookup; names are already lowercase kebab-case. */
      hostByName: ReadonlyMap<string, LocalHostComponentSchema>;
    }
  | { ok: false; message: string; key: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HOST_COMPONENTS_KEY = 'local.options.invalid.host-components';
const HOST_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HOST_PROP_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'enum']);

type HostComponentCheck =
  | {
      ok: true;
      hostComponents: readonly LocalHostComponentSchema[];
      hostByName: ReadonlyMap<string, LocalHostComponentSchema>;
    }
  | { ok: false; message: string; key: string };

function invalidHost(message: string): { ok: false; message: string; key: string } {
  return { ok: false, message, key: HOST_COMPONENTS_KEY };
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
  if (!Array.isArray(value)) return invalidHost('Compile option hostComponents must be an array.');
  if (value.length > MAX_LOCAL_HOST_COMPONENTS) {
    return invalidHost(`Compile option hostComponents accepts at most ${MAX_LOCAL_HOST_COMPONENTS} components.`);
  }
  // Host names share the tag namespace with built-in components and theme.
  const reserved = new Set(LOCAL_COMPONENT_NAMES.map((name) => name.toLowerCase()));
  reserved.add('theme');
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    const lead = `Compile option hostComponents[${index}]`;
    if (!isRecord(entry)) return invalidHost(`${lead} must be an object.`);
    const name = entry.name;
    if (typeof name !== 'string') return invalidHost(`${lead} "name" must be a string.`);
    if (name.length > MAX_LOCAL_HOST_NAME_LENGTH) {
      return invalidHost(`${lead} "name" exceeds the ${MAX_LOCAL_HOST_NAME_LENGTH}-character limit.`);
    }
    if (!HOST_NAME.test(name)) return invalidHost(`${lead} "name" ${name} must use lowercase kebab-case.`);
    if (reserved.has(name.toLowerCase())) {
      return invalidHost(`${lead} "name" ${name} conflicts with a built-in component or theme.`);
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
        return invalidHost(
          `Compile option hostComponents contains an invalid component: property "${propName}" has unsupported kind ${shown}.`,
        );
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
      html: { enableCss: false, enableJavaScript: false, enableExtendedHtml: false },
      htmlActive: false,
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

  const limits = options.limits;
  let maxSyntaxNodes = DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (limits !== undefined) {
    if (!isRecord(limits)) {
      return { ok: false, message: 'Compile option limits must be an object.', key: 'local.options.invalid.limits' };
    }
    const value = limits.maxSyntaxNodes;
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        return {
          ok: false,
          message: 'Compile option limits.maxSyntaxNodes must be a positive safe integer.',
          key: 'local.options.invalid.max-syntax-nodes',
        };
      }
      maxSyntaxNodes = value;
    }
  }

  const hosts = readLocalHostComponents(options.hostComponents);
  if (!hosts.ok) return hosts;

  return {
    ok: true,
    maxSyntaxNodes,
    html,
    htmlActive: html.enableCss || html.enableJavaScript || html.enableExtendedHtml,
    hostComponents: hosts.hostComponents,
    hostByName: hosts.hostByName,
  };
}

/**
 * Stable, order-independent shape used only for the host signature. Property
 * keys are sorted so reordering the same props does not force a recompile.
 */
function hostSignatureValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const props = value.props;
  return [
    value.name,
    value.form,
    isRecord(props) ? Object.keys(props).sort().map((name) => [name, props[name]]) : props,
  ];
}

/**
 * Stable signature of the option values that affect compilation. Used to
 * recompile on flag/limit changes and to keep worker races keyed by more than
 * the source text. Unknown keys are deliberately ignored.
 */
export function localCompileOptionsKey(options: LocalCompileOptions | undefined): string {
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
  let maxSyntaxNodes = '';
  if (Object.hasOwn(options, 'limits')) {
    const limits = options.limits;
    if (limits === undefined) maxSyntaxNodes = 'default';
    else if (!isRecord(limits)) maxSyntaxNodes = 'invalid';
    else if (!Object.hasOwn(limits, 'maxSyntaxNodes') || limits.maxSyntaxNodes === undefined) maxSyntaxNodes = 'default';
    else maxSyntaxNodes = String(limits.maxSyntaxNodes);
  }
  let hostSignature = '';
  if (Object.hasOwn(options, 'hostComponents') && options.hostComponents !== undefined) {
    try {
      const hostComponents = options.hostComponents;
      // A non-array value can never compile; keep one stable marker for it.
      hostSignature = Array.isArray(hostComponents)
        ? `:hosts=${JSON.stringify(hostComponents.map(hostSignatureValue))}`
        : ':hosts=invalid';
    } catch {
      hostSignature = ':hosts=invalid';
    }
  }
  return `${flags}:${maxSyntaxNodes}${hostSignature}`;
}
