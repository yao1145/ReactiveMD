import { projectionMap, validateChecklist, type AttrMap, type Entry } from './compiler-structure';
import {
  isKernelDate,
  kernelDefaultInitial,
  kernelDescribeConstraints,
  kernelMaxItems,
  kernelProjectionForFamily,
  kernelRule,
  kernelRules,
  kernelSameNumericBound,
  kernelValueBinding,
  type KernelBindingSchema,
  type NormalizedComponent,
} from '../configuration/component-kernel';
import { kernelValueRules } from '../configuration/kernel-value-rules';
import type { CompileState } from './compiler-services';
import type { LocalBinding, LocalValue, LocalValueKind } from '../types';
import {
  cloneValue,
  IDENTIFIER,
  MAX_LOCAL_NAME_LENGTH,
  numericConstraints,
  scanInterpolations,
  typeName,
  validateInitialValue,
  validateStaticInitial,
  type NumericConstraints,
} from './compiler-values';
import { RESERVED_NAMES } from '../evaluation/expression/compile';
import { plainCompiledData } from '../transport/compiled-data';
import { MAX_LOCAL_DIAGNOSTICS } from '../configuration/limits';
import type { LocalBindingFamily } from '../configuration/schema-core';

/** Keep conflict bursts readable while bounding diagnostic volume. */
const MAX_INITIAL_CONFLICT_DIAGNOSTICS = 4;

/** Show at most this many peer locations in one conflict message. */
const MAX_CONFLICT_PEERS = 3;

/** Bind names that cannot be used because they are literals or plot variables. */
export const EXTRA_RESERVED = new Set(['x', 'y', 'true', 'false', 'null', 'pi', 'e']);

export interface GroupMember {
  entry: Entry;
  attrs: AttrMap;
}

export interface Group {
  key: string;
  binding: KernelBindingSchema;
  members: GroupMember[];
}

export function requireBindingAttribute(entry: Entry, binding: KernelBindingSchema, attrs: AttrMap, state: CompileState): void {
  if (!binding.required || Object.hasOwn(attrs, binding.bind)) return;
  state.report('local.attribute.required', { key: 'local.attribute.required', params: { component: entry.name, name: binding.bind } }, entry.node.range.start, entry.node.range.end);
}

export function resolveBindings(state: CompileState): Record<string, LocalBinding> {
  const groups = new Map<string, Group>();
  for (const entry of state.entries) {
    const binding = kernelValueBinding(entry.kernel);
    if (!binding) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    // Activation attributes make the binding conditional (table/chart `key`).
    if (binding.requiresAttributes?.some((attribute) => !Object.hasOwn(attrs, attribute))) continue;
    requireBindingAttribute(entry, binding, attrs, state);
    const rawBind = typeof attrs[binding.bind]?.value === 'string' ? String(attrs[binding.bind].value) : '';
    let key = rawBind ? rawBind : `@${entry.node.id}`;
    if (Object.hasOwn(attrs, binding.bind)) {
      const offset = attrs[binding.bind].offset ?? entry.node.range.start;
      if (rawBind.length > MAX_LOCAL_NAME_LENGTH) {
        state.report('local.budget.identifier', { key: 'local.budget.identifier', params: { limit: MAX_LOCAL_NAME_LENGTH } }, offset, undefined);
        key = `@${entry.node.id}`;
      } else if (!IDENTIFIER.test(rawBind)) {
        state.report('local.binding.name', { key: 'local.binding.name', params: { name: rawBind } }, offset, undefined);
        key = `@${entry.node.id}`;
      } else if (RESERVED_NAMES.has(rawBind) || EXTRA_RESERVED.has(rawBind)) {
        state.report('local.binding.reserved', { key: 'local.binding.reserved', params: { name: rawBind } }, offset, undefined);
        key = `@${entry.node.id}`;
      }
    }
    const existing = groups.get(key);
    if (existing) existing.members.push({ entry, attrs });
    else groups.set(key, { key, binding, members: [{ entry, attrs }] });
  }

  const bindings: Record<string, LocalBinding> = {};
  for (const group of groups.values()) {
    const family = group.binding.family;
    // Checklist defaults populate a separate validation index and must keep
    // their original side effects. Other groups depend on their own members,
    // constraints and already-resolved option sets, not unrelated bindings.
    const cacheKey = state.semantic && family !== 'checklist'
      ? JSON.stringify([group.key, group.members.map(({ entry }) => [
          entry.name,
          entry.node.id,
          entry.node.attrs,
          bindingOptions(entry, state, entry.kernel, family),
        ])])
      : undefined;
    const cached = cacheKey ? state.semantic!.binding<LocalBinding>(cacheKey) : undefined;
    const count = state.diagnostics.length;
    const binding = cached ? plainCompiledData(cached) : resolveGroup(group, state);
    if (!cached && binding && cacheKey && count < MAX_LOCAL_DIAGNOSTICS && state.diagnostics.length === count) {
      state.semantic!.rememberBinding(cacheKey, plainCompiledData(binding));
    }
    if (binding) bindings[group.key] = binding;
  }
  return bindings;
}

export function bindingKinds(bindings: Record<string, LocalBinding>): Record<string, LocalValueKind> {
  const kinds: Record<string, LocalValueKind> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    if (!key.startsWith('@')) kinds[key] = binding.type;
  }
  return kinds;
}

const sameNumericBound = kernelSameNumericBound;

const describeConstraints = kernelDescribeConstraints;

function comparedAttribute(member: GroupMember, name: string): string | undefined {
  const info = member.attrs[name];
  if (!info) return undefined;
  if (info.dynamic) return `{{ ${(info.expression ?? '').trim()} }}`;
  return typeof info.value === 'string' ? info.value : String(info.value ?? '');
}

function resolveGroup(group: Group, state: CompileState): LocalBinding | null {
  const first = group.members[0];
  const bindingSchema = group.binding;
  const family = bindingSchema.family;

  for (const member of group.members.slice(1)) {
    const memberBinding = kernelValueBinding(member.entry.kernel);
    if (!memberBinding || memberBinding.family !== family || memberBinding.kind !== bindingSchema.kind) {
      state.report('local.binding.type', { key: 'local.binding.type', params: { key: group.key, kind: typeName(bindingSchema.kind), first: first.entry.name, second: member.entry.name } }, member.entry.node.range.start, member.entry.node.range.end);
    }
  }

  const exclusiveOwner = group.members.find((member) => kernelValueBinding(member.entry.kernel)?.exclusive === true);
  if (exclusiveOwner && group.members.length > 1) {
    for (const member of group.members) {
      if (member === exclusiveOwner) continue;
      state.report('local.binding.exclusive', { key: 'local.binding.exclusive', params: { key: group.key, first: exclusiveOwner.entry.name, second: member.entry.name } }, member.entry.node.range.start, member.entry.node.range.end);
    }
  }

  const options = bindingOptions(first.entry, state, first.entry.kernel, family);
  let constraints: NumericConstraints | undefined;
  if (bindingSchema.kind === 'number') {
    constraints = numericConstraints(first.entry, first.attrs);
    for (const member of group.members.slice(1)) {
      const other = numericConstraints(member.entry, member.attrs);
      if (
        !sameNumericBound(other, constraints, 'min')
        || !sameNumericBound(other, constraints, 'max')
        || other.step !== constraints.step
      ) {
        state.report('local.binding.constraint', {
            key: 'local.binding.constraint',
            params: {
              key: group.key,
              first: first.entry.name,
              second: member.entry.name,
              firstConstraints: describeConstraints(constraints),
              secondConstraints: describeConstraints(other),
            },
          }, member.entry.node.range.start, member.entry.node.range.end);
      }
    }
  }

  if (family === 'choice' || family === 'selection') {
    for (const member of group.members.slice(1)) {
      const other = bindingOptions(member.entry, state, member.entry.kernel, family);
      if (other.join('\u0000') !== options.join('\u0000')) {
        state.report('local.binding.option', { key: 'local.binding.option', params: { key: group.key } }, member.entry.node.range.start, member.entry.node.range.end);
      }
    }
  }

  // Attributes declared comparable (date bounds) participate in shared writes.
  const compare = new Set(bindingSchema.compare ?? []);
  for (const rule of kernelRules(first.entry.kernel)) {
    if (rule.kind !== 'date-bounds') continue;
    if (rule.min) compare.add(rule.min);
    if (rule.max) compare.add(rule.max);
  }
  for (const name of compare) {
    const expected = comparedAttribute(first, name);
    for (const member of group.members.slice(1)) {
      if (comparedAttribute(member, name) !== expected) {
        state.report('local.binding.constraint', { key: 'local.binding.constraint', params: { key: group.key, first: first.entry.name, second: member.entry.name, firstConstraints: `${name} bounds`, secondConstraints: `${name} bounds` } }, member.entry.node.range.start, member.entry.node.range.end);
      }
    }
  }

  const maxItems = bindingSchema.maxItems
    ? kernelMaxItems(first.entry.kernel, bindingSchema, first.attrs)
    : undefined;
  const explicit = group.members.filter((member) => Object.hasOwn(member.attrs, bindingSchema.initial));
  let initial: LocalValue;
  if (explicit.length > 1) {
    // Precompute lines once; report only a bounded sample of the conflicts.
    const conflictLines = explicit.map((member) => lineAt(state, member.attrs[bindingSchema.initial].offset));
    const reported = Math.min(explicit.length, MAX_INITIAL_CONFLICT_DIAGNOSTICS);
    for (let index = 0; index < reported; index += 1) {
      const peers: number[] = [];
      for (let step = 1; step < conflictLines.length && peers.length < MAX_CONFLICT_PEERS; step += 1) {
        peers.push(conflictLines[(index + step) % conflictLines.length]);
      }
      state.report('local.initial.duplicate', peers.length
          ? { key: 'local.initial.duplicate-peers', params: { key: group.key, count: explicit.length, lines: peers.join(', ') } }
          : { key: 'local.initial.duplicate', params: { key: group.key, count: explicit.length } }, explicit[index].attrs[bindingSchema.initial].offset, undefined);
    }
  }
  if (family === 'multi-select') {
    initial = explicit.length
      ? multiSelectInitial(explicit[0], options, maxItems, state, bindingSchema)
      : [];
  } else if (family === 'collection') {
    initial = explicit.length
      ? collectionInitial(explicit[0], state, bindingSchema)
      : [];
  } else if (explicit.length > 0) {
    initial = memberInitial(explicit[0], state, bindingSchema, options);
  } else {
    initial = defaultInitial(first, state, bindingSchema, options, constraints);
  }

  if (family === 'checklist' && !Array.isArray(initial)) initial = [];
  validateInitialValue(group, first, initial, bindingSchema, options, constraints, state);
  validateStaticInitial(group, initial, state);

  const binding: LocalBinding = {
    family: bindingSchema.family as LocalBindingFamily,
    name: group.key,
    nodeIds: group.members.map((member) => member.entry.node.id),
    type: bindingSchema.kind,
    initial: cloneValue(initial),
    owner: first.entry.node.id,
  };
  if (constraints) {
    if (constraints.min !== undefined) binding.min = constraints.min;
    if (constraints.max !== undefined) binding.max = constraints.max;
    binding.step = constraints.step;
  }
  if (options.length) binding.options = [...options];
  if (family === 'multi-select') binding.maxItems = maxItems ?? options.length;
  else if (maxItems !== undefined) binding.maxItems = maxItems;
  return binding;
}

export function lineAt(state: CompileState, offset: number): number {
  const target = Math.max(0, Math.min(state.source.length, offset));
  let low = 0;
  let high = state.lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (state.lineStarts[middle] <= target) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function bindingOptions(
  entry: Entry,
  state: CompileState,
  kernel: NormalizedComponent,
  family: string,
): string[] {
  const kind = kernelProjectionForFamily(family);
  if (!kind) return [];
  if (kind === 'checklist') {
    const limit = kernelRule(kernel, 'checklist-body')?.itemLimit;
    return validateChecklist(entry, state, limit).ids;
  }
  if (kind === 'selection') return state.selections.get(entry.node.id) ?? [''];
  const projected = projectionMap(state, kind).get(entry.node.id);
  if (projected !== undefined) return projected;
  // Host/static choice bindings carry their options on the binding itself.
  return [...(kernelValueBinding(kernel)?.options ?? [])];
}

/** Parse a JSON array literal for a `collection` family binding. */
function collectionInitial(
  member: GroupMember,
  state: CompileState,
  binding: KernelBindingSchema,
): LocalValue {
  const info = member.attrs[binding.initial];
  if (!info) return [];
  const raw = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    state.report('local.initial.type', { key: 'local.initial.type.collection', params: { key: member.entry.node.id } }, info.offset, undefined);
    return [];
  }
  if (!Array.isArray(parsed)) {
    state.report('local.initial.type', { key: 'local.initial.type.collection', params: { key: member.entry.node.id } }, info.offset, undefined);
    return [];
  }
  if (binding.kind === 'number-array') {
    if (!parsed.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
      state.report('local.initial.type', { key: 'local.initial.type.number-array', params: { key: member.entry.node.id } }, info.offset, undefined);
      return [];
    }
    return parsed as number[];
  }
  if (!parsed.every((entry) => typeof entry === 'string')) {
    state.report('local.initial.type', { key: 'local.initial.type.array', params: { key: member.entry.node.id } }, info.offset, undefined);
    return [];
  }
  return parsed as string[];
}

/** Parse the comma-separated `initial` of a multi-select binding into an array. */
function multiSelectInitial(
  member: GroupMember,
  options: string[],
  maxSelected: number | undefined,
  state: CompileState,
  binding: KernelBindingSchema,
): string[] {
  const info = member.attrs[binding.initial];
  if (!info) return [];
  const raw = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  const chosen: string[] = [];
  for (const part of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!options.includes(part)) {
      state.report('local.initial.option', { key: 'local.initial.option.multi-select', params: { key: member.entry.node.id, value: part } }, info.offset, undefined);
      continue;
    }
    if (!chosen.includes(part)) chosen.push(part);
  }
  if (maxSelected !== undefined && chosen.length > maxSelected) {
    state.report('local.initial.range', { key: 'local.initial.multi-select', params: { max: maxSelected } }, info.offset, undefined);
  }
  return options.filter((value) => chosen.includes(value));
}

function memberInitial(
  member: GroupMember,
  state: CompileState,
  binding: KernelBindingSchema,
  options: string[],
): LocalValue {
  const info = member.attrs[binding.initial];
  const entry = member.entry;
  const constraints = numericConstraints(entry, member.attrs);
  if (!info) return defaultInitial(member, state, binding, options, undefined);
  if (binding.kind === 'null') {
    if (info.raw.trim() !== 'null') state.report('local.initial.type', { key: 'local.initial.type', params: { name: entry.node.id } }, info.offset, undefined);
    return null;
  }
  if (entry.legacy) {
    const scanned = scanInterpolations(info.raw);
    if (scanned.segments.length || scanned.unterminated.length) {
      state.report('local.host.attribute', { key: 'local.host.attribute.static', params: { name: binding.initial } }, info.offset, info.offset + info.raw.length);
      const derived = kernelDefaultInitial(binding.initialRule, constraints, options);
      return 'value' in derived ? derived.value : '';
    }
  }
  if (binding.kind === 'number') {
    if (typeof info.value === 'number') return info.value;
    state.report('local.initial.type', { key: 'local.initial.type', params: { name: entry.node.id } }, info.offset, undefined);
    return 0;
  }
  if (binding.kind === 'boolean') {
    if (typeof info.value === 'boolean') return info.value;
    state.report('local.initial.type', { key: 'local.initial.type', params: { name: entry.node.id } }, info.offset, undefined);
    return false;
  }
  const value = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  if (kernelValueRules(entry.kernel).some((rule) => rule.kind === 'date') && !isKernelDate(value)) {
    state.report('local.initial.date', { key: 'local.initial.date', params: { value } }, info.offset, undefined);
  }
  if (options.length && !options.includes(value) && binding.family !== 'text' && binding.family !== 'date') {
    state.report('local.initial.option', { key: 'local.initial.value.option', params: { value, options: options.join(', ') } }, info.offset, undefined);
  }
  return value;
}

function defaultInitial(
  member: GroupMember,
  state: CompileState,
  binding: KernelBindingSchema,
  options: string[],
  constraints: NumericConstraints | undefined,
): LocalValue {
  const entry = member.entry;
  if (binding.kind === 'null') return null;
  if (binding.family === 'checklist') {
    return [...validateChecklist(entry, state, kernelRule(entry.kernel, 'checklist-body')?.itemLimit).checked];
  }
  const local = constraints ?? numericConstraints(entry, member.attrs);
  const derived = kernelDefaultInitial(binding.initialRule, local, options);
  if ('value' in derived && derived.value !== undefined) return derived.value;
  if ('error' in derived && derived.error === 'no-step') {
    state.report('local.initial.range', { key: 'local.initial.no-step', params: { key: entry.node.id, min: local.min ?? '-∞', max: local.max ?? '∞' } }, entry.node.range.start, entry.node.range.end);
    return 0;
  }
  state.report('local.initial', { key: 'local.initial.cannot-derive', params: { name: entry.name, key: entry.node.id } }, entry.node.range.start, entry.node.range.end);
  return '';
}
