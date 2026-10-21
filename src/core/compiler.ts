import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import { parseDocument, isMap, isSeq, isScalar, isAlias } from 'yaml';

import type {
  ActionStep,
  BindingConstraint,
  CompileResult,
  CompiledDocument,
  Diagnostic,
  DocumentNode,
  Json,
  SourceRange,
  StateValue,
  ValueSource,
} from './types';
import {
  ExpressionError,
  RESERVED_NAMES,
  checkExpectedType,
  collectDependencies,
  inferType,
  jsonToExprType,
  parseExpression,
  type ExpectedType,
  type ExprType,
  type TypeEnv,
} from './expression';
import {
  getComponentNames,
  getComponentSchema,
  snapshotComponentSchemas,
  type ComponentSchema,
  type PropSchema,
} from './schema';
import { checkBindingValue, validateDocumentState } from './runtime';
import { indexNodes, makeDiagnostic, positionAt, setDocumentMeta, type DocumentMeta } from './metadata';

const VERSIONS = new Set(['0.1', '0.2']);
const MAX_SOURCE_LENGTH = 1_000_000;
const MAX_COMPONENTS = 500;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const CALL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

class DiagnosticSink {
  readonly list: Diagnostic[] = [];

  constructor(readonly source: string) {}

  add(code: string, message: string, range: SourceRange, severity: 'error' | 'warning' = 'error'): void {
    this.list.push(makeDiagnostic(this.source, code, message, range, severity));
  }

  expression(error: unknown, range: SourceRange, context: string): void {
    const exprError = error as ExpressionError;
    const offset = typeof exprError.offset === 'number' ? exprError.offset : 0;
    const start = Math.max(range.start, Math.min(range.start + Math.max(0, offset), range.end));
    const end = Math.max(start, Math.min(range.end, start + 1));
    this.add(
      exprError.code ?? 'expression-error',
      `${context}: ${exprError.message}`,
      { start, end },
    );
  }

  get hasErrors(): boolean {
    return this.list.some((diagnostic) => diagnostic.severity === 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function suggestion(name: string, candidates: readonly string[]): string {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshtein(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best && bestDistance <= 2) return ` Did you mean "${best}"?`;
  return '';
}

function mdastRange(node: any): SourceRange {
  const position = node?.position;
  const start = position?.start?.offset;
  const end = position?.end?.offset;
  if (typeof start !== 'number') return { start: 0, end: 0 };
  return { start, end: typeof end === 'number' ? end : start };
}

function safeSet<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/* ------------------------------------------------------------------ */
/* Markdown parsing                                                    */
/* ------------------------------------------------------------------ */

interface ConfigBlock {
  node: any;
  rootLevel: boolean;
}

function findConfigBlocks(node: any, rootLevel: boolean, out: ConfigBlock[]): void {
  if (node.type === 'code' && node.lang === 'reactive-md') {
    out.push({ node, rootLevel });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      findConfigBlocks(child, false, out);
    }
  }
}

function isFenceClosed(source: string, node: any): boolean {
  const range = mdastRange(node);
  const raw = source.slice(range.start, range.end);
  const lines = raw.split('\n');
  if (lines.length < 2) return false;
  const first = lines[0];
  const match = /^\s*(`{3,}|~{3,})/.exec(first);
  if (!match) return false;
  const fence = match[1];
  const char = fence[0];
  const minimum = fence.length;
  const closing = new RegExp(`^\\s*${escapeRegExp(char)}{${minimum},}\\s*$`);
  for (let i = 1; i < lines.length; i += 1) {
    if (closing.test(lines[i].trimEnd())) return true;
  }
  return false;
}

function containerClosed(source: string, node: any): boolean {
  if (node.type !== 'containerDirective') return true;
  const range = mdastRange(node);
  const raw = source.slice(range.start, range.end);
  const lines = raw.split('\n');
  const match = /^\s*(:{3,})/.exec(lines[0] ?? '');
  if (!match) return true;
  const count = match[1].length;
  const closing = new RegExp(`^\\s*:{${count}}\\s*$`);
  for (let i = 1; i < lines.length; i += 1) {
    if (closing.test(lines[i])) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* YAML helpers                                                        */
/* ------------------------------------------------------------------ */

interface ConfigContent {
  version: string;
  data: Record<string, Json>;
  state: Record<string, StateValue>;
  computed: Record<string, string>;
  actions: Record<string, ActionStep[]>;
  computedRanges: Map<string, SourceRange>;
  actionRanges: Map<string, SourceRange>;
}

function yamlRange(node: any, contentOffset: number): SourceRange {
  const range = node?.range;
  if (!Array.isArray(range) || typeof range[0] !== 'number') {
    return { start: contentOffset, end: contentOffset };
  }
  const start = contentOffset + range[0];
  const end = contentOffset + (typeof range[1] === 'number' ? range[1] : range[0]);
  return { start, end: Math.max(start, end) };
}

function scalarExpressionRange(node: any, contentOffset: number, expression: string, source: string): SourceRange {
  const range = node?.range;
  if (!Array.isArray(range) || typeof range[0] !== 'number') {
    return { start: contentOffset, end: contentOffset + expression.length };
  }
  const nodeStart = contentOffset + range[0];
  const char = source[nodeStart];
  const valueStart = char === '"' || char === "'" ? nodeStart + 1 : nodeStart;
  const start = valueStart + 1;
  return { start, end: start + expression.length };
}

function yamlKeyEntries(map: any): { key: string; keyNode: any; valueNode: any }[] {
  const entries: { key: string; keyNode: any; valueNode: any }[] = [];
  if (!isMap(map) || !Array.isArray(map.items)) return entries;
  for (const pair of map.items) {
    const keyNode = pair.key;
    let key: string;
    if (isScalar(keyNode)) {
      key = String(keyNode.value);
    } else {
      key = '[complex key]';
    }
    entries.push({ key, keyNode, valueNode: pair.value });
  }
  return entries;
}

function walkYamlNode(node: any, callback: (node: any) => void): void {
  if (!node || typeof node !== 'object') return;
  callback(node);
  if (isMap(node) && Array.isArray(node.items)) {
    for (const pair of node.items) {
      walkYamlNode(pair.key, callback);
      walkYamlNode(pair.value, callback);
    }
  } else if (isSeq(node) && Array.isArray(node.items)) {
    for (const item of node.items) walkYamlNode(item, callback);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/* ------------------------------------------------------------------ */
/* Component conversion types                                          */
/* ------------------------------------------------------------------ */

interface ConvertedComponent {
  node: DocumentNode;
  schema: ComponentSchema | undefined;
  directiveKind: 'inline' | 'leaf' | 'container';
  labelNodes: any[];
  explicitId?: string;
  bindSource?: ValueSource;
  range: SourceRange;
}

interface ConversionState {
  sink: DiagnosticSink;
  source: string;
  ids: Map<string, SourceRange>;
  components: ConvertedComponent[];
  rootNodes: DocumentNode[];
  nodeCounter: number;
  budgetReported: boolean;
}

function directiveKind(node: any): 'inline' | 'leaf' | 'container' {
  if (node.type === 'containerDirective') return 'container';
  if (node.type === 'leafDirective') return 'leaf';
  return 'inline';
}

function extractLabelText(nodes: any[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        out += node.value ?? '';
        break;
      case 'break':
        out += ' ';
        break;
      case 'emphasis':
      case 'strong':
      case 'delete':
      case 'link':
        out += extractLabelText(node.children ?? []);
        break;
      case 'image':
        out += node.alt ?? '';
        break;
      case 'html':
        out += node.value ?? '';
        break;
      case 'component':
        break;
      default:
        if (Array.isArray(node.children)) out += extractLabelText(node.children);
        else if (typeof node.value === 'string') out += node.value;
        break;
    }
  }
  return out;
}

function findInteractiveLabelProblem(nodes: any[]): string | null {
  for (const node of nodes) {
    if (
      node.type === 'link' ||
      node.type === 'linkReference' ||
      node.type === 'image' ||
      node.type === 'imageReference' ||
      node.type === 'textDirective' ||
      node.type === 'leafDirective' ||
      node.type === 'containerDirective'
    ) {
      return `Labels of interactive controls cannot contain ${node.type}.`;
    }
    if (Array.isArray(node.children)) {
      const nested = findInteractiveLabelProblem(node.children);
      if (nested) return nested;
    }
  }
  return null;
}

function attributeValueRange(source: string, nodeRange: SourceRange, name: string): SourceRange | null {
  const slice = source.slice(nodeRange.start, nodeRange.end);
  const pattern = new RegExp(`(?:^|[\\s{])${escapeRegExp(name)}\\s*=\\s*(["'])`);
  const match = pattern.exec(slice);
  if (!match) return null;
  const quote = match[1];
  const valueStart = nodeRange.start + match.index + match[0].length;
  const rest = source.slice(valueStart, nodeRange.end);
  const closing = rest.indexOf(quote);
  const valueEnd = closing === -1 ? nodeRange.end : valueStart + closing;
  return { start: valueStart, end: valueEnd };
}

function parseLiteral(raw: string, schema: PropSchema): { value: Json } | { error: string } {
  switch (schema.type) {
    case 'string':
      return { value: raw };
    case 'currency':
      return CURRENCY_PATTERN.test(raw)
        ? { value: raw }
        : { error: `Expected a three-letter ISO 4217 currency code, got "${raw}".` };
    case 'enum':
      return schema.values && schema.values.includes(raw)
        ? { value: raw }
        : { error: `Expected one of ${(schema.values ?? []).join(', ')}, got "${raw}".` };
    case 'number': {
      if (raw.trim() === '') return { error: 'Expected a number, got an empty string.' };
      const value = Number(raw);
      if (!Number.isFinite(value)) return { error: `Expected a finite number, got "${raw}".` };
      return { value };
    }
    case 'boolean':
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: `Expected "true" or "false", got "${raw}".` };
    case 'value':
      return { value: raw };
    case 'json': {
      if (schema.shape === 'array' && !raw.trim().startsWith('[')) {
        return { error: 'Expected a JSON array.' };
      }
      if (schema.shape === 'object' && !raw.trim().startsWith('{')) {
        return { error: 'Expected a JSON object.' };
      }
      try {
        return { value: JSON.parse(raw) as Json };
      } catch {
        return { error: `Expected JSON, got "${raw}".` };
      }
    }
    case 'formula':
      return { value: raw };
  }
  return { error: `Unsupported attribute type "${(schema as PropSchema).type}".` };
}

function convertComponent(
  node: any,
  state: ConversionState,
  parentComponent: string | null,
): DocumentNode {
  const source = state.source;
  const range = mdastRange(node);
  const name: string = typeof node.name === 'string' ? node.name : '';
  const schema = getComponentSchema(name);
  const kind = directiveKind(node);
  const idPrefix = 'component-';
  let id = `${idPrefix}${range.start}`;
  state.nodeCounter += 1;
  if (state.ids.has(id)) id = `${idPrefix}${range.start}-${state.nodeCounter}`;

  const sink = state.sink;
  if (!schema) {
    sink.add(
      'component-unknown',
      `Unknown component "${name || '(unnamed)'}".${suggestion(name, getComponentNames())}`,
      range,
    );
  } else if (schema.form !== kind) {
    const expected =
      schema.form === 'inline' ? 'an inline directive (:name)' :
      schema.form === 'leaf' ? 'a leaf directive (::name)' :
      'a container directive (:::name ... :::)';
    sink.add(
      'component-form',
      `Component "${name}" must be used as ${expected}, not as a ${kind} directive.`,
      range,
    );
  }

  // Labels.
  let labelNodes: any[] = [];
  let contentNodes: any[] = [];
  if (kind === 'container') {
    const children: any[] = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (child?.data?.directiveLabel) labelNodes.push(child);
      else contentNodes.push(child);
    }
    // A directive label is normally wrapped in a paragraph.
    labelNodes = labelNodes.flatMap((child) => (child.type === 'paragraph' ? child.children ?? [] : [child]));
  } else {
    labelNodes = Array.isArray(node.children) ? node.children : [];
    contentNodes = [];
  }
  const label = labelNodes.length > 0 ? extractLabelText(labelNodes).trim() : '';

  const component: DocumentNode = {
    type: 'component',
    id,
    range,
    name,
    props: {},
    events: {},
    children: [],
  };
  if (label) component.label = label;
  if (name === 'spinner' && !component.label) component.label = '加载中';

  const explicitId = node.attributes?.id;
  if (explicitId !== undefined) {
    const idValue = String(explicitId);
    if (!ID_PATTERN.test(idValue)) {
      sink.add('component-id', `Invalid component id "${idValue}".`, range);
    } else {
      id = idValue;
      component.id = id;
    }
  }
  if (state.ids.has(id)) {
    sink.add('component-id-duplicate', `Duplicate component id "${id}".`, range);
  } else {
    state.ids.set(id, range);
  }

  // Label handling according to the schema.
  if (schema) {
    if (schema.label === 'required-directive' && !label) {
      sink.add('component-label', `Component "${name}" requires a label in [brackets].`, range);
    }
    if (schema.label === 'none' && label) {
      sink.add('component-label', `Component "${name}" does not accept a label.`, range);
    }
    if (schema.label === 'prop' && label) {
      sink.add('component-label', `Component "${name}" takes its label from the label attribute, not [brackets].`, range);
    }
    if (schema.label === 'optional-directive' && labelNodes.length > 0 && !label) {
      sink.add('component-label', `Component "${name}" has an empty label.`, range);
    }
    if ((name === 'button' || name === 'option') && labelNodes.length > 0) {
      const problem = findInteractiveLabelProblem(labelNodes);
      if (problem) sink.add('component-label', problem, range);
    }
  }

  // Attributes.
  const attributes: Record<string, string> = node.attributes ?? {};
  const bind = attributes.bind;
  let binding: string | undefined;

  if (bind !== undefined) {
    if (!schema?.binding) {
      sink.add('attribute-unknown', `Component "${name}" has no bind attribute.`, range);
    } else {
      binding = String(bind);
      component.binding = binding;
      for (const boundProp of schema.boundProps ?? []) {
        if (Object.prototype.hasOwnProperty.call(attributes, boundProp)) {
          sink.add(
            'binding-conflict',
            `Component "${name}" cannot declare both bind and "${boundProp}".`,
            range,
          );
        }
      }
    }
  } else if (schema?.binding?.required) {
    sink.add('component-binding', `Component "${name}" requires a bind attribute.`, range);
  }

  const propRanges: Map<string, SourceRange> = new Map();
  const pendingExpressions: { prop: string; expression: string; range: SourceRange }[] = [];

  for (const [rawName, rawValue] of Object.entries(attributes)) {
    if (rawName === 'id' || rawName === 'bind') continue;
    if (rawName.startsWith('on-')) {
      const event = rawName.slice(3);
      if (schema?.events && (schema.events as Record<string, boolean | undefined>)[event]) {
        component.events = { ...(component.events ?? {}), [event]: String(rawValue) };
      } else {
        sink.add(
          'event-unknown',
          `Component "${name}" does not support the "${rawName}" event.`,
          range,
        );
      }
      continue;
    }

    const propSchema = schema?.props[rawName];
    if (!propSchema) {
      const candidates = schema ? Object.keys(schema.props) : [];
      sink.add(
        'attribute-unknown',
        `Unknown attribute "${rawName}" on component "${name}".${suggestion(rawName, candidates)}`,
        range,
      );
      continue;
    }

    const raw = String(rawValue);
    if (propSchema.dynamic) {
      if (raw.startsWith('==')) {
        component.props![rawName] = { kind: 'literal', value: raw.slice(1) };
      } else if (raw.startsWith('=')) {
        const expression = raw.slice(1);
        const valueRange = attributeValueRange(source, range, rawName);
        const expressionRange: SourceRange = valueRange
          ? { start: valueRange.start + 1, end: Math.min(valueRange.end, valueRange.start + raw.length) }
          : range;
        component.props![rawName] = { kind: 'expression', expression };
        propRanges.set(rawName, expressionRange);
        pendingExpressions.push({ prop: rawName, expression, range: expressionRange });
      } else {
        const literal = parseLiteral(raw, propSchema);
        if ('error' in literal) {
          sink.add('attribute-type', `Attribute "${rawName}" on "${name}": ${literal.error}`, range);
        } else {
          component.props![rawName] = { kind: 'literal', value: literal.value };
        }
      }
    } else {
      const literal = parseLiteral(raw, propSchema);
      if ('error' in literal) {
        sink.add('attribute-type', `Attribute "${rawName}" on "${name}": ${literal.error}`, range);
      } else {
        component.props![rawName] = { kind: 'literal', value: literal.value };
      }
    }
  }

  // Required props and defaults.
  if (schema) {
    for (const [propName, propSchema] of Object.entries(schema.props)) {
      if (component.props![propName] === undefined && propSchema.required) {
        sink.add(
          'component-required-prop',
          `Component "${name}" requires the "${propName}" attribute.`,
          range,
        );
      }
      if (component.props![propName] === undefined && propSchema.default !== undefined) {
        component.props![propName] = { kind: 'literal', value: propSchema.default };
      }
    }
  }

  // Numeric range sanity and select options are checked later, after children.
  if (schema?.label === 'prop' && component.props?.label === undefined) {
    // Reported above through required props; kept for clarity.
  }

  for (const event of schema?.requiredEvents ?? []) {
    if (component.events?.[event] === undefined) {
      sink.add('component-event', `Component "${name}" requires an on-${event} action.`, range);
    }
  }

  // Children.
  const children: DocumentNode[] = [];
  for (const child of contentNodes) {
    const converted = convertMdastNode(child, state, name);
    if (converted) children.push(converted);
  }
  component.children = children;

  if (schema && schema.children === 'none' && kind !== 'container' && children.length > 0) {
    sink.add('component-children', `Component "${name}" cannot contain child nodes.`, range);
  }

  const convertedComponent: ConvertedComponent = {
    node: component,
    schema,
    directiveKind: kind,
    labelNodes,
    explicitId: explicitId === undefined ? undefined : String(explicitId),
    range,
  };
  state.components.push(convertedComponent);

  // Validate number constraints immediately (using literal props).
  validateNumericProps(name, component, sink);
  validateValueFormat(name, component, sink);

  // Dynamic property expressions are type-checked later, once the computed
  // types and defaults are known. Keep the side channel keyed by component id.
  const dynamicProps: { prop: string; expression: string; range: SourceRange; expected: ExpectedType }[] = [];
  for (const pending of pendingExpressions) {
    const expected = expectedTypeFor(name, pending.prop, component.props ?? {});
    if (expected) dynamicProps.push({ ...pending, expected });
  }
  pendingDynamic.set(component.id, dynamicProps);
  for (const [prop, propRange] of propRanges) {
    propRangeStore.set(`${component.id}:${prop}`, propRange);
  }

  if (parentComponent === 'select' && name !== 'option') {
    // Reported by the parent select check as well.
  }

  return component;
}

let pendingDynamic = new Map<string, { prop: string; expression: string; range: SourceRange; expected: ExpectedType }[]>();
let propRangeStore = new Map<string, SourceRange>();

function expectedTypeFor(name: string, prop: string, props: Record<string, ValueSource>): ExpectedType | null {
  if (name === 'value' && prop === 'value') {
    const formatProp = props.format;
    const format = formatProp && formatProp.kind === 'literal' ? formatProp.value : 'text';
    return format === 'number' || format === 'currency' ? 'number' : 'value';
  }
  const schema = getComponentSchema(name);
  const propSchema = schema?.props[prop];
  if (!propSchema) return null;
  switch (propSchema.type) {
    case 'string':
    case 'currency':
    case 'enum':
      return 'string';
    case 'formula':
      return null;
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'value':
      return 'value';
    case 'json':
      if (propSchema.shape === 'array') return 'array';
      if (propSchema.shape === 'object') return 'object';
      return 'json';
  }
}

function literalNumberProp(component: DocumentNode, prop: string): number | undefined {
  const source = component.props?.[prop];
  if (source && source.kind === 'literal' && typeof source.value === 'number' && Number.isFinite(source.value)) {
    return source.value;
  }
  return undefined;
}

function validateNumericProps(name: string, component: DocumentNode, sink: DiagnosticSink): void {
  if (name !== 'number' && name !== 'slider') return;
  const min = literalNumberProp(component, 'min');
  const max = literalNumberProp(component, 'max');
  const step = literalNumberProp(component, 'step');
  if (min !== undefined && max !== undefined && min > max) {
    sink.add('component-range', `Component "${name}" has min ${min} greater than max ${max}.`, component.range);
  }
  if (step !== undefined && !(step > 0)) {
    sink.add('component-range', `Component "${name}" requires step to be positive, got ${step}.`, component.range);
  }
}

function validateValueFormat(name: string, component: DocumentNode, sink: DiagnosticSink): void {
  if (name !== 'value') return;
  const formatSource = component.props?.format;
  const format = formatSource && formatSource.kind === 'literal' ? formatSource.value : 'text';
  const currencySource = component.props?.currency;
  if (format === 'currency' && currencySource === undefined) {
    sink.add('component-currency', 'The value component requires a currency attribute when format is "currency".', component.range);
  }
}

function convertMdastNode(node: any, state: ConversionState, parentComponent: string | null): DocumentNode | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'yaml') return null;
  if (node.type === 'containerDirective' || node.type === 'leafDirective' || node.type === 'textDirective') {
    return convertComponent(node, state, parentComponent);
  }
  if (node.type === 'code' && node.lang === 'reactive-md') return null;

  if (state.components.length > MAX_COMPONENTS && !state.budgetReported) {
    state.budgetReported = true;
    state.sink.add('document-budget', `The document exceeds the limit of ${MAX_COMPONENTS} components.`, mdastRange(node));
  }

  const range = mdastRange(node);
  state.nodeCounter += 1;
  let id = `node-${range.start}`;
  if (state.ids.has(id)) id = `node-${range.start}-${state.nodeCounter}`;
  while (state.ids.has(id)) id = `node-${range.start}-${state.nodeCounter++}`;
  state.ids.set(id, range);

  const base: DocumentNode = { type: node.type, id, range };

  switch (node.type) {
    case 'root':
      return null;
    case 'text':
    case 'inlineCode':
    case 'html':
      base.value = node.value ?? '';
      break;
    case 'heading':
      base.depth = node.depth;
      break;
    case 'code':
      base.value = node.value ?? '';
      if (typeof node.lang === 'string') base.lang = node.lang;
      break;
    case 'list':
      base.ordered = Boolean(node.ordered);
      if (typeof node.start === 'number') base.start = node.start;
      break;
    case 'listItem':
      base.checked = node.checked ?? null;
      break;
    case 'link':
      base.url = node.url ?? '';
      base.title = node.title ?? null;
      break;
    case 'image':
      base.url = node.url ?? '';
      base.alt = node.alt ?? '';
      base.title = node.title ?? null;
      break;
    case 'definition':
      base.url = node.url ?? '';
      base.title = node.title ?? null;
      break;
    case 'table':
      base.align = Array.isArray(node.align) ? node.align : [];
      break;
    default:
      if (typeof node.value === 'string') base.value = node.value;
      break;
  }

  if (Array.isArray(node.children)) {
    const children: DocumentNode[] = [];
    for (const child of node.children) {
      const converted = convertMdastNode(child, state, parentComponent);
      if (converted) children.push(converted);
    }
    base.children = children;
  }

  return base;
}

/* ------------------------------------------------------------------ */
/* YAML configuration parsing                                          */
/* ------------------------------------------------------------------ */

interface YamlValidation {
  content: ConfigContent;
  computedDependencies: Map<string, string[]>;
}

function readConfig(
  yamlText: string,
  contentOffset: number,
  source: string,
  sink: DiagnosticSink,
): ConfigContent {
  const content: ConfigContent = {
    version: '',
    data: {},
    state: {},
    computed: {},
    actions: {},
    computedRanges: new Map(),
    actionRanges: new Map(),
  };
  let document: any;
  try {
    document = parseDocument(yamlText, {
      uniqueKeys: true,
      customTags: [],
      merge: false,
      schema: 'core',
      prettyErrors: false,
      strict: true,
      logLevel: 'silent',
    } as any);
  } catch (error) {
    sink.add(
      'yaml-parse',
      `The YAML configuration could not be parsed: ${(error as Error).message}`,
      { start: contentOffset, end: contentOffset + Math.min(yamlText.length, 1) },
    );
    return content;
  }

  for (const error of document.errors) {
    const position = Array.isArray((error as any).pos) ? (error as any).pos[0] : 0;
    const range: SourceRange = {
      start: contentOffset + position,
      end: contentOffset + (Array.isArray((error as any).pos) ? (error as any).pos[1] : position) + 1,
    };
    sink.add('yaml-parse', error.message, range);
  }

  const root = document.contents;
  if (root) {
    walkYamlNode(root, (node) => {
      if (isAlias(node)) {
        sink.add('yaml-alias', 'YAML aliases are not allowed.', yamlRange(node, contentOffset));
      }
      if (node.anchor) {
        sink.add('yaml-anchor', 'YAML anchors are not allowed.', yamlRange(node, contentOffset));
      }
      if (node.tag) {
        sink.add('yaml-tag', `YAML tags are not allowed ("${String(node.tag)}").`, yamlRange(node, contentOffset));
      }
      if (isMap(node) && Array.isArray(node.items)) {
        for (const pair of node.items) {
          if (isScalar(pair.key) && (pair.key.value === '<<' || (pair.key as any).source === '<<')) {
            sink.add('yaml-merge', 'YAML merge keys are not allowed.', yamlRange(pair.key, contentOffset));
          }
        }
      }
    });
  }

  if (!root) {
    sink.add('config-version', 'The reactive-md configuration block must contain a version field.', { start: contentOffset, end: contentOffset });
    return content;
  }
  if (!isMap(root)) {
    sink.add('config-shape', 'The reactive-md configuration must be a YAML mapping.', yamlRange(root, contentOffset));
    return content;
  }

  const entries = yamlKeyEntries(root);
  const allowed = new Set(['version', 'data', 'state', 'computed', 'actions']);
  const seen = new Map<string, any>();
  for (const entry of entries) {
    if (entry.key === '[complex key]') {
      sink.add('yaml-key', 'Configuration keys must be scalar strings.', yamlRange(entry.keyNode, contentOffset));
      continue;
    }
    if (seen.has(entry.key)) {
      sink.add('config-duplicate-key', `Duplicate configuration field "${entry.key}".`, yamlRange(entry.keyNode, contentOffset));
    }
    seen.set(entry.key, entry.valueNode);
    if (!allowed.has(entry.key)) {
      sink.add(
        'config-unknown-field',
        `Unknown configuration field "${entry.key}".${suggestion(entry.key, [...allowed])}`,
        yamlRange(entry.keyNode, contentOffset),
      );
    }
  }

  // version
  const versionNode = seen.get('version');
  if (!versionNode) {
    sink.add('config-version', 'The reactive-md configuration block requires a version field.', yamlRange(root, contentOffset));
  } else if (!isScalar(versionNode)) {
    sink.add('config-version', 'The version field must be "0.1" or "0.2".', yamlRange(versionNode, contentOffset));
  } else {
    const value = String(versionNode.value);
    if (!VERSIONS.has(value)) {
      sink.add(
        'config-version',
        `Unsupported Reactive MD version "${value}". Supported versions are "0.1" and "0.2".`,
        yamlRange(versionNode, contentOffset),
      );
    } else {
      content.version = value;
    }
  }

  // data
  const dataNode = seen.get('data');
  if (dataNode !== undefined && dataNode !== null) {
    if (!isMap(dataNode)) {
      sink.add('data-shape', 'The data field must be a mapping of JSON values.', yamlRange(dataNode, contentOffset));
    } else {
      const dataValue = convertJsonNode(dataNode, contentOffset, sink);
      if (dataValue !== null && typeof dataValue === 'object' && !Array.isArray(dataValue)) {
        content.data = dataValue;
      } else {
        sink.add('data-shape', 'The data field must be a mapping of JSON values.', yamlRange(dataNode, contentOffset));
      }
    }
  }

  // state
  const stateNode = seen.get('state');
  const stateNames: string[] = [];
  if (stateNode !== undefined && stateNode !== null) {
    if (!isMap(stateNode)) {
      sink.add('state-shape', 'The state field must be a mapping.', yamlRange(stateNode, contentOffset));
    } else {
      for (const entry of yamlKeyEntries(stateNode)) {
        if (!checkName(entry.key, 'state', contentOffset, sink, entry.keyNode)) continue;
        const value = readStateValue(entry.valueNode, contentOffset, sink, `state "${entry.key}"`);
        if (value === undefined) continue;
        safeSet(content.state, entry.key, value);
        stateNames.push(entry.key);
      }
    }
  }

  // computed
  const computedNode = seen.get('computed');
  const computedNames: string[] = [];
  if (computedNode !== undefined && computedNode !== null) {
    if (!isMap(computedNode)) {
      sink.add('computed-shape', 'The computed field must be a mapping.', yamlRange(computedNode, contentOffset));
    } else {
      for (const entry of yamlKeyEntries(computedNode)) {
        if (!checkName(entry.key, 'computed', contentOffset, sink, entry.keyNode)) continue;
        if (Object.prototype.hasOwnProperty.call(content.state, entry.key)) {
          sink.add(
            'name-duplicate',
            `Name "${entry.key}" is declared as both state and computed.`,
            yamlRange(entry.keyNode, contentOffset),
          );
          continue;
        }
        const valueNode = entry.valueNode;
        if (!isScalar(valueNode) || typeof valueNode.value !== 'string') {
          sink.add(
            'computed-expression',
            `Computed "${entry.key}" must be a string expression starting with "=".`,
            yamlRange(valueNode, contentOffset),
          );
          continue;
        }
        const raw = valueNode.value;
        if (!raw.startsWith('=') || raw.startsWith('==') || raw.length <= 1) {
          sink.add(
            'computed-expression',
            `Computed "${entry.key}" must be a string expression starting with a single "=".`,
            yamlRange(valueNode, contentOffset),
          );
          continue;
        }
        const expression = raw.slice(1);
        safeSet(content.computed, entry.key, expression);
        content.computedRanges.set(entry.key, scalarExpressionRange(valueNode, contentOffset, expression, source));
        computedNames.push(entry.key);
      }
    }
  }

  // actions
  const actionsNode = seen.get('actions');
  if (actionsNode !== undefined && actionsNode !== null) {
    if (!isMap(actionsNode)) {
      sink.add('actions-shape', 'The actions field must be a mapping.', yamlRange(actionsNode, contentOffset));
    } else {
      for (const entry of yamlKeyEntries(actionsNode)) {
        if (!checkActionName(entry.key, contentOffset, sink, entry.keyNode)) continue;
        const stepNodes = entry.valueNode;
        if (!isSeq(stepNodes) || !Array.isArray(stepNodes.items) || stepNodes.items.length === 0) {
          sink.add(
            'action-shape',
            `Action "${entry.key}" must be a non-empty list of steps.`,
            yamlRange(stepNodes, contentOffset),
          );
          continue;
        }
        const steps: ActionStep[] = [];
        for (const stepNode of stepNodes.items) {
          const step = readActionStep(stepNode, entry.key, contentOffset, source, sink);
          if (step) steps.push(step);
        }
        safeSet(content.actions, entry.key, steps);
        content.actionRanges.set(entry.key, yamlRange(stepNodes, contentOffset));
      }
    }
  }

  return content;
}

function checkName(
  name: string,
  kind: 'state' | 'computed',
  contentOffset: number,
  sink: DiagnosticSink,
  node: any,
): boolean {
  if (!NAME_PATTERN.test(name)) {
    sink.add('name-invalid', `${kind[0].toUpperCase()}${kind.slice(1)} name "${name}" must match [A-Za-z_][A-Za-z0-9_]*.`, yamlRange(node, contentOffset));
    return false;
  }
  if (FORBIDDEN_KEYS.has(name)) {
    sink.add('name-reserved', `Name "${name}" is reserved.`, yamlRange(node, contentOffset));
    return false;
  }
  if (RESERVED_NAMES.has(name) || ['true', 'false', 'null'].includes(name)) {
    sink.add('name-reserved', `Name "${name}" is reserved by the expression language.`, yamlRange(node, contentOffset));
    return false;
  }
  return true;
}

function checkActionName(name: string, contentOffset: number, sink: DiagnosticSink, node: any): boolean {
  if (!NAME_PATTERN.test(name)) {
    sink.add('name-invalid', `Action name "${name}" must match [A-Za-z_][A-Za-z0-9_]*.`, yamlRange(node, contentOffset));
    return false;
  }
  if (FORBIDDEN_KEYS.has(name) || name === 'data') {
    sink.add('name-reserved', `Action name "${name}" is reserved.`, yamlRange(node, contentOffset));
    return false;
  }
  return true;
}

function readStateValue(node: any, contentOffset: number, sink: DiagnosticSink, label: string): StateValue | undefined {
  if (node === undefined || node === null) return null;
  if (isAlias(node)) return undefined;
  const before = sink.list.length;
  const value = convertJsonNode(node, contentOffset, sink);
  if (sink.list.length > before) {
    // convertJsonNode reports its own diagnostics; keep the value only when it
    // is still a usable JSON value.
    for (let i = before; i < sink.list.length; i += 1) {
      const diagnostic = sink.list[i];
      diagnostic.message = diagnostic.message.replace(/^Data/, label.charAt(0).toUpperCase() + label.slice(1));
    }
    return value;
  }
  return value;
}

function convertJsonNode(node: any, contentOffset: number, sink: DiagnosticSink): Json {
  if (node === null || node === undefined) return null;
  if (isAlias(node)) return null;
  if (isScalar(node)) {
    const value = node.value;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        sink.add('data-type', 'Data numbers must be finite.', yamlRange(node, contentOffset));
        return null;
      }
      return value;
    }
    if (value instanceof Date) {
      sink.add('data-type', 'Dates are not JSON values; quote the date as a string.', yamlRange(node, contentOffset));
      return null;
    }
    sink.add('data-type', 'Data values must be JSON-compatible.', yamlRange(node, contentOffset));
    return null;
  }
  if (isSeq(node) && Array.isArray(node.items)) {
    return node.items.map((item: any) => convertJsonNode(item, contentOffset, sink));
  }
  if (isMap(node)) {
    const out: Record<string, Json> = {};
    for (const pair of node.items) {
      const keyNode = pair.key;
      if (!isScalar(keyNode) || typeof keyNode.value !== 'string') {
        sink.add('data-key', 'Data keys must be strings.', yamlRange(keyNode, contentOffset));
        continue;
      }
      const key = keyNode.value;
      if (FORBIDDEN_KEYS.has(key)) {
        sink.add('data-key', `Data key "${key}" is not allowed.`, yamlRange(keyNode, contentOffset));
        continue;
      }
      safeSet(out, key, convertJsonNode(pair.value, contentOffset, sink));
    }
    return out;
  }
  sink.add('data-type', 'Data values must be JSON-compatible.', yamlRange(node, contentOffset));
  return null;
}

function readValueSource(node: any, contentOffset: number, sink: DiagnosticSink, label: string): ValueSource | null {
  if (node === undefined) {
    sink.add('action-value', `${label} is missing.`, { start: contentOffset, end: contentOffset });
    return null;
  }
  if (isScalar(node)) {
    const raw = node.value;
    if (typeof raw === 'string') {
      if (raw.startsWith('==')) return { kind: 'literal', value: raw.slice(1) };
      if (raw.startsWith('=')) {
        const expression = raw.slice(1);
        if (expression.length === 0) {
          sink.add('action-value', `${label} has an empty expression.`, yamlRange(node, contentOffset));
          return null;
        }
        return { kind: 'expression', expression };
      }
      return { kind: 'literal', value: raw };
    }
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        sink.add('action-value', `${label} must be finite.`, yamlRange(node, contentOffset));
        return null;
      }
      return { kind: 'literal', value: raw };
    }
    if (typeof raw === 'boolean' || raw === null) {
      return { kind: 'literal', value: raw };
    }
    if (raw instanceof Date) {
      sink.add('action-value', `${label} must not be a date; quote it as a string.`, yamlRange(node, contentOffset));
      return null;
    }
  }
  if (isSeq(node) || isMap(node)) {
    return { kind: 'literal', value: convertJsonNode(node, contentOffset, sink) };
  }
  sink.add('action-value', `${label} must be a scalar, JSON collection or an expression string.`, yamlRange(node, contentOffset));
  return null;
}

function readActionStep(
  stepNode: any,
  actionName: string,
  contentOffset: number,
  source: string,
  sink: DiagnosticSink,
): ActionStep | null {
  if (!isMap(stepNode)) {
    sink.add('action-step', `Each step of action "${actionName}" must be a mapping.`, yamlRange(stepNode, contentOffset));
    return null;
  }
  const entries = yamlKeyEntries(stepNode);
  const operations = ['set', 'reset', 'append', 'remove', 'update', 'call'];
  const present = operations.filter((operation) => entries.some((entry) => entry.key === operation));
  if (present.length !== 1) {
    sink.add(
      'action-step',
      `Each step of action "${actionName}" must contain exactly one of ${operations.map((item) => `"${item}"`).join(', ')}.`,
      yamlRange(stepNode, contentOffset),
    );
    return null;
  }
  const operation = present[0];
  const stepRange = yamlRange(stepNode, contentOffset);
  const field = (name: string) => entries.find((entry) => entry.key === name)?.valueNode;
  const allowed: Record<string, string[]> = {
    set: ['set', 'value'],
    reset: ['reset'],
    append: ['append', 'value'],
    remove: ['remove', 'at'],
    update: ['update', 'at', 'value'],
    call: ['call', 'input'],
  };
  for (const entry of entries) {
    if (!allowed[operation].includes(entry.key)) {
      sink.add('action-step', `Unknown field "${entry.key}" in a ${operation} step.`, yamlRange(entry.keyNode, contentOffset));
    }
  }

  if (operation === 'reset') {
    const listNode = field('reset');
    if (!isSeq(listNode) || !Array.isArray(listNode.items) || listNode.items.length === 0) {
      sink.add('action-reset', `The reset field of action "${actionName}" must be a non-empty list of state names.`, yamlRange(listNode, contentOffset));
      return null;
    }
    const reset: string[] = [];
    for (const item of listNode.items) {
      if (!isScalar(item) || typeof item.value !== 'string') {
        sink.add('action-reset', `Reset targets of action "${actionName}" must be state names.`, yamlRange(item, contentOffset));
        continue;
      }
      if (!NAME_PATTERN.test(item.value)) {
        sink.add('action-reset', `Invalid state name "${item.value}" in action "${actionName}".`, yamlRange(item, contentOffset));
        continue;
      }
      reset.push(item.value);
    }
    if (reset.length === 0) return null;
    return { reset, range: stepRange };
  }

  if (operation === 'call') {
    const callNode = field('call');
    if (!isScalar(callNode) || typeof callNode.value !== 'string' || !CALL_NAME_PATTERN.test(callNode.value)) {
      sink.add('action-call', `The call target of action "${actionName}" must be a capability name.`, yamlRange(callNode, contentOffset));
      return null;
    }
    const input: Record<string, ValueSource> = {};
    const inputNode = field('input');
    if (inputNode !== undefined && inputNode !== null) {
      if (!isMap(inputNode)) {
        sink.add('action-input', `The input of action "${actionName}" must be a mapping.`, yamlRange(inputNode, contentOffset));
        return null;
      }
      for (const entry of yamlKeyEntries(inputNode)) {
        if (entry.key === '[complex key]' || FORBIDDEN_KEYS.has(entry.key)) {
          sink.add('action-input', `Input field "${entry.key}" is not allowed.`, yamlRange(entry.keyNode, contentOffset));
          continue;
        }
        const value = readValueSource(entry.valueNode, contentOffset, sink, `Input "${entry.key}" of action "${actionName}"`);
        if (value) safeSet(input, entry.key, value);
      }
    }
    return { call: callNode.value, input, range: stepRange };
  }

  const targetNode = field(operation);
  if (!isScalar(targetNode) || typeof targetNode.value !== 'string') {
    sink.add('action-target', `The ${operation} target of action "${actionName}" must be a state name.`, yamlRange(targetNode, contentOffset));
    return null;
  }
  const target = targetNode.value;
  if (!NAME_PATTERN.test(target)) {
    sink.add('action-target', `Invalid state name "${target}" in action "${actionName}".`, yamlRange(targetNode, contentOffset));
    return null;
  }

  if (operation === 'set' || operation === 'append') {
    const valueNode = field('value');
    if (!valueNode) {
      sink.add('action-step', `The ${operation} step for "${target}" requires a value field.`, stepRange);
      return null;
    }
    const value = readValueSource(valueNode, contentOffset, sink, `The value for "${target}"`);
    if (!value) return null;
    return operation === 'set'
      ? { set: target, value, range: stepRange }
      : { append: target, value, range: stepRange };
  }

  const atNode = field('at');
  if (!atNode) {
    sink.add('action-step', `The ${operation} step for "${target}" requires an at field.`, stepRange);
    return null;
  }
  const at = readValueSource(atNode, contentOffset, sink, `The index for "${target}"`);
  if (!at) return null;

  if (operation === 'remove') {
    return { remove: target, at, range: stepRange };
  }
  const valueNode = field('value');
  if (!valueNode) {
    sink.add('action-step', `The update step for "${target}" requires a value field.`, stepRange);
    return null;
  }
  const value = readValueSource(valueNode, contentOffset, sink, `The value for "${target}"`);
  if (!value) return null;
  return { update: target, at, value, range: stepRange };
}

/* ------------------------------------------------------------------ */
/* Semantic validation                                                 */
/* ------------------------------------------------------------------ */

function inferComputedTypes(
  content: ConfigContent,
  env: TypeEnv,
  sink: DiagnosticSink,
): { order: string[]; dependencies: Map<string, string[]>; types: Map<string, ExprType> } {
  const names = Object.keys(content.computed);
  const nameSet = new Set(names);
  const dependencies = new Map<string, string[]>();
  const types = new Map<string, ExprType>();
  const failed = new Set<string>();

  // Declared computed names are visible while inferring (types may still be any
  // inside cycles, which are reported separately).
  for (const name of names) {
    if (env.values[name] === undefined) env.values[name] = { kind: 'any' };
  }

  for (const name of names) {
    const range = content.computedRanges.get(name) ?? { start: 0, end: 0 };
    try {
      const ast = parseExpression(content.computed[name]);
      const deps = collectDependencies(ast).filter((dep) => nameSet.has(dep));
      dependencies.set(name, deps);
      if (!content.computedRanges.has(name)) {
        sink.add('computed-range', `Internal: no range for computed "${name}".`, range);
      }
    } catch (error) {
      dependencies.set(name, []);
      failed.add(name);
      sink.expression(error, range, `Computed "${name}"`);
    }
  }

  const visiting = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const order: string[] = [];

  const visit = (name: string): void => {
    const status = visiting.get(name) ?? 0;
    if (status === 2) return;
    if (status === 1) {
      const index = stack.indexOf(name);
      const path = [...stack.slice(index >= 0 ? index : 0), name];
      const range = content.computedRanges.get(name) ?? { start: 0, end: 0 };
      sink.add(
        'computed-cycle',
        `Circular computed dependency: ${path.join(' → ')}.`,
        range,
      );
      return;
    }
    visiting.set(name, 1);
    stack.push(name);
    for (const dependency of dependencies.get(name) ?? []) {
      if (nameSet.has(dependency)) visit(dependency);
    }
    stack.pop();
    visiting.set(name, 2);
    order.push(name);
  };

  for (const name of names) visit(name);

  // Infer types in topological order.
  for (const name of order) {
    if (failed.has(name)) continue;
    const range = content.computedRanges.get(name) ?? { start: 0, end: 0 };
    try {
      const ast = parseExpression(content.computed[name]);
      const type = inferType(ast, env);
      types.set(name, type);
      env.values[name] = type;
    } catch (error) {
      types.set(name, { kind: 'any' });
      env.values[name] = { kind: 'any' };
      sink.expression(error, range, `Computed "${name}"`);
    }
  }

  return { order, dependencies, types };
}

function checkExpressionType(
  expression: string,
  range: SourceRange,
  expected: ExpectedType,
  env: TypeEnv,
  sink: DiagnosticSink,
  context: string,
): void {
  try {
    const ast = parseExpression(expression);
    const type = inferType(ast, env);
    checkExpectedType(type, expected, 0);
  } catch (error) {
    sink.expression(error, range, context);
  }
}

function checkExpression(expression: string, range: SourceRange, env: TypeEnv, sink: DiagnosticSink, context: string): void {
  try {
    inferType(parseExpression(expression), env);
  } catch (error) {
    sink.expression(error, range, context);
  }
}

function checkLiteralAgainstExpected(
  value: Json,
  expected: ExpectedType,
  range: SourceRange,
  sink: DiagnosticSink,
  context: string,
): void {
  const type = jsonToExprType(value);
  try {
    checkExpectedType(type, expected, 0);
  } catch (error) {
    sink.expression(error, range, context);
  }
}

function checkValueSource(
  source: ValueSource,
  expected: ExpectedType | null,
  range: SourceRange,
  env: TypeEnv,
  sink: DiagnosticSink,
  context: string,
): void {
  if (source.kind === 'literal') {
    if (expected) checkLiteralAgainstExpected(source.value, expected, range, sink, context);
    return;
  }
  if (expected) checkExpressionType(source.expression, range, expected, env, sink, context);
  else checkExpression(source.expression, range, env, sink, context);
}

function stateKindOf(value: StateValue): 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value as 'string' | 'number' | 'boolean';
}

function expectedTypeForState(value: StateValue): ExpectedType {
  switch (stateKindOf(value)) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return 'array';
    case 'object': return 'object';
    case 'null': return 'json';
  }
  return 'json';
}

function valueMatchesBindingType(
  type: BindingConstraint['type'],
  value: StateValue,
): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return false;
}

function literalStringProp(node: DocumentNode, name: string): string | undefined {
  const source = node.props?.[name];
  if (source && source.kind === 'literal' && typeof source.value === 'string') return source.value;
  return undefined;
}

function eachScopeNames(node: DocumentNode): { as: string; index: string } {
  return {
    as: literalStringProp(node, 'as') ?? 'item',
    index: literalStringProp(node, 'index') ?? 'index',
  };
}

function eachElementType(node: DocumentNode, env: TypeEnv): ExprType {
  const source = node.props?.items;
  if (!source) return { kind: 'any' };
  if (source.kind === 'literal') {
    const type = jsonToExprType(source.value);
    return type.kind === 'array' ? type.element : { kind: 'any' };
  }
  try {
    const type = inferType(parseExpression(source.expression), env);
    if (type.kind === 'array') return type.element;
  } catch {
    // The property check reports the expression error.
  }
  return { kind: 'any' };
}

function buildScopeEnvs(
  nodes: DocumentNode[],
  env: TypeEnv,
  out: Map<string, TypeEnv>,
): void {
  for (const node of nodes) {
    out.set(node.id, env);
    let childEnv = env;
    if (node.type === 'component' && node.name === 'each') {
      const names = eachScopeNames(node);
      childEnv = {
        ...env,
        locals: {
          ...(env.locals ?? {}),
          [names.as]: eachElementType(node, env),
          [names.index]: { kind: 'number' },
        },
      };
    }
    if (node.children) buildScopeEnvs(node.children, childEnv, out);
  }
}

function indexNodeParents(
  nodes: DocumentNode[],
  parent: DocumentNode | null,
  out: Map<string, DocumentNode | null>,
): void {
  for (const node of nodes) {
    out.set(node.id, parent);
    if (node.children) indexNodeParents(node.children, node, out);
  }
}

function collectEachAliases(nodes: DocumentNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'component' && node.name === 'each') {
      const names = eachScopeNames(node);
      out.add(names.as);
      out.add(names.index);
    }
    if (node.children) collectEachAliases(node.children, out);
  }
}

function validateEachNode(node: DocumentNode, sink: DiagnosticSink): void {
  const source = node.props?.key;
  if (!source || source.kind !== 'literal' || typeof source.value !== 'string') {
    // The required-prop check already reported a missing key.
    return;
  }
  const names = eachScopeNames(node);
  for (const name of [names.as, names.index]) {
    if (!NAME_PATTERN.test(name) || RESERVED_NAMES.has(name)) {
      sink.add('each-local-name', `Invalid each local name "${name}".`, node.range);
    }
  }
  if (names.as === names.index) {
    sink.add('each-local-name', `The each item and index names must differ ("${names.as}").`, node.range);
  }
  if (source.value !== 'index' && !NAME_PATTERN.test(source.value)) {
    sink.add('each-key', `Invalid each key field "${source.value}".`, node.range);
    return;
  }

  const items = node.props?.items;
  if (items && items.kind === 'literal' && Array.isArray(items.value)) {
    const seen = new Set<string>();
    items.value.forEach((item, position) => {
      if (source.value === 'index') return;
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        sink.add('each-key', `Each item at index ${position} must be an object with a "${source.value}" field.`, node.range);
        return;
      }
      const value = (item as Record<string, Json>)[source.value as string];
      if (value === undefined || (typeof value !== 'string' && typeof value !== 'number')) {
        sink.add('each-key', `Each item at index ${position} requires a string or number "${source.value}".`, node.range);
        return;
      }
      const key = String(value);
      if (seen.has(key)) {
        sink.add('each-key', `Duplicate each key "${key}".`, node.range);
      }
      seen.add(key);
    });
  }
}

function validatePlotNode(node: DocumentNode, env: TypeEnv, sink: DiagnosticSink): void {
  const source = node.props?.formula;
  if (!source || source.kind !== 'literal' || typeof source.value !== 'string') return;
  const formula = source.value;
  const formulaEnv: TypeEnv = {
    ...env,
    locals: { ...(env.locals ?? {}), x: { kind: 'number' } },
  };
  try {
    const type = inferType(parseExpression(formula), formulaEnv);
    checkExpectedType(type, 'number', 0);
  } catch (error) {
    sink.expression(error, node.range, 'Formula of <plot>');
  }
}

function validateComponentTreeRules(
  nodes: DocumentNode[],
  parents: Map<string, DocumentNode | null>,
  sink: DiagnosticSink,
): void {
  const isDescendantOf = (nodeId: string, name: string): boolean => {
    let parent = parents.get(nodeId) ?? null;
    while (parent) {
      if (parent.type === 'component' && parent.name === name) return true;
      parent = parents.get(parent.id) ?? null;
    }
    return false;
  };

  for (const node of nodes) {
    if (node.type === 'component' && node.name) {
      if (node.name === 'option') {
        const parent = parents.get(node.id) ?? null;
        const allowed = parent?.type === 'component'
          && ['select', 'radio-group', 'choices'].includes(parent.name ?? '');
        if (!allowed) {
          sink.add('component-nesting', 'The option component must be a direct child of select, radio-group or choices.', node.range);
        }
      }
      if (node.name === 'tab') {
        const parent = parents.get(node.id) ?? null;
        if (!(parent?.type === 'component' && parent.name === 'tabs')) {
          sink.add('component-nesting', 'The tab component must be a direct child of tabs.', node.range);
        }
      }
      if (node.name === 'form' && isDescendantOf(node.id, 'form')) {
        sink.add('component-nesting', 'Forms cannot be nested.', node.range);
      }
      if (node.name === 'each') validateEachNode(node, sink);
      if (['select', 'radio-group', 'choices'].includes(node.name)) {
        const values = new Set<string>();
        for (const child of node.children ?? []) {
          if (child.type === 'component' && child.name === 'option') {
            const value = literalStringProp(child, 'value');
            if (value !== undefined) {
              if (values.has(value)) {
                sink.add('option-duplicate', `Duplicate option value "${value}" in <${node.name}>.`, child.range);
              }
              values.add(value);
            }
          } else if (child.type === 'text' && (child.value ?? '').trim() === '') {
            continue;
          } else {
            sink.add(
              node.name === 'select' ? 'select-child' : 'component-children',
              `A ${node.name} component may only contain option components and whitespace.`,
              child.range,
            );
          }
        }
      }
      if (node.name === 'tabs') {
        const values = new Set<string>();
        for (const child of node.children ?? []) {
          if (child.type === 'component' && child.name === 'tab') {
            const value = literalStringProp(child, 'value');
            if (value !== undefined) {
              if (values.has(value)) {
                sink.add('tab-duplicate', `Duplicate tab value "${value}".`, child.range);
              }
              values.add(value);
            }
          } else if (child.type === 'text' && (child.value ?? '').trim() === '') {
            continue;
          } else {
            sink.add('component-children', 'A tabs component may only contain tab components and whitespace.', child.range);
          }
        }
      }
      if (node.name === 'accordion') {
        for (const child of node.children ?? []) {
          if (child.type === 'component' && child.name === 'disclosure') continue;
          if (child.type === 'text' && (child.value ?? '').trim() === '') continue;
          sink.add('component-children', 'An accordion may only contain disclosure components and whitespace.', child.range);
        }
      }
      if (['input', 'textarea'].includes(node.name)) {
        const minLength = literalNumberProp(node, 'min-length');
        const maxLength = literalNumberProp(node, 'max-length');
        if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
          sink.add('component-range', `Component "${node.name}" has min-length greater than max-length.`, node.range);
        }
      }
      if (node.name === 'date') {
        for (const prop of ['min', 'max']) {
          const value = literalStringProp(node, prop);
          if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            sink.add('component-range', `Date attribute "${prop}" must be an ISO date (YYYY-MM-DD).`, node.range);
          }
        }
      }
    }
    if (node.children) validateComponentTreeRules(node.children, parents, sink);
  }
}

function validateComponents(
  state: ConversionState,
  env: TypeEnv,
  content: ConfigContent,
  sink: DiagnosticSink,
): void {
  const scopeEnvs = new Map<string, TypeEnv>();
  for (const node of state.rootNodes) buildScopeEnvs([node], env, scopeEnvs);
  const parents = new Map<string, DocumentNode | null>();
  for (const node of state.rootNodes) indexNodeParents([node], null, parents);
  for (const node of state.rootNodes) validateComponentTreeRules([node], parents, sink);

  for (const component of state.components) {
    const converted = component.node;
    const schema = component.schema;
    if (!schema) continue;
    const componentEnv = scopeEnvs.get(converted.id) ?? env;

    // Dynamic prop expressions.
    const dynamics = pendingDynamic.get(converted.id) ?? [];
    for (const dynamic of dynamics) {
      checkExpressionType(
        dynamic.expression,
        dynamic.range,
        dynamic.expected,
        componentEnv,
        sink,
        `Property "${dynamic.prop}" of <${schema.name}>`,
      );
    }

    // Literal dynamic properties still need type checks (disabled="false" etc.).
    for (const [propName, propSchema] of Object.entries(schema.props)) {
      const source = converted.props?.[propName];
      if (!source || source.kind !== 'literal') continue;
      if (!propSchema.dynamic) {
        if (schema.name === 'value' && propName === 'value') {
          const formatSource = converted.props?.format;
          const format = formatSource && formatSource.kind === 'literal' ? formatSource.value : 'text';
          const expected: ExpectedType = format === 'number' || format === 'currency' ? 'number' : 'value';
          checkLiteralAgainstExpected(source.value, expected, converted.range, sink, 'Value of <value>');
        }
        continue;
      }
      const expected = expectedTypeFor(schema.name, propName, converted.props ?? {});
      if (!expected) continue;
      checkLiteralAgainstExpected(source.value, expected, converted.range, sink, `Property "${propName}" of <${schema.name}>`);
    }

    if (schema.name === 'plot') validatePlotNode(converted, componentEnv, sink);

    // Binding name/type checks.
    if (component.node.binding !== undefined && schema.binding) {
      const stateName = component.node.binding;
      if (!Object.prototype.hasOwnProperty.call(content.state, stateName)) {
        const candidates = Object.keys(content.state);
        sink.add(
          'binding-unknown-state',
          `Component "${schema.name}" binds unknown state "${stateName}".${suggestion(stateName, candidates)}`,
          component.range,
        );
      } else {
        const value = content.state[stateName];
        if (!valueMatchesBindingType(schema.binding.type, value)) {
          sink.add(
            'binding-type',
            `Component "${schema.name}" binds "${stateName}" as ${schema.binding.type}, but the state is ${stateKindOf(value)}.`,
            component.range,
          );
        }
      }
    }

    // Event action references.
    for (const [event, actionName] of Object.entries(converted.events ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(content.actions, actionName)) {
        sink.add(
          'event-unknown-action',
          `Event "${event}" references unknown action "${actionName}".${suggestion(actionName, Object.keys(content.actions))}`,
          component.range,
        );
      }
    }
  }
}

function collectBindingConstraints(
  state: ConversionState,
  content: ConfigContent,
  sink: DiagnosticSink,
): BindingConstraint[] {
  const constraints: BindingConstraint[] = [];
  for (const component of state.components) {
    const node = component.node;
    const schema = component.schema;
    if (!schema?.binding || node.binding === undefined) continue;
    const bindingType = schema.binding.type;
    const constraint: BindingConstraint = {
      componentId: node.id,
      state: node.binding,
      type: bindingType,
      range: component.range,
    };
    if (bindingType === 'number') {
      const min = literalNumberProp(node, 'min');
      const max = literalNumberProp(node, 'max');
      const step = literalNumberProp(node, 'step');
      if (min !== undefined) constraint.min = min;
      if (max !== undefined) constraint.max = max;
      if (step !== undefined) constraint.step = step;
    }
    if (['select', 'radio-group', 'choices'].includes(schema.name)) {
      const options: string[] = [];
      for (const child of node.children ?? []) {
        if (child.type === 'component' && child.name === 'option') {
          const valueSource = child.props?.value;
          if (valueSource && valueSource.kind === 'literal' && typeof valueSource.value === 'string') {
            options.push(valueSource.value);
          }
        }
      }
      constraint.options = options;
    }
    constraints.push(constraint);
  }

  // Cross-control conflicts and initial value checks.
  const byState = new Map<string, BindingConstraint[]>();
  for (const constraint of constraints) {
    if (!byState.has(constraint.state)) byState.set(constraint.state, []);
    byState.get(constraint.state)!.push(constraint);
  }

  for (const [stateName, list] of byState) {
    if (!Object.prototype.hasOwnProperty.call(content.state, stateName)) continue;
    const bounds = list.filter((item) => item.min !== undefined || item.max !== undefined);
    if (bounds.length > 0) {
      const lower = Math.max(...bounds.map((item) => item.min ?? -Number.POSITIVE_INFINITY));
      const upper = Math.min(...bounds.map((item) => item.max ?? Number.POSITIVE_INFINITY));
      if (lower > upper) {
        const last = bounds[bounds.length - 1];
        sink.add(
          'binding-conflict',
          `Bindings for state "${stateName}" have incompatible ranges: minimum ${lower} exceeds maximum ${upper}.`,
          last.range,
        );
      }
    }
    const options = list.filter((item) => item.options !== undefined).map((item) => item.options as string[]);
    if (options.length > 1) {
      const intersection = options.reduce((acc, current) => acc.filter((item) => current.includes(item)));
      if (intersection.length === 0) {
        sink.add(
          'binding-conflict',
          `Bindings for state "${stateName}" have no common select options.`,
          list[list.length - 1].range,
        );
      }
    }
    const initial = content.state[stateName];
    for (const constraint of list) {
      const problem = checkBindingValue(constraint, initial);
      if (problem) {
        sink.add('binding-initial', problem, constraint.range);
      }
    }
  }

  return constraints;
}

/* ------------------------------------------------------------------ */
/* Compilation                                                         */
/* ------------------------------------------------------------------ */

export function compile(source: string): CompileResult {
  try {
    return compileSource(source);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        makeDiagnostic(
          source,
          'internal-error',
          `The document could not be compiled: ${(error as Error).message}`,
          { start: 0, end: Math.min(source.length, 1) },
        ),
      ],
    };
  }
}

function compileSource(source: string): CompileResult {
  const sink = new DiagnosticSink(source);
  if (source.length > MAX_SOURCE_LENGTH) {
    sink.add(
      'document-budget',
      `The document exceeds the maximum supported length of ${MAX_SOURCE_LENGTH} characters.`,
      { start: 0, end: Math.min(source.length, 1) },
    );
    return { ok: false, diagnostics: sink.list };
  }

  let tree: any;
  try {
    tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ['yaml'])
      .use(remarkDirective)
      .parse(source);
  } catch (error) {
    sink.add(
      'markdown-parse',
      `Markdown could not be parsed: ${(error as Error).message}`,
      { start: 0, end: Math.min(source.length, 1) },
    );
    return { ok: false, diagnostics: sink.list };
  }

  const configBlocks: ConfigBlock[] = [];
  for (const child of tree.children ?? []) {
    findConfigBlocks(child, true, configBlocks);
  }

  let configNode: any = null;
  if (configBlocks.length > 0) {
    configNode = configBlocks[0].node;
    if (!configBlocks[0].rootLevel) {
      sink.add(
        'config-misplaced',
        'The reactive-md configuration block must be a root-level fenced code block.',
        mdastRange(configNode),
      );
    }
    for (let i = 1; i < configBlocks.length; i += 1) {
      sink.add(
        'config-duplicate',
        'A document may contain at most one reactive-md configuration block.',
        mdastRange(configBlocks[i].node),
      );
    }
    const configIndex = (tree.children ?? []).indexOf(configNode);
    for (let i = 0; i < configIndex; i += 1) {
      const preceding = tree.children[i];
      if (preceding.type !== 'yaml') {
        sink.add(
          'config-position',
          'The reactive-md configuration block must appear before the document body.',
          mdastRange(configNode),
        );
        break;
      }
    }
    if (!isFenceClosed(source, configNode)) {
      sink.add('config-unclosed', 'The reactive-md configuration fence is not closed.', mdastRange(configNode));
    }
  }

  // Report unclosed containers, which remark otherwise closes at end of file.
  const checkContainers = (node: any): void => {
    if (node.type === 'containerDirective' && !containerClosed(source, node)) {
      sink.add('container-unclosed', `Container directive "${node.name}" is not closed.`, mdastRange(node));
    }
    if (Array.isArray(node.children)) for (const child of node.children) checkContainers(child);
  };
  checkContainers(tree);

  let content: ConfigContent;
  if (configNode) {
    const nodeRange = mdastRange(configNode);
    const value = typeof configNode.value === 'string' ? configNode.value : '';
    const index = source.indexOf(value, nodeRange.start);
    const contentOffset = index >= 0 ? index : nodeRange.start;
    content = readConfig(value, contentOffset, source, sink);
  } else {
    content = {
      version: '',
      data: {},
      state: {},
      computed: {},
      actions: {},
      computedRanges: new Map(),
      actionRanges: new Map(),
    };
  }

  pendingDynamic = new Map();
  propRangeStore = new Map();

  const conversion: ConversionState = {
    sink,
    source,
    ids: new Map(),
    components: [],
    rootNodes: [],
    nodeCounter: 0,
    budgetReported: false,
  };

  const nodes: DocumentNode[] = [];
  for (const child of tree.children ?? []) {
    if (child.type === 'yaml') continue;
    if (child.type === 'code' && child.lang === 'reactive-md') continue;
    const converted = convertMdastNode(child, conversion, null);
    if (converted) nodes.push(converted);
  }

  conversion.rootNodes = nodes;

  const resourceFields: Record<string, ExprType> = {};
  for (const [actionName, steps] of Object.entries(content.actions)) {
    if (steps.some((step) => 'call' in step)) {
      resourceFields[actionName] = {
        kind: 'object',
        fields: {
          status: { kind: 'string' },
          data: { kind: 'any' },
          error: { kind: 'any' },
          requestId: { kind: 'number' },
        },
      };
    }
  }

  const env: TypeEnv = {
    values: {},
    data: jsonToExprType(content.data),
    resources: { kind: 'object', fields: resourceFields },
  };
  for (const [name, value] of Object.entries(content.state)) {
    env.values[name] = jsonToExprType(value);
  }

  const computedInfo = inferComputedTypes(content, env, sink);

  const aliases = new Set<string>();
  for (const node of nodes) collectEachAliases([node], aliases);
  const actionLocals: Record<string, ExprType> = {
    item: { kind: 'any' },
    index: { kind: 'number' },
    event: { kind: 'any' },
  };
  for (const alias of aliases) actionLocals[alias] = { kind: 'any' };
  const actionEnv: TypeEnv = { ...env, locals: actionLocals };

  const stepTargets = (step: ActionStep): string[] => {
    if ('set' in step) return [step.set];
    if ('reset' in step) return step.reset;
    if ('append' in step) return [step.append];
    if ('remove' in step) return [step.remove];
    if ('update' in step) return [step.update];
    return [];
  };

  // Validate action values.
  for (const [actionName, steps] of Object.entries(content.actions)) {
    if (steps.some((step) => 'call' in step) && steps.length !== 1) {
      sink.add(
        'action-call-mixed',
        `Action "${actionName}" is a host action: a single call step cannot be mixed with local steps.`,
        steps[0].range,
      );
    }
    const targets = new Set<string>();
    for (const step of steps) {
      for (const target of stepTargets(step)) {
        if (targets.has(target)) {
          sink.add(
            'action-duplicate-target',
            `Action "${actionName}" writes "${target}" more than once.`,
            step.range,
          );
        }
        targets.add(target);
        if (!Object.prototype.hasOwnProperty.call(content.state, target)) {
          sink.add(
            'action-target',
            `Action "${actionName}" cannot write "${target}": it is not a declared state value.`,
            step.range,
          );
          continue;
        }
        const kind = stateKindOf(content.state[target]);
        if (('append' in step || 'remove' in step || 'update' in step) && kind !== 'array') {
          sink.add(
            'action-target',
            `Action "${actionName}" cannot use collection operations on "${target}" because it is ${kind}, not array.`,
            step.range,
          );
        }
      }

      if ('set' in step) {
        if (!Object.prototype.hasOwnProperty.call(content.state, step.set)) continue;
        checkValueSource(
          step.value,
          expectedTypeForState(content.state[step.set]),
          step.range,
          actionEnv,
          sink,
          `Value of action "${actionName}"`,
        );
      } else if ('append' in step) {
        checkValueSource(step.value, null, step.range, actionEnv, sink, `Value of action "${actionName}"`);
      } else if ('remove' in step || 'update' in step) {
        checkValueSource(step.at, 'number', step.range, actionEnv, sink, `Index of action "${actionName}"`);
        if ('update' in step) {
          checkValueSource(step.value, null, step.range, actionEnv, sink, `Value of action "${actionName}"`);
        }
      } else if ('call' in step) {
        for (const [inputName, value] of Object.entries(step.input)) {
          checkValueSource(value, null, step.range, actionEnv, sink, `Input "${inputName}" of action "${actionName}"`);
        }
      }
    }
  }

  // Validate dynamic component props after computed types are known.
  validateComponents(conversion, env, content, sink);

  const bindings = collectBindingConstraints(conversion, content, sink);

  const document: CompiledDocument = {
    source,
    nodes,
    data: content.data,
    initialState: content.state,
    computed: content.computed,
    actions: content.actions,
    computedOrder: computedInfo.order,
    bindings,
    componentSchemas: snapshotComponentSchemas(),
  };

  const meta: DocumentMeta = {
    nodeById: indexNodes(nodes),
    computedRanges: content.computedRanges,
    propRanges: propRangeStore,
    actionRanges: content.actionRanges,
    rootRange: { start: 0, end: Math.min(source.length, 1) },
  };
  setDocumentMeta(document, meta);

  if (!sink.hasErrors) {
    const initialDiagnostics = validateDocumentState(document);
    sink.list.push(...initialDiagnostics);
  }

  if (sink.hasErrors) {
    return { ok: false, diagnostics: sink.list };
  }
  return { ok: true, document, diagnostics: sink.list };
}
