import type {
  Diagnostic,
  LocalBinding,
  LocalDocument,
  LocalNode,
  LocalRuntime,
  LocalValue,
} from './types';

export type LocalStateRetentionReason =
  | 'internal' | 'unknown' | 'unretainable' | 'type' | 'initial' | 'invalid';

export interface LocalStateRetentionDrop {
  name: string;
  reason: LocalStateRetentionReason;
}

export interface LocalStateRetentionInput {
  previous: LocalDocument;
  state: Readonly<Record<string, LocalValue>>;
  next: LocalDocument;
}

export interface LocalRetainedState {
  values: Readonly<Record<string, LocalValue>>;
  retained: readonly string[];
  dropped: readonly LocalStateRetentionDrop[];
}

export interface LocalStateRetentionResult {
  retained: readonly string[];
  dropped: readonly LocalStateRetentionDrop[];
  diagnostics: readonly Diagnostic[];
}

interface RetainableBinding {
  type: LocalBinding['type'];
  initialDefinition: string;
}

function indexNodes(document: LocalDocument): Map<string, LocalNode> {
  const index = new Map<string, LocalNode>();
  const walk = (nodes: LocalNode[]): void => {
    for (const node of nodes) {
      index.set(node.id, node);
      if (node.children) walk(node.children);
    }
  };
  walk(document.nodes);
  return index;
}

/** Slot bindings use bind-start/bind-end instead of a `bind` attribute. */
function isSlotBinding(document: LocalDocument, node: LocalNode, name: string): boolean {
  const slots = document.bindingSlots?.[node.id];
  return slots !== undefined && Object.values(slots).includes(name);
}

function retainableBindings(document: LocalDocument): Map<string, RetainableBinding> {
  const nodeIndex = indexNodes(document);
  const result = new Map<string, RetainableBinding>();
  for (const [name, binding] of Object.entries(document.bindings)) {
    const controls = binding.nodeIds.flatMap((id) => {
      const node = nodeIndex.get(id);
      return node ? [node] : [];
    });
    // Checklists are positional and timers own extra UI state, so neither can
    // reinterpret a value from an earlier document safely.
    if (
      !controls.length
      || name.startsWith('@')
      || controls.some((node) => (
        (node.attrs?.bind !== name && !isSlotBinding(document, node, name))
        || node.name === 'timer'
        || node.name === 'checklist'
      ))
    ) continue;
    const explicitInitials = controls.flatMap((node) => (
      Object.hasOwn(node.attrs ?? {}, 'initial') ? [node.attrs!.initial] : []
    )).sort();
    // Capture the author-requested definition too, so adding or removing
    // initial="0" still resets even when the effective default is unchanged.
    result.set(name, {
      type: binding.type,
      initialDefinition: JSON.stringify([binding.initial, explicitInitials]),
    });
  }
  return result;
}

function drop(name: string, reason: LocalStateRetentionReason): LocalStateRetentionDrop {
  return Object.freeze({ name, reason });
}

export function planLocalStateRetention(input: LocalStateRetentionInput): LocalRetainedState {
  const previous = retainableBindings(input.previous);
  const next = retainableBindings(input.next);
  const values: Record<string, LocalValue> = {};
  const retained: string[] = [];
  const dropped: LocalStateRetentionDrop[] = [];

  for (const name of Object.keys(input.state).sort()) {
    if (name.startsWith('@')) {
      dropped.push(drop(name, 'internal'));
      continue;
    }
    if (!Object.hasOwn(input.previous.bindings, name) || !Object.hasOwn(input.next.bindings, name)) {
      dropped.push(drop(name, 'unknown'));
      continue;
    }
    const before = previous.get(name);
    const after = next.get(name);
    if (!before || !after) {
      dropped.push(drop(name, 'unretainable'));
      continue;
    }
    if (before.type !== after.type) {
      dropped.push(drop(name, 'type'));
      continue;
    }
    if (before.initialDefinition !== after.initialDefinition) {
      dropped.push(drop(name, 'initial'));
      continue;
    }
    const value = input.state[name];
    values[name] = Array.isArray(value) ? Object.freeze([...value]) as unknown as LocalValue : value;
    retained.push(name);
  }

  return Object.freeze({
    values: Object.freeze(values),
    retained: Object.freeze(retained),
    dropped: Object.freeze(dropped),
  });
}

function freezeResult(
  retained: readonly string[],
  dropped: readonly LocalStateRetentionDrop[],
  diagnostics: readonly Diagnostic[],
): LocalStateRetentionResult {
  return Object.freeze({
    retained: Object.freeze([...retained]),
    dropped: Object.freeze(dropped.map((entry) => Object.freeze({ ...entry }))),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

export function applyLocalStateRetention(
  runtime: LocalRuntime,
  retained: LocalRetainedState,
): LocalStateRetentionResult {
  const names = Object.keys(retained.values).sort();
  const diagnostics = runtime.setParameters(retained.values);
  if (!diagnostics.length) {
    return freezeResult(names, retained.dropped, []);
  }

  // The atomic write was rejected as a whole. Reapply each value on its own so
  // one stale value cannot block every other retained parameter.
  const applied: string[] = [];
  const dropped: LocalStateRetentionDrop[] = [...retained.dropped];
  const failures: Diagnostic[] = [];
  for (const name of names) {
    const result = runtime.setParameter(name, retained.values[name]);
    if (result.length) {
      dropped.push(drop(name, 'invalid'));
      failures.push(...result);
    } else {
      applied.push(name);
    }
  }
  dropped.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return freezeResult(applied, dropped, failures);
}
