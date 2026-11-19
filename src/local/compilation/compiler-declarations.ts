import type { CompileState } from './compiler-services';
import type { LocalBinding, LocalDynamicConstraints, LocalNode, LocalValue, LocalValueKind } from '../types';
import {
  kernelDefaultInitial,
  kernelNumericConstraints,
  kernelOnStep,
  kernelRulesOf,
  kernelSlotBindings,
  kernelSlotRelations,
  kernelValueBinding,
  type KernelBindingSchema,
} from './component-kernel';
import { EXTRA_RESERVED, lineAt, requireBindingAttribute } from './compiler-bindings';
import {
  fullInterpolation,
  IDENTIFIER,
  MAX_LOCAL_NAME_LENGTH,
  type NumericConstraints,
} from './compiler-values';
import { RESERVED_NAMES } from '../evaluation/expression';
import type { AttrMap, AttrState, Entry } from './compiler-structure';
import { openingTag } from './compiler-attributes';
import { resolveComputationGraph, type ComputationInput } from '../evaluation/computations';

/**
 * Resolve the independent, exclusive slot bindings of `<range-slider>` and
 * `<coordinate>`. Each slot registers its own binding key, so `setMany` can
 * update the slots atomically while `bindingSlots` tells the renderer which
 * slot maps to which public parameter.
 */
export function resolveSlotBindings(state: CompileState, bindings: Record<string, LocalBinding>): void {
  const used = new Set(Object.keys(bindings));
  const primaryByNode = new Map<string, string>();
  for (const [key, binding] of Object.entries(bindings)) {
    for (const nodeId of binding.nodeIds) primaryByNode.set(nodeId, key);
  }
  for (const entry of state.entries) {
    const slots = kernelSlotBindings(entry.kernel);
    if (!slots.length) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const map: Record<string, string> = Object.create(null);
    const keys = new Map<string, string>();
    // Mixed contracts retain the primary value in the same transaction map.
    const valueBinding = kernelValueBinding(entry.kernel);
    if (valueBinding && !valueBinding.requiresAttributes?.some(attribute => !Object.hasOwn(attrs, attribute))) {
      const scalar = primaryByNode.get(entry.node.id);
      if (scalar) {
        map.value = scalar;
        keys.set('value', scalar);
      }
    }
    for (const slot of slots) {
      if (slot.requiresAttributes?.some(attribute => !Object.hasOwn(attrs, attribute))) continue;
      requireBindingAttribute(entry, slot, attrs, state);
      const bindInfo = attrs[slot.bind];
      let publicKey: string | undefined;
      if (bindInfo) {
        const raw = typeof bindInfo.value === 'string' ? bindInfo.value : '';
        if (raw.length > MAX_LOCAL_NAME_LENGTH) {
          state.report('local.budget.identifier', { key: 'local.budget.identifier', params: { limit: MAX_LOCAL_NAME_LENGTH } }, bindInfo.offset ?? entry.node.range.start, undefined);
        } else if (!IDENTIFIER.test(raw)) {
          state.report('local.binding.name', { key: 'local.binding.name', params: { name: raw } }, bindInfo.offset ?? entry.node.range.start, undefined);
        } else if (RESERVED_NAMES.has(raw) || EXTRA_RESERVED.has(raw)) {
          state.report('local.binding.reserved', { key: 'local.binding.reserved', params: { name: raw } }, bindInfo.offset ?? entry.node.range.start, undefined);
        } else {
          publicKey = raw;
        }
      }
      let key = publicKey ?? `@${entry.node.id}:${slot.slot}`;
      if (publicKey && used.has(publicKey)) {
        state.report('local.binding.exclusive', { key: 'local.binding.exclusive.slot', params: { key: publicKey, slot: slot.slot, name: entry.name } }, bindInfo?.offset ?? entry.node.range.start, undefined);
        key = `@${entry.node.id}:${slot.slot}`;
      }
      used.add(key);
      const constraints = kernelNumericConstraints(entry.kernel, slot, attrs);
      const initial = slotInitial(entry, attrs, slot, constraints, state);
      const binding: LocalBinding = {
        name: key,
        nodeIds: [entry.node.id],
        type: slot.kind,
        initial,
        owner: entry.node.id,
      };
      if (constraints.min !== undefined) binding.min = constraints.min;
      if (constraints.max !== undefined) binding.max = constraints.max;
      binding.step = constraints.step;
      bindings[key] = binding;
      map[slot.slot] = key;
      keys.set(slot.slot, key);
    }
    for (const relation of kernelSlotRelations(entry.kernel)) {
      const lowerKey = keys.get(relation.lower);
      const upperKey = keys.get(relation.upper);
      if (!lowerKey || !upperKey) continue;
      const lower = bindings[lowerKey].initial;
      const upper = bindings[upperKey].initial;
      if (typeof lower === 'number' && typeof upper === 'number' && lower > upper) {
        state.report('local.initial.range', { key: 'local.initial.range-slider', params: { start: lower, end: upper } }, entry.node.range.start, entry.node.range.end);
      }
    }
    if (Object.keys(map).length) state.bindingSlots[entry.node.id] = map;
  }
}

function slotInitial(
  entry: Entry,
  attrs: AttrMap,
  slot: KernelBindingSchema,
  constraints: NumericConstraints,
  state: CompileState,
): LocalValue {
  const base = constraints.min ?? 0;
  const info = attrs[slot.initial];
  if (info && typeof info.value === 'number') {
    const value = info.value;
    if (constraints.min !== undefined && value < constraints.min) {
      state.report('local.initial.range', { key: 'local.initial.slot.min', params: { value, name: entry.name, slot: slot.initial, min: constraints.min } }, info.offset, undefined);
    }
    if (constraints.max !== undefined && value > constraints.max) {
      state.report('local.initial.range', { key: 'local.initial.slot.max', params: { value, name: entry.name, slot: slot.initial, max: constraints.max } }, info.offset, undefined);
    }
    if (!kernelOnStep(value, base, constraints.step)) {
      state.report('local.initial.step', { key: 'local.initial.slot.step', params: { value, name: entry.name, slot: slot.initial, step: constraints.step, base } }, info.offset, undefined);
    }
    return value;
  }
  const derived = kernelDefaultInitial(slot.initialRule, constraints, []);
  return 'value' in derived && derived.value !== undefined ? derived.value : 0;
}

export function slotMap(state: CompileState): Record<string, Record<string, string>> | undefined {
  return Object.keys(state.bindingSlots).length ? state.bindingSlots : undefined;
}

/** A declaration must be its own top-level source line. */
function standaloneDeclaration(state: CompileState, node: LocalNode): boolean {
  const lineStart = state.lineStarts[lineAt(state,node.range.start)-1];
  const next = state.lineStarts[lineAt(state,node.range.end)];
  const lineEnd = next === undefined ? state.source.length : next-1;
  return (
    state.source.slice(lineStart, node.range.start).trim() === ''
    && state.source.slice(node.range.end, lineEnd).trim() === ''
  );
}

/** Absolute offset of the expression inside the declaration's value attribute. */
function declarationExpressionOffset(state: CompileState, entry: Entry, expressionStart: number): number {
  const text = openingTag(state.source, entry.node.range.start, entry.node.range.end);
  const match = /(?:^|[\s"'/])value\s*=\s*(["'])/.exec(text);
  if (!match) return entry.node.range.start;
  const valueStart = entry.node.range.start + match.index + match[0].length;
  return Math.min(entry.node.range.end, valueStart + expressionStart);
}

/**
 * Resolve top-level `<computed>` and `<const>` declarations into document
 * metadata. Namespace checks happen here because both controls and slot
 * bindings are already resolved; the graph walk and type inference live in
 * `computations.ts`.
 */
export function resolveComputations(state: CompileState): void {
  const inputs: ComputationInput[] = [];
  const declared = new Map<string, 'computed' | 'const'>();
  const roots = new Set(state.nodes);
  for (const entry of state.entries) {
    if (entry.name !== 'computed' && entry.name !== 'const') continue;
    const kind: 'computed' | 'const' = entry.name;
    const node = entry.node;
    if (!roots.has(node) || !standaloneDeclaration(state, node)) {
      state.report(
        'local.computation.placement',
        `<${kind}> declarations must be standalone tags at the document top level.`,
        node.range.start,
        node.range.end,
      );
      continue;
    }
    const attrs = state.attrs.get(node.id) ?? {};
    const nameInfo = attrs.name;
    const rawName = typeof nameInfo?.value === 'string' ? nameInfo.value : '';
    if (!nameInfo || !rawName) continue;
    if (rawName.length > MAX_LOCAL_NAME_LENGTH) {
      state.report(
        'local.budget.identifier',
        `Computation name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`,
        nameInfo.offset,
      );
      continue;
    }
    if (!IDENTIFIER.test(rawName)) {
      state.report(
        'local.computation.name',
        `Computation name "${rawName}" must match [A-Za-z_][A-Za-z0-9_]*.`,
        nameInfo.offset,
      );
      continue;
    }
    if (RESERVED_NAMES.has(rawName) || EXTRA_RESERVED.has(rawName)) {
      state.report(
        'local.computation.reserved',
        `Computation name "${rawName}" is reserved; choose another name.`,
        nameInfo.offset,
      );
      continue;
    }
    if (Object.hasOwn(state.bindingKinds, rawName)) {
      state.report(
        'local.computation.duplicate',
        `Computation name "${rawName}" conflicts with a control parameter of the same name.`,
        nameInfo.offset,
      );
      continue;
    }
    if (Object.hasOwn(state.externalKinds, rawName)) {
      state.report(
        'local.computation.duplicate',
        `Computation name "${rawName}" conflicts with an external declaration of the same name.`,
        nameInfo.offset,
      );
      continue;
    }
    if (declared.has(rawName)) {
      state.report(
        'local.computation.duplicate',
        `Computation name "${rawName}" is declared more than once.`,
        nameInfo.offset,
      );
      continue;
    }
    declared.set(rawName, kind);

    const valueInfo = attrs.value;
    if (!valueInfo) continue;
    const full = fullInterpolation(valueInfo.raw);
    if (!full) {
      state.report(
        'local.computation.value',
        `The value of <${kind}> must be exactly one {{ expression }} interpolation.`,
        valueInfo.offset,
        valueInfo.offset + valueInfo.raw.length,
      );
      continue;
    }
    if (!full.expression) {
      state.report('local.expression.empty', 'Interpolation expression cannot be empty.', valueInfo.offset);
      continue;
    }
    inputs.push({
      name: rawName,
      kind,
      source: full.expression,
      expressionOffset: declarationExpressionOffset(state, entry, full.start),
      nodeId: node.id,
      range: { ...node.range },
    });
  }

  const resolved = resolveComputationGraph(
    inputs,
    { ...state.bindingKinds, ...state.externalKinds },
    state.report,
    new Set(Object.keys(state.externalKinds)),
    state.semantic,
  );
  state.computations = resolved.computations;
  state.computationKinds = resolved.kinds;
}

/** Declaration tags never reach the published tree; they are metadata only. */
export function stripDeclarationNodes(nodes: LocalNode[]): LocalNode[] {
  const kept: LocalNode[] = [];
  const pending=[{nodes,kept,index:0}];
  while(pending.length){
    const frame=pending[pending.length-1];
    if(frame.index===frame.nodes.length){pending.pop();continue;}
    const node=frame.nodes[frame.index++];
    if (node.type === 'component' && (node.name === 'computed' || node.name === 'const' || node.name === 'external')) continue;
    frame.kept.push(node);
    if(node.children){
      const children=node.children;node.children=[];
      pending.push({nodes:children,kept:node.children,index:0});
    }
  }
  return kept;
}

/** Author-facing type names for `<external type="...">`. */
const EXTERNAL_TYPES: Readonly<Record<string, LocalValueKind>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  'string-array': 'array',
  'number-array': 'number-array',
};

/**
 * Resolve top-level `<external>` declarations into read-only document metadata.
 * Names share the expression namespace with controls and computations but are
 * never writable: they do not enter `bindings`, public parameters or state
 * files.
 */
export function resolveExternals(state: CompileState): void {
  const roots = new Set(state.nodes);
  for (const entry of state.entries) {
    if (entry.name !== 'external') continue;
    const node = entry.node;
    if (!roots.has(node) || !standaloneDeclaration(state, node)) {
      state.report('local.external.placement', { key: 'local.external.placement' }, node.range.start, node.range.end);
      continue;
    }
    const attrs = state.attrs.get(node.id) ?? {};
    const nameInfo = attrs.name;
    const rawName = typeof nameInfo?.value === 'string' ? nameInfo.value : '';
    if (!nameInfo || !rawName) continue;
    if (rawName.length > MAX_LOCAL_NAME_LENGTH) {
      state.report('local.budget.identifier', { key: 'local.budget.identifier', params: { limit: MAX_LOCAL_NAME_LENGTH } }, nameInfo.offset, undefined);
      continue;
    }
    if (!IDENTIFIER.test(rawName)) {
      state.report('local.external.name', { key: 'local.external.name', params: { name: rawName } }, nameInfo.offset, undefined);
      continue;
    }
    if (RESERVED_NAMES.has(rawName) || EXTRA_RESERVED.has(rawName)) {
      state.report('local.external.reserved', { key: 'local.external.reserved', params: { name: rawName } }, nameInfo.offset, undefined);
      continue;
    }
    if (Object.hasOwn(state.bindingKinds, rawName)) {
      state.report('local.external.duplicate', { key: 'local.external.conflict', params: { name: rawName } }, nameInfo.offset, undefined);
      continue;
    }
    if (Object.hasOwn(state.externals, rawName)) {
      state.report('local.external.duplicate', { key: 'local.external.duplicate', params: { name: rawName } }, nameInfo.offset, undefined);
      continue;
    }
    const typeInfo = attrs.type;
    const rawType = typeof typeInfo?.value === 'string' ? typeInfo.value : '';
    const kind = EXTERNAL_TYPES[rawType];
    if (!kind) {
      state.report('local.external.type', { key: 'local.external.type', params: { name: rawName } }, typeInfo?.offset ?? node.range.start, undefined);
      continue;
    }
    state.externals[rawName] = {
      name: rawName,
      type: kind,
      nodeId: node.id,
      range: { ...node.range },
    };
    state.externalKinds[rawName] = kind;
  }
}

/**
 * Record dynamic `min`, `max` and `required` expressions for the runtime. Any
 * attribute named by a manifest `dynamic-constraints` rule or by a numeric
 * binding constraint prop is eligible; tag names play no part.
 */
export function collectDynamicConstraints(state: CompileState): void {
  for (const entry of state.entries) {
    const attrs = state.attrs.get(entry.node.id) ?? {};
    let collected: LocalDynamicConstraints | undefined;
    const record = (
      attribute: 'min' | 'max' | 'required',
      info: AttrState,
      numeric?: { min?: number; max?: number; integer?: boolean },
    ): void => {
      if (!info.dynamic || info.expression === undefined) return;
      collected ??= {};
      collected[attribute] = {
        source: info.expression,
        offset: info.expressionOffset ?? info.offset,
        ...(numeric ? { numeric } : {}),
      };
    };
    for (const rule of kernelRulesOf(entry.kernel, 'dynamic-constraints')) {
      for (const name of rule.attributes) {
        if (name === 'min' || name === 'max' || name === 'required') {
          const info = attrs[name];
          if (info) record(name, info);
        }
      }
    }
    const scalar = kernelValueBinding(entry.kernel);
    if (scalar?.kind === 'number' && scalar.constraints) {
      for (const attribute of ['min', 'max'] as const) {
        const constraint = scalar.constraints[attribute];
        if (!constraint || !('prop' in constraint)) continue;
        const info = attrs[constraint.prop];
        if (!info) continue;
        const prop = entry.kernel.props[constraint.prop];
        record(attribute, info, prop ? {
          ...(prop.min === undefined ? {} : { min: prop.min }),
          ...(prop.max === undefined ? {} : { max: prop.max }),
          ...(prop.integer === true ? { integer: true } : {}),
        } : undefined);
      }
    }
    if (collected) state.dynamicConstraints[entry.node.id] = collected;
  }
}
