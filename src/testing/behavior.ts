import { compileLocal } from '../local/compiler';
import { createLocalRuntime } from '../local/runtime';
import type { LocalNode, LocalRuntime, LocalValue } from '../local/types';
import { readLocalConfig } from '../sdk/config';
import { getLocalComponentRegistry } from '../sdk/registry';
import type { LocalComponentDefinition, LocalConfig } from '../sdk/types';
import { failed, passed, skipped } from './cases';
import {
  LOCAL_BEHAVIOR_SPEC_PROTOCOL,
  LOCAL_COMPLIANCE_PROTOCOL,
  MAX_LOCAL_COMPLIANCE_STRING_LENGTH,
  MAX_LOCAL_COMPLIANCE_SOURCE_LENGTH,
  MAX_LOCAL_COMPLIANCE_WRITES,
  MAX_LOCAL_COMPLIANCE_SLOTS,
  type LocalBehaviorSpec,
  type LocalBehaviorWriteSpec,
  type LocalComplianceCaseResult,
  type LocalComplianceSuiteResult,
  type LocalComplianceValue,
} from './types';
import {
  checkKeys,
  readBoolean,
  readCaseId,
  readComplianceValue,
  readComplianceValueRecord,
  readErrorMessage,
  readString,
  requireRecord,
  sameComplianceRecord,
  sameComplianceValue,
} from './values';

const SPEC_KEYS = new Set([
  'protocol', 'component', 'source', 'binding', 'writes', 'reset',
]);
const WRITE_KEYS = new Set(['id', 'slot', 'value', 'values', 'accepted', 'expect']);
const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PUBLIC_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function readWrite(value: unknown, index: number, seen: Set<string>): LocalBehaviorWriteSpec {
  const path = `spec.writes[${index}]`;
  const record = requireRecord(value, path);
  checkKeys(record, WRITE_KEYS, path);
  const id = readCaseId(record.id, `${path}.id`, seen, `write.${index}`);
  const accepted = readBoolean(record.accepted, `${path}.accepted`);
  const hasValue = record.value !== undefined;
  const hasValues = record.values !== undefined;
  if (hasValue === hasValues) {
    throw new TypeError(`${path} must declare exactly one of "value" or "values".`);
  }
  let slot: string | undefined;
  if (record.slot !== undefined) {
    if (hasValues) throw new TypeError(`${path}.slot cannot be combined with "values".`);
    slot = readString(record.slot, `${path}.slot`, 128);
    if (!PUBLIC_NAME.test(slot)) throw new TypeError(`${path}.slot is not a declared slot name.`);
  }
  const parsedValue = hasValue ? readComplianceValue(record.value, `${path}.value`) : undefined;
  const parsedValues = hasValues
    ? readComplianceValueRecord(record.values, `${path}.values`, MAX_LOCAL_COMPLIANCE_SLOTS)
    : undefined;
  const expect = record.expect === undefined
    ? undefined
    : readComplianceValueRecord(record.expect, `${path}.expect`, MAX_LOCAL_COMPLIANCE_SLOTS);
  return Object.freeze({
    id,
    accepted,
    ...(slot === undefined ? {} : { slot }),
    ...(parsedValue === undefined ? {} : { value: parsedValue }),
    ...(parsedValues === undefined ? {} : { values: parsedValues }),
    ...(expect === undefined ? {} : { expect }),
  });
}

/** Validate a behavior spec before any document is compiled. */
export function readLocalBehaviorSpec(value: unknown): LocalBehaviorSpec {
  const record = requireRecord(value, 'spec');
  checkKeys(record, SPEC_KEYS, 'spec');
  if (record.protocol !== LOCAL_BEHAVIOR_SPEC_PROTOCOL) {
    throw new TypeError(`spec.protocol must be "${LOCAL_BEHAVIOR_SPEC_PROTOCOL}".`);
  }
  const component = readString(record.component, 'spec.component', 128);
  if (!COMPONENT_NAME.test(component)) {
    throw new TypeError('spec.component must be a lowercase kebab-case tag name.');
  }
  const source = readString(record.source, 'spec.source', MAX_LOCAL_COMPLIANCE_SOURCE_LENGTH);
  if (source.trim() === '') throw new TypeError('spec.source must not be empty.');
  let binding: string | undefined;
  if (record.binding !== undefined) {
    binding = readString(record.binding, 'spec.binding', 128);
    if (!PUBLIC_NAME.test(binding)) throw new TypeError('spec.binding must be a public parameter name.');
  }
  let writes: readonly LocalBehaviorWriteSpec[] | undefined;
  if (record.writes !== undefined) {
    if (!Array.isArray(record.writes)) throw new TypeError('spec.writes must be an array.');
    if (record.writes.length > MAX_LOCAL_COMPLIANCE_WRITES) {
      throw new TypeError(`spec.writes accepts at most ${MAX_LOCAL_COMPLIANCE_WRITES} entries.`);
    }
    const seen = new Set<string>();
    writes = Object.freeze(record.writes.map((item, index) => readWrite(item, index, seen)));
  }
  const reset = record.reset === undefined ? undefined : readBoolean(record.reset, 'spec.reset');
  return Object.freeze({
    protocol: LOCAL_BEHAVIOR_SPEC_PROTOCOL,
    component,
    source,
    ...(binding === undefined ? {} : { binding }),
    ...(writes === undefined ? {} : { writes }),
    ...(reset === undefined ? {} : { reset }),
  });
}

function findNodes(nodes: readonly LocalNode[], name: string): LocalNode[] {
  const found: LocalNode[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type !== 'text' && node.name === name) found.push(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) stack.push(child);
    }
  }
  return found;
}

function toKernelValue(value: LocalComplianceValue): LocalValue {
  return (Array.isArray(value) ? value.slice() : value) as LocalValue;
}

function toObserved(value: LocalValue | undefined): LocalComplianceValue {
  if (Array.isArray(value)) return Object.freeze(value.slice()) as LocalComplianceValue;
  return (value ?? null) as LocalComplianceValue;
}

interface SlotBinding {
  readonly slot: string;
  readonly parameter: string;
  readonly node: LocalNode;
  readonly public: boolean;
}

function collectSlots(definition: LocalComponentDefinition, node: LocalNode): SlotBinding[] {
  const slots: SlotBinding[] = [];
  for (const [slot, binding] of Object.entries(definition.bindings ?? {})) {
    if (binding.requiresAttributes?.some(attribute => !Object.hasOwn(node.attrs ?? {}, attribute))) continue;
    const parameter = node.attrs?.[binding.bind];
    const named = typeof parameter === 'string' && parameter !== '';
    slots.push({ slot, parameter: named ? parameter : slot, public: named, node });
  }
  return slots;
}

function readParameters(runtime: LocalRuntime, slots: readonly SlotBinding[]): Record<string, LocalComplianceValue> {
  const values: Record<string, LocalComplianceValue> = {};
  for (const slot of slots) {
    values[slot.parameter] = toObserved(readSlot(runtime, slot));
  }
  return values;
}

function readSlot(runtime: LocalRuntime, slot: SlotBinding): LocalValue | undefined {
  return slot.public ? runtime.getParameter(slot.parameter) : runtime.get(slot.node, slot.slot === 'value' ? undefined : slot.slot);
}

function observedOf(values: Readonly<Record<string, LocalComplianceValue>>): Record<string, LocalComplianceValue> {
  const out: Record<string, LocalComplianceValue> = {};
  for (const [key, value] of Object.entries(values)) out[`value.${key}`] = value;
  return out;
}

/** Run one write and return its case plus rollback/copy evidence. */
function runWrite(
  runtime: LocalRuntime,
  node: LocalNode,
  write: LocalBehaviorWriteSpec,
  index: number,
  slotIndex: Map<string, SlotBinding>,
): LocalComplianceCaseResult[] {
  const id = write.id ?? `write.${index}`;
  const beforeRevision = runtime.snapshot().revision;
  const beforeValues = readParameters(runtime, [...slotIndex.values()]);
  const diagnostics: { code: string; message: string }[] = [];
  const mutableArrays: { parameter: string; value: (string | number)[] }[] = [];
  let result: readonly { code: string; message: string }[] = [];

  try {
    if (write.values !== undefined) {
      const kernelValues: Record<string, LocalValue> = {};
      for (const [slot, value] of Object.entries(write.values)) {
        if (!slotIndex.has(slot)) {
          diagnostics.push({ code: 'testing.spec', message: `Spec writes unknown slot "${slot}".` });
          continue;
        }
        const kernel = toKernelValue(value);
        if (Array.isArray(kernel)) {
          mutableArrays.push({ parameter: slotIndex.get(slot)!.parameter, value: kernel as (string | number)[] });
        }
        kernelValues[slot] = kernel;
      }
      result = diagnostics.length > 0 ? diagnostics : runtime.setMany(node, kernelValues);
    } else {
      const slot = write.slot ?? 'value';
      if (!slotIndex.has(slot)) {
        diagnostics.push({ code: 'testing.spec', message: `Spec writes unknown slot "${slot}".` });
        result = diagnostics;
      } else {
        const kernel = toKernelValue(write.value ?? null);
        if (Array.isArray(kernel)) {
          mutableArrays.push({ parameter: slotIndex.get(slot)!.parameter, value: kernel as (string | number)[] });
        }
        result = runtime.set(node, kernel, slot === 'value' ? undefined : slot);
      }
    }
  } catch (error) {
    diagnostics.push({ code: 'testing.behavior', message: readErrorMessage(error) });
    result = diagnostics;
  }

  const actualAccepted = result.length === 0;
  const afterRevision = runtime.snapshot().revision;
  const afterValues = readParameters(runtime, [...slotIndex.values()]);
  const changed = !sameComplianceRecord(beforeValues, afterValues);
  const issues: string[] = [];

  if (actualAccepted !== write.accepted) {
    issues.push(`Expected the write to be ${write.accepted ? 'accepted' : 'rejected'}, but it was ${actualAccepted ? 'accepted' : 'rejected'}.`);
  }
  if (actualAccepted) {
    if (changed && afterRevision <= beforeRevision) issues.push('An accepted change did not advance the runtime revision.');
    if (!changed && afterRevision !== beforeRevision) issues.push('A no-op accepted write advanced the runtime revision.');
    for (const [parameter, expected] of Object.entries(write.expect ?? {})) {
      if (!sameComplianceValue(afterValues[parameter], expected)) {
        issues.push(`Parameter "${parameter}" is ${JSON.stringify(afterValues[parameter])}, expected ${JSON.stringify(expected)}.`);
      }
    }
  }
  for (const [parameter, expected] of Object.entries(write.expect ?? {})) {
    if (actualAccepted) continue;
    if (!sameComplianceValue(beforeValues[parameter], expected) && !sameComplianceValue(afterValues[parameter], expected)) {
      issues.push(`Parameter "${parameter}" did not retain the expected value ${JSON.stringify(expected)}.`);
    }
  }

  const cases: LocalComplianceCaseResult[] = [];
  cases.push(issues.length === 0
    ? passed(`behavior.write.${id}`, 'behavior', {
      observed: {
        accepted: actualAccepted,
        changed,
        revision: afterRevision,
        ...observedOf(afterValues),
      },
    })
    : failed(`behavior.write.${id}`, 'behavior', issues.join(' '), result));

  // Rejected writes must leave both parameters and revision untouched.
  if (!actualAccepted) {
    const rollbackIssues: string[] = [];
    if (afterRevision !== beforeRevision) rollbackIssues.push(`Revision changed from ${beforeRevision} to ${afterRevision}.`);
    if (!sameComplianceRecord(beforeValues, afterValues)) rollbackIssues.push('A rejected write changed public parameters.');
    cases.push(rollbackIssues.length === 0
      ? passed(`behavior.rollback.${id}`, 'behavior', { observed: { revision: afterRevision } })
      : failed(`behavior.rollback.${id}`, 'behavior', rollbackIssues.join(' ')));
  }

  // Arrays are copied on the way in and out; mutating either copy is inert.
  if (actualAccepted && mutableArrays.length > 0) {
    const copyIssues: string[] = [];
    for (const mutable of mutableArrays) {
      if (Array.isArray(mutable.value) && mutable.value.length > 0) {
        mutable.value[0] = typeof mutable.value[0] === 'number' ? 999_999 : '__mutated__';
      }
      const afterMutation = readParameters(runtime, [...slotIndex.values()]);
      if (!sameComplianceValue(afterMutation[mutable.parameter], afterValues[mutable.parameter])) {
        copyIssues.push(`Mutating the written array changed stored parameter "${mutable.parameter}".`);
      }
      const target = [...slotIndex.values()].find(slot => slot.parameter === mutable.parameter)!;
      const read = readSlot(runtime, target);
      if (Array.isArray(read) && read.length > 0) {
        (read as (string | number)[])[0] = typeof read[0] === 'number' ? -999_999 : '__read_mutated__';
        const afterReadMutation = readParameters(runtime, [...slotIndex.values()]);
        if (!sameComplianceValue(afterReadMutation[mutable.parameter], afterValues[mutable.parameter])) {
          copyIssues.push(`Mutating a returned array changed stored parameter "${mutable.parameter}".`);
        }
      }
    }
    cases.push(copyIssues.length === 0
      ? passed(`behavior.copy.${id}`, 'behavior')
      : failed(`behavior.copy.${id}`, 'behavior', copyIssues.join(' ')));
  }

  return cases;
}

/**
 * Execute a component's public binding behavior.
 *
 * The suite compiles the supplied source with the same immutable config used
 * by rendering, then performs real runtime writes. Accepted writes must change
 * values and advance the revision; rejected writes must roll back with an
 * unchanged revision. Reset restores authored initials and advances the reset
 * token. Collections additionally prove defensive copies.
 */
export function runLocalBehaviorCompliance(
  input: LocalBehaviorSpec | unknown,
  configInput: LocalConfig | unknown,
): LocalComplianceSuiteResult {
  const spec = readLocalBehaviorSpec(input);
  const config = readLocalConfig(configInput);
  const definition = getLocalComponentRegistry(config).find((item) => item.name === spec.component);
  const cases: LocalComplianceCaseResult[] = [];

  if (!definition) {
    cases.push(failed('behavior.component', 'behavior', `Component <${spec.component}> is not installed in this configuration.`));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'behavior',
      configKey: config.key,
      component: null,
      cases: Object.freeze(cases),
    });
  }

  const ref = Object.freeze({ id: definition.id, name: definition.name, version: definition.version });
  const compiled = compileLocal(spec.source, { config });
  if (!compiled.ok) {
    cases.push(failed('behavior.compile', 'behavior', 'The compliance source did not compile.', compiled.diagnostics));
    cases.push(skipped('behavior.execute', 'behavior', 'Skipped because the source did not compile.'));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'behavior',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }
  cases.push(passed('behavior.compile', 'behavior'));

  const nodes = findNodes(compiled.document.nodes, spec.component);
  if (nodes.length !== 1) {
    cases.push(failed('behavior.node', 'behavior', `Expected exactly one <${spec.component}> node, found ${nodes.length}.`));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'behavior',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }
  const node = nodes[0];
  cases.push(passed('behavior.node', 'behavior'));

  const slots = collectSlots(definition, node);
  const hasBindings = Object.keys(definition.bindings ?? {}).length > 0;
  if (!hasBindings) {
    cases.push(skipped('behavior.bindings', 'behavior', 'The manifest declares no bindings.'));
    if ((spec.writes ?? []).length > 0) {
      cases.push(failed('behavior.writes', 'behavior', 'Write cases were supplied for a component without bindings.'));
    }
    cases.push(skipped('behavior.interactive', 'behavior',
      'No bindings: interactive behavior must be executed by the browser suite.', ['interactive']));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'behavior',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }

  if (slots.length === 0) {
    cases.push(failed('behavior.bindings', 'behavior', 'The source does not bind any declared slot.'));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'behavior',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }

  if (spec.binding !== undefined && !slots.some((slot) => slot.parameter === spec.binding)) {
    cases.push(failed('behavior.parameter', 'behavior', `The source does not bind parameter "${spec.binding}".`));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'behavior',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }

  cases.push(passed('behavior.bindings', 'behavior', {
    observed: Object.fromEntries(slots.map((slot) => [slot.slot, slot.parameter])),
  }));

  const slotIndex = new Map(slots.map((slot) => [slot.slot, slot]));
  const runtime = createLocalRuntime(compiled.document);
  try {
    const initial = readParameters(runtime, slots);
    const initialRevision = runtime.snapshot().revision;
    cases.push(passed('behavior.initial', 'behavior', {
      observed: { revision: initialRevision, ...observedOf(initial) },
    }));

    const writes = spec.writes ?? [];
    if (writes.length === 0) {
      cases.push(skipped('behavior.writes', 'behavior', 'No write cases were supplied.'));
    }
    let acceptedChanges = 0;
    let rejectedWrites = 0;
    for (let index = 0; index < writes.length; index += 1) {
      const write = writes[index];
      const before = readParameters(runtime, slots);
      const results = runWrite(runtime, node, write, index, slotIndex);
      cases.push(...results);
      const after = readParameters(runtime, slots);
      if (write.accepted && !sameComplianceRecord(before, after)) acceptedChanges += 1;
      if (!write.accepted) rejectedWrites += 1;
    }

    const resetEnabled = spec.reset !== false;
    if (resetEnabled) {
      const tokenBefore = runtime.resetToken(node);
      const revisionBefore = runtime.snapshot().revision;
      runtime.reset(node);
      const tokenAfter = runtime.resetToken(node);
      const revisionAfter = runtime.snapshot().revision;
      const resetValues = readParameters(runtime, slots);
      const resetIssues: string[] = [];
      if (!sameComplianceRecord(initial, resetValues)) {
        resetIssues.push('Reset did not restore the authored initial values.');
      }
      if (!(tokenAfter > tokenBefore)) resetIssues.push('Reset did not advance the reset token.');
      if (!(revisionAfter > revisionBefore)) resetIssues.push('Reset did not advance the runtime revision.');
      cases.push(resetIssues.length === 0
        ? passed('behavior.reset', 'behavior', {
          observed: { revision: revisionAfter, token: tokenAfter, ...observedOf(resetValues) },
        })
        : failed('behavior.reset', 'behavior', resetIssues.join(' ')));
    } else {
      cases.push(skipped('behavior.reset', 'behavior', 'Reset checks were disabled by the spec.'));
    }

    if (acceptedChanges > 0 && rejectedWrites > 0 && resetEnabled) {
      cases.push(passed('behavior.interactive', 'behavior', { capabilities: ['interactive'] }));
    } else {
      cases.push(skipped(
        'behavior.interactive',
        'behavior',
        'Interactive evidence requires at least one accepted change, one rejected write and an executed reset.',
        ['interactive'],
      ));
    }
  } finally {
    runtime.dispose();
  }

  return Object.freeze({
    protocol: LOCAL_COMPLIANCE_PROTOCOL,
    suite: 'behavior',
    configKey: config.key,
    component: ref,
    cases: Object.freeze(cases),
  });
}

export const BEHAVIOR_LIMITS = Object.freeze({
  maxWrites: MAX_LOCAL_COMPLIANCE_WRITES,
  maxSlots: MAX_LOCAL_COMPLIANCE_SLOTS,
  maxStringLength: MAX_LOCAL_COMPLIANCE_STRING_LENGTH,
});
