import {
  constraintDefinition,
  rangeOrderDiagnostic,
  slotRelationError,
  valueDiagnosticFor,
  type RuntimeCore,
} from './runtime-document';
import type { Diagnostic, LocalDocument, LocalValue } from '../types';
import { cloneValue, validateValue } from './runtime-values';
import { planLocalStateRetention, type LocalStateRetentionDrop } from './retention';

/**
 * Migrate control state onto a new document. The retention plan decides what
 * is comparable at all; each surviving value is revalidated against the new
 * bindings and shared controls exactly like a parameter write would be.
 * Values the new constraints reject fall back to the new initial value,
 * except a value that a dependency had already narrowed out of range in the
 * previous document while the binding's constraint definition is unchanged:
 * dynamic constraints never reset such a value, so a migration must not either.
 */
export function migrateRuntimeState(
  core: RuntimeCore,
  state: Record<string, LocalValue>,
  next: LocalDocument,
  nextCore: RuntimeCore,
  prospectiveReader: (overrides: Readonly<Record<string, LocalValue>>, loaded: RuntimeCore, values: Record<string, LocalValue>) => Parameters<typeof validateValue>[3],
): {
  values: Record<string, LocalValue>;
  retained: string[];
  dropped: LocalStateRetentionDrop[];
  diagnostics: Diagnostic[];
} {
  const plan = planLocalStateRetention({ previous: core.document, state, next });
  const values: Record<string, LocalValue> = {};
  for (const [key, binding] of Object.entries(next.bindings)) {
    values[key] = cloneValue(binding.initial);
  }

  const droppedByName = new Map<string, LocalStateRetentionDrop>();
  for (const entry of plan.dropped) droppedByName.set(entry.name, Object.freeze({ ...entry }));
  const diagnostics: Diagnostic[] = [];
  const accepted: Record<string, LocalValue> = {};
  const acceptedNames: string[] = [];

  // 动态约束收窄后保留的已有值：旧文档中已失效、且约束定义未变时原样保留。
  const narrowed = new Set<string>();
  let previousRead: ReturnType<typeof prospectiveReader> | undefined;
  const keepsNarrowedValue = (name: string): boolean => {
    const previous = core.document.bindings[name];
    const controls = core.controls.get(name) ?? [];
    if (!previous || !controls.some((node) => core.document.dynamicConstraints?.[node.id])) return false;
    previousRead ??= prospectiveReader({}, core, state);
    if (validateValue(previous, controls, plan.values[name], previousRead, core.valueRules, core.legacyValueRules).ok) return false;
    return constraintDefinition(core, name) === constraintDefinition(nextCore, name);
  };

  for (const name of plan.retained) {
    const binding = next.bindings[name];
    if (!binding) continue;
    if (keepsNarrowedValue(name)) {
      narrowed.add(name);
      accepted[name] = cloneValue(plan.values[name]);
      acceptedNames.push(name);
      continue;
    }
    const result = validateValue(binding, nextCore.controls.get(name) ?? [], plan.values[name], prospectiveReader(plan.values, nextCore, values), nextCore.valueRules, nextCore.legacyValueRules);
    if (!result.ok) {
      diagnostics.push(valueDiagnosticFor(nextCore, binding, result.detail));
      droppedByName.set(name, Object.freeze({ name, reason: 'invalid' }));
      continue;
    }
    accepted[name] = cloneValue(result.value);
    acceptedNames.push(name);
  }

  // Mirror applyLocalStateRetention: try the surviving values atomically
  // first, then fall back to sorted individual writes when a slot relation
  // would cross. That keeps both slots readable and the final range ordered.
  const atomic: Record<string, LocalValue> = { ...values, ...accepted };
  const affected = new Set<string>();
  for (const name of acceptedNames) {
    for (const nodeId of nextCore.publicSlotOwners.get(name) ?? []) affected.add(nodeId);
  }
  let crossing = false;
  for (const nodeId of [...affected].sort()) {
    if (slotRelationError(nextCore, nodeId, atomic)) {
      crossing = true;
      break;
    }
  }

  let retained: string[];
  if (!crossing) {
    Object.assign(values, accepted);
    retained = acceptedNames;
  } else {
    retained = [];
    for (const name of acceptedNames) {
      const previous = values[name];
      values[name] = accepted[name];
      let blocked = false;
      for (const nodeId of [...(nextCore.publicSlotOwners.get(name) ?? [])].sort()) {
        if (slotRelationError(nextCore, nodeId, values)) {
          diagnostics.push(rangeOrderDiagnostic(nextCore, nodeId));
          blocked = true;
        }
      }
      if (blocked) {
        values[name] = previous;
        droppedByName.set(name, Object.freeze({ name, reason: 'invalid' }));
      } else {
        retained.push(name);
      }
    }
  }

  // Final invariant: a hand-built document may still declare crossing
  // initials. Reset both slots to their authored defaults, and reject the
  // document if even those defaults cross.
  for (const [nodeId, relations] of nextCore.slotRelations) {
    if (!slotRelationError(nextCore, nodeId, values)) continue;
    for (const relation of relations) {
      for (const key of [relation.lower, relation.upper]) {
        const binding = next.bindings[key];
        if (!binding) continue;
        values[key] = cloneValue(binding.initial);
        const index = retained.indexOf(key);
        if (index >= 0) retained.splice(index, 1);
        droppedByName.set(key, Object.freeze({ name: key, reason: 'invalid' }));
      }
    }
    diagnostics.push(rangeOrderDiagnostic(nextCore, nodeId));
    if (slotRelationError(nextCore, nodeId, values)) {
      return { values: {}, retained: [], dropped: [], diagnostics: [] };
    }
  }

  // Resetting one retained dependency can invalidate other retained values.
  // Validate the actual candidate state until no retained value is dropped.
  let changed = true;
  while (changed) {
    const read = prospectiveReader({}, nextCore, values);
    const rejected: string[] = [];
    for (const name of retained) {
      if (narrowed.has(name)) continue;
      const binding = next.bindings[name];
      const checked = validateValue(binding, nextCore.controls.get(name) ?? [], values[name], read, nextCore.valueRules, nextCore.legacyValueRules);
      if (!checked.ok) {
        diagnostics.push(valueDiagnosticFor(nextCore, binding, checked.detail));
        rejected.push(name);
      }
    }
    for (const name of rejected) {
      values[name] = cloneValue(next.bindings[name].initial);
      retained.splice(retained.indexOf(name), 1);
      droppedByName.set(name, Object.freeze({ name, reason: 'invalid' }));
    }
    changed = rejected.length > 0;
  }

  const dropped = [...droppedByName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  retained.sort();
  return { values, retained, dropped, diagnostics };
}
