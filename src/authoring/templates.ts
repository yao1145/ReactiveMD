import { compileLocal } from '../local/compiler';
import { RESERVED_NAMES } from '../local/expression';
import { insertTemplate } from '../editor/editor-commands';
import { renderNativeSnippet, type NativeComponentDefinition } from '../editor/native-components';
import type { LocalComponentDefinition } from '../sdk/types';
import type { LocalCompileOptions } from '../local/types';
import type { LocalPropKind } from '../local/schema';

/**
 * Minimal legal insertion-template synthesis for manifests that do not supply
 * `authoring.insertText`.
 *
 * A synthesized template is only offered when it compiles under the *same*
 * configuration the editor uses. Otherwise the component must provide a
 * template; the error names the component and includes the compiler
 * diagnostics instead of inserting a document that fails immediately.
 */

export interface TemplateProp {
  readonly kind: LocalPropKind;
  readonly required: boolean;
  readonly values?: readonly string[];
  readonly defaultValue?: string | number | boolean | null;
  readonly pattern?: string;
  readonly min?: number;
  readonly max?: number;
  readonly integer: boolean;
  readonly color: boolean;
}

export function templateProps(definition: LocalComponentDefinition): Record<string, TemplateProp> {
  const props: Record<string, TemplateProp> = {};
  for (const [name, prop] of Object.entries(definition.props)) {
    props[name] = {
      kind: prop.kind,
      required: prop.required === true,
      ...(prop.enum ? { values: prop.enum } : {}),
      ...(prop.default !== undefined ? { defaultValue: prop.default } : {}),
      ...(prop.pattern !== undefined ? { pattern: prop.pattern } : {}),
      ...(prop.min !== undefined ? { min: prop.min } : {}),
      ...(prop.max !== undefined ? { max: prop.max } : {}),
      integer: prop.integer === true,
      color: prop.color === true,
    };
  }
  return props;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAttribute(value: string | number | boolean | null): string {
  return value === null ? '' : escapeAttribute(String(value));
}

function bindingName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  const base = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  return RESERVED_NAMES.has(base) ? `${base}_value` : base;
}

function requiredSample(prop: TemplateProp, lead: string): string {
  if (prop.defaultValue !== undefined && prop.defaultValue !== null) {
    return formatAttribute(prop.defaultValue);
  }
  switch (prop.kind) {
    case 'boolean':
      return 'false';
    case 'enum':
      if (prop.values?.length) return formatAttribute(prop.values[0]);
      throw new Error(`${lead} is a required enum without values; provide an authoring.insertText.`);
    case 'number': {
      const low = prop.min === undefined ? undefined : (prop.integer ? Math.ceil(prop.min) : prop.min);
      const high = prop.max === undefined ? undefined : (prop.integer ? Math.floor(prop.max) : prop.max);
      if (low !== undefined && high !== undefined && low > high) {
        throw new Error(`${lead} has no integer inside its declared range; provide an authoring.insertText.`);
      }
      let value = low !== undefined && low > 0 ? low : high !== undefined && high < 0 ? high : 0;
      if (low !== undefined && value < low) value = low;
      if (high !== undefined && value > high) value = high;
      if (!Number.isFinite(value)) {
        throw new Error(`${lead} is a required number without a legal finite value; provide an authoring.insertText.`);
      }
      return String(value);
    }
    case 'string':
      if (prop.color) return '#000000';
      if (prop.pattern) {
        throw new Error(`${lead} is a required pattern-constrained string; provide an authoring.insertText.`);
      }
      return '';
    default:
      throw new Error(`${lead} has an unsupported property kind; provide an authoring.insertText.`);
  }
}

function manifestRequiresChildren(definition: LocalComponentDefinition): boolean {
  if (definition.structure && definition.structure.rule !== 'none'
    && definition.structure.rule !== 'any' && definition.structure.rule !== 'inline') return true;
  const children: unknown = (definition as unknown as { children?: unknown }).children;
  if (Array.isArray(children)) {
    return children.some((entry) => typeof entry === 'object' && entry !== null
      && ((entry as { required?: unknown }).required === true
        || (typeof (entry as { min?: unknown }).min === 'number' && (entry as { min: number }).min > 0)));
  }
  if (typeof children === 'object' && children !== null) {
    return (children as { required?: unknown }).required === true
      || (typeof (children as { min?: unknown }).min === 'number' && (children as { min: number }).min > 0);
  }
  return false;
}

/**
 * Build a document-independent, directly compilable template. Binding names
 * are literals so repeated insertion can retarget them without parsing tokens.
 */
export function synthesizeInsertText(
  definition: LocalComponentDefinition,
  props: Readonly<Record<string, TemplateProp>>,
): string {
  const name = definition.name;
  const form = definition.form;
  if (form !== 'leaf' && form !== 'inline' && form !== 'container') {
    throw new Error(`component "${name}" has an unsupported form; provide an authoring.insertText.`);
  }
  if (manifestRequiresChildren(definition)) {
    throw new Error(`component "${name}" requires children; provide an authoring.insertText.`);
  }
  const bindings = Object.entries(definition.bindings ?? {});
  const bindingAttributes = new Set(bindings.flatMap(([, binding]) => [binding.bind, binding.initial]));
  const attributes: string[] = [];
  for (const [slot, binding] of bindings) {
    attributes.push(`${binding.bind}="${bindingName(slot === 'value' ? name : `${name}_${slot}`)}"`);
  }
  for (const [propName, prop] of Object.entries(props)) {
    if (!prop.required) continue;
    if (bindingAttributes.has(propName)) continue;
    attributes.push(`${propName}="${requiredSample(prop, `component "${name}" property "${propName}"`)}"`);
  }
  const head = `<${name}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}`;
  if (form === 'leaf') return `${head}>`;
  if (form === 'inline') return `${head}></${name}>`;
  return `${head}>\n\n</${name}>`;
}

const TEMPLATE_SNIPPET_DEFINITION: NativeComponentDefinition = {
  id: 'authoring-template',
  label: '',
  description: '',
  group: 'input',
  keywords: [],
  template: '',
};

/**
 * Resolve toolbar-owned snippet tokens exactly as insertion does for an empty
 * document and a collapsed caret: `{{bind:base}}` becomes a fresh literal
 * binding, `{{selection}}` becomes empty, `{{selection:fallback}}` becomes the
 * fallback text, `{{caret}}` is dropped and `{{select:value}}` keeps its value.
 *
 * `source` mirrors the document the snippet will be inserted into so validation
 * can avoid reusing a binding name already present in a parent wrapper.
 */
export function expandInsertTemplate(template: string, source = ''): string {
  const withBindings = renderNativeSnippet(
    { ...TEMPLATE_SNIPPET_DEFINITION, template },
    source,
  );
  return insertTemplate(source, { start: source.length, end: source.length }, withBindings).value
    .slice(source.length);
}

function compileDetail(result: ReturnType<typeof compileLocal>): string {
  return result.diagnostics
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
    .join('; ');
}

/**
 * Place a child insertion inside an expanded container template just before its
 * closing tag. Returns `undefined` when the template has no such closing tag.
 */
export function parentInsertionWrapper(
  parentName: string,
  parentTemplate: string,
): { before: string; after: string } | undefined {
  const expanded = expandInsertTemplate(parentTemplate);
  const close = `</${parentName}>`;
  const index = expanded.lastIndexOf(close);
  if (index < 0) return undefined;
  return {
    before: `${expanded.slice(0, index)}\n`,
    after: `\n${expanded.slice(index)}`,
  };
}

/**
 * Compile a supplied `authoring.insertText` after resolving snippet tokens.
 * `before`/`after` place the snippet in a legal structural parent context for
 * components that may only appear inside a container.
 */
export function assertSuppliedTemplateCompiles(
  template: string,
  options: LocalCompileOptions | undefined,
  label: string,
  context?: { readonly before: string; readonly after: string },
): void {
  const expanded = context === undefined
    ? expandInsertTemplate(template)
    : expandInsertTemplate(template, context.before);
  const source = context === undefined ? expanded : `${context.before}${expanded}${context.after}`;
  let result: ReturnType<typeof compileLocal>;
  try {
    result = compileLocal(source, options ?? {});
  } catch (error) {
    throw new Error(
      `${label} authoring.insertText could not be compiled: `
      + `${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (result.ok) return;
  const detail = compileDetail(result);
  throw new Error(
    `${label} authoring.insertText does not compile with this configuration`
    + `${detail ? ` (${detail})` : ''}.`,
  );
}

/**
 * Compile a synthesized template with the editor configuration. The error is
 * deliberately concrete: it names the component and includes diagnostic codes
 * and messages.
 */
export function assertTemplateCompiles(
  template: string,
  options: LocalCompileOptions | undefined,
  label: string,
  context?: { readonly before: string; readonly after: string },
): void {
  const source = context === undefined ? template : `${context.before}${template}${context.after}`;
  let result: ReturnType<typeof compileLocal>;
  try {
    result = compileLocal(source, options ?? {});
  } catch (error) {
    throw new Error(
      `${label} has no authoring.insertText and its synthesized template could not be compiled: `
      + `${error instanceof Error ? error.message : String(error)}. Provide authoring.insertText.`,
    );
  }
  if (result.ok) return;
  const detail = result.diagnostics
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
    .join('; ');
  throw new Error(
    `${label} has no authoring.insertText and its synthesized template does not compile with this configuration`
    + `${detail ? ` (${detail})` : ''}. Provide authoring.insertText.`,
  );
}
