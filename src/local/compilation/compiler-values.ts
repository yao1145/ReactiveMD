import type { LocalNode, LocalValue, LocalValueKind } from '../types';
import type { AttrMap, Entry } from './compiler-structure';
import type { CompileState } from './compiler-services';
import {
  isKernelDate,
  kernelMaxItems,
  kernelNumericConstraints,
  kernelOnStep,
  kernelValueBinding,
  type KernelBindingSchema,
  type KernelNumericConstraints,
} from '../../contracts/component-kernel';
import { kernelValueRules } from '../configuration/kernel-value-rules';
import type { Group, GroupMember } from './compiler-bindings';
import { countLocalCodePoints } from '../source/source-context';
import { isLocalEmail, MAX_LOCAL_EMAIL_LENGTH } from '../../contracts/limits';
import { localValueBudgetIssue } from '../evaluation/expression/compile';

export { parseNumberLiteral as parseNumberText } from '../../contracts/number-literal';

function isWhitespaceNode(node: LocalNode): boolean {
  return (
    node.type === 'comment' ||
    (node.type === 'text' && !(node.value ?? '').trim()) ||
    (node.type === 'paragraph' && !node.children?.length && !(node.value ?? '').trim())
  );
}

export function meaningful(nodes: LocalNode[] | undefined): LocalNode[] {
  return (nodes ?? []).filter((node) => !isWhitespaceNode(node));
}

export function hasComponent(node: LocalNode): boolean {
  if (node.type === 'component') return true;
  return (node.children ?? []).some(hasComponent);
}

/** Static numeric attribute value, or the manifest prop default. */
export function numberValue(
  entry: Entry,
  attrs: AttrMap,
  name: string | undefined,
): number | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'number' ? info.value : undefined;
  const fallback = entry.kernel.props[name]?.default;
  return typeof fallback === 'number' ? fallback : undefined;
}

/** Static string attribute value, or the manifest prop default. */
export function staticAttributeString(
  entry: Entry,
  attrs: AttrMap,
  name: string | undefined,
): string | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'string' ? info.value : undefined;
  const fallback = entry.kernel.props[name]?.default;
  return typeof fallback === 'string' ? fallback : undefined;
}

export function plainText(node: LocalNode): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'fallback') return node.value ?? '';
  if (node.type === 'interpolation') return '\u0000';
  if (node.type === 'break') return ' ';
  return (node.children ?? []).map(plainText).join('');
}

export function hasInterpolation(node: LocalNode): boolean {
  if (node.type === 'interpolation') return true;
  return (node.children ?? []).some(hasInterpolation);
}

export function typeName(kind: LocalValueKind): string {
  switch (kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return 'array';
    case 'number-array':
      return 'number-array';
  }
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/*
 * Phase-one host parameter and SDK binding adapters were removed in phase two.
 * The already-validated option check lowers both inputs into the unified
 * registry above, so every component uses the same attribute, structure and
 * binding engine.
 */
export function singleFullInterpolation(value: string): boolean {
  if (!fullInterpolation(value)) return false;
  const scanned = scanInterpolations(value);
  return scanned.segments.length === 1 && scanned.unterminated.length === 0;
}

interface ScanSegment {
  expression: string;
  start: number;
  end: number;
}

/** Locate `{{ ... }}` segments inside a decoded attribute value. */
export function scanInterpolations(value: string): { segments: ScanSegment[]; unterminated: number[] } {
  const segments: ScanSegment[] = [];
  const unterminated: number[] = [];
  for (let i = 0; i < value.length; ) {
    if (value[i] === '\\' && value.startsWith('{{', i + 1)) {
      i += 3;
      continue;
    }
    if (!value.startsWith('{{', i)) {
      i++;
      continue;
    }
    let quote = '';
    let end = i + 2;
    for (; end < value.length - 1; end++) {
      const character = value[end];
      if (quote) {
        if (character === '\\') end++;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '}' && value[end + 1] === '}') break;
    }
    if (end >= value.length - 1) {
      unterminated.push(i);
      break;
    }
    const raw = value.slice(i + 2, end);
    const leading = raw.length - raw.trimStart().length;
    segments.push({ expression: raw.trim(), start: i + 2 + leading, end });
    i = end + 2;
  }
  return { segments, unterminated };
}

export function fullInterpolation(value: string): { expression: string; start: number } | null {
  const match = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(value);
  if (!match) return null;
  const raw = match[1];
  const leading = raw.length - raw.trimStart().length;
  const brace = value.indexOf('{{');
  return { expression: raw.trim(), start: brace + 2 + leading };
}

export function suggestName(name: string, candidates: string[]): string | undefined {
  if (name.length > MAX_LOCAL_NAME_LENGTH) return undefined;
  let best: string | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const current = editDistance(name, candidate);
    if (current < distance) {
      best = candidate;
      distance = current;
    }
  }
  return distance <= 2 ? best : undefined;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[b.length];
}

/** Environment used by ordinary expressions: writable parameters plus read-only computations and externals. */
export function expressionEnv(state: CompileState): Record<string, LocalValueKind> {
  return { ...state.bindingKinds, ...state.externalKinds, ...state.computationKinds };
}

/** Longer names are rejected before suggestion/edit-distance work. */
export const MAX_LOCAL_NAME_LENGTH = 128;

export function cloneValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? value.slice() : value;
}

/*
 * Phase one resolved host bindings in a second engine here. Phase two lowers
 * every input adapter into the same manifest registry, so `resolveBindings`
 * above is the only binding resolver.
 */
export type NumericConstraints = KernelNumericConstraints;

export function numericConstraints(entry: Entry, attrs: AttrMap): NumericConstraints {
  const binding = kernelValueBinding(entry.kernel);
  return binding ? kernelNumericConstraints(entry.kernel, binding, attrs) : { step: 1 };
}

/**
 * A shared string binding must satisfy every owner's runtime value rules.
 * Empty values stay allowed at compile time so an optional required input can
 * still start empty; writes are enforced by the runtime.
 */
export function validateStaticInitial(group: Group, initial: LocalValue, state: CompileState, initialOffset?: number): void {
  if (typeof initial !== 'string' || initial === '') return;
  const first = group.members[0];
  const initialAttribute = kernelValueBinding(first.entry.kernel)?.initial ?? 'initial';
  const offset = initialOffset ?? first.attrs[initialAttribute]?.offset ?? first.entry.node.range.start;
  const length = countLocalCodePoints(initial);
  for (const member of group.members) {
    const { entry, attrs } = member;
    for (const rule of kernelValueRules(entry.kernel)) {
      if (rule.kind === 'length') {
        const minLength = numberValue(entry, attrs, rule.min) ?? 0;
        const maxLength = numberValue(entry, attrs, rule.max);
        if (minLength > 0 && length < minLength) {
          state.report('local.initial.length', { key: 'local.initial.length.min', params: { key: group.key, length, min: minLength, name: entry.name } }, offset, undefined);
        }
        if (maxLength !== undefined && length > maxLength) {
          state.report('local.initial.length', { key: 'local.initial.length.max', params: { key: group.key, length, max: maxLength, name: entry.name } }, offset, undefined);
        }
      } else if (rule.kind === 'email') {
        const type = staticAttributeString(entry, attrs, rule.type) ?? 'text';
        if (type === rule.value) {
          if (initial.length > MAX_LOCAL_EMAIL_LENGTH || !isLocalEmail(initial)) {
            state.report('local.initial.email', { key: 'local.initial.email', params: { key: group.key } }, offset, undefined);
          }
        }
      } else if (rule.kind === 'date' && isKernelDate(initial)) {
        const min = staticAttributeString(entry, attrs, rule.min);
        const max = staticAttributeString(entry, attrs, rule.max);
        if (min && isKernelDate(min) && initial < min) {
          state.report('local.initial.range', { key: 'local.initial.date.min', params: { key: group.key, value: initial, min } }, offset, undefined);
        }
        if (max && isKernelDate(max) && initial > max) {
          state.report('local.initial.range', { key: 'local.initial.date.max', params: { key: group.key, value: initial, max } }, offset, undefined);
        }
      }
    }
  }
}

export function validateInitialValue(
  group: Group,
  first: GroupMember,
  value: LocalValue,
  binding: KernelBindingSchema,
  options: string[],
  constraints: NumericConstraints | undefined,
  state: CompileState,
): void {
  const key = group.key;
  const offset = first.attrs[binding.initial]?.offset ?? first.entry.node.range.start;
  if (binding.kind === 'array' || binding.kind === 'number-array') {
    if (!Array.isArray(value)) {
      state.report('local.initial.type', { key: 'local.initial.type.array', params: { key } }, offset, undefined);
      return;
    }
    const budget = localValueBudgetIssue(value);
    if (budget) {
      state.report('local.budget.array', { key: budget.key, params: { ...budget.params, key } }, offset, undefined);
      return;
    }
    if (binding.kind === 'number-array') {
      if (!value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        state.report('local.initial.type', { key: 'local.initial.type.number-array', params: { key } }, offset, undefined);
        return;
      }
    } else {
      if (!value.every((entry) => typeof entry === 'string')) {
        state.report('local.initial.type', { key: 'local.initial.type.array', params: { key } }, offset, undefined);
        return;
      }
      if (options.length) {
        for (const entry of value as string[]) {
          if (!options.includes(entry)) {
            state.report('local.initial.option', { key: 'local.initial.value.option', params: { value: entry, options: options.join(', ') } }, offset, undefined);
          }
        }
      }
    }
    const maxItems = kernelMaxItems(first.entry.kernel, binding, first.attrs);
    if (maxItems !== undefined && value.length > maxItems) {
      state.report('local.initial.range', { key: 'local.initial.value.max-items', params: { key, max: maxItems } }, offset, undefined);
    }
    return;
  }
  if (binding.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      state.report('local.initial.type', { key: 'local.initial.type.number', params: { key } }, first.entry.node.range.start, undefined);
      return;
    }
    const local = constraints ?? numericConstraints(first.entry, first.attrs);
    if (local.min !== undefined && value < local.min) {
      state.report('local.initial.range', { key: 'local.initial.range.min', params: { value, key, min: local.min } }, offset, undefined);
    }
    if (local.max !== undefined && value > local.max) {
      state.report('local.initial.range', { key: 'local.initial.range.max', params: { value, key, max: local.max } }, offset, undefined);
    }
    const base = local.min ?? 0;
    if (local.dynamicMin === undefined && value >= (local.min ?? Number.NEGATIVE_INFINITY) && value <= (local.max ?? Number.POSITIVE_INFINITY) && !kernelOnStep(value, base, local.step)) {
      state.report('local.initial.step', { key: 'local.initial.range.step', params: { value, key, step: local.step, base: local.min ?? 0 } }, offset, undefined);
    }
    return;
  }
  if (binding.kind === 'boolean' && typeof value !== 'boolean') {
    state.report('local.initial.type', { key: 'local.initial.type.boolean', params: { key } }, first.entry.node.range.start, undefined);
  }
  const selectionFamily = binding.family === 'choice' || binding.family === 'tabs'
    || binding.family === 'steps' || binding.family === 'diagram' || binding.family === 'selection';
  if (selectionFamily && options.length && !options.includes(String(value))) {
    state.report('local.initial.option', { key: 'local.initial.value.options', params: { value: String(value), key, options: options.join(', ') } }, offset, undefined);
  }
}
