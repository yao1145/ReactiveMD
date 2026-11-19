import {
  LOCAL_SYNTAX_VERSION,
  type Diagnostic,
  type LocalBinding,
  type LocalComputation,
  type LocalDocument,
  type LocalNode,
  type LocalValidation,
  type LocalValue,
} from '../types';
import {
  compileExpression,
  LocalExpressionError,
  localValueBudgetError,
  localValueBudgetIssue,
  type LocalExpression,
} from '../evaluation/expression/compile';
import { kernelDocumentMetadata, type KernelValueRule } from '../configuration/kernel-value-rules';
import { cloneValue, diagnosticFor, normalizeComputationError, parameterDiagnostic } from './runtime-values';
import { walkLocalNodes } from '../source/source-context';
import {
  diagnosticEnglish,
  localDiagnosticDetails,
  type LocalDiagnosticDetails,
} from '../configuration/diagnostics';
import { orderComputations } from '../evaluation/computations';
import { isLocalValidation, localLineStarts } from '../evaluation/validation';

interface RuntimeValidationRule {
  rule: LocalValidation;
  expression: LocalExpression | null;
  error: LocalExpressionError | null;
}

/**
 * Structural part of a runtime derived from one document. Rebuilt on every
 * document adoption; values, listeners and expression caches stay on the
 * runtime so identity survives an edit.
 */
export interface RuntimeCore {
  document: LocalDocument;
  nodeIndex: Map<string, LocalNode>;
  controls: Map<string, LocalNode[]>;
  slotKeys: Map<string, Record<string, string>>;
  publicNames: readonly string[];
  publicSlotOwners: Map<string, Set<string>>;
  initial: Record<string, LocalValue>;
  /** Compiled per-node string value rules; empty for hand-built documents. */
  valueRules: ReadonlyMap<string, readonly KernelValueRule[]>;
  /** True when the document has no kernel metadata (phase-one fixture). */
  legacyValueRules: boolean;
  /** Scalar binding key owned by a canonical node id (no multi-slot nodes). */
  bindingByNode: ReadonlyMap<string, string>;
  /** Node id -> declared ordered slot pairs, resolved to binding keys. */
  slotRelations: ReadonlyMap<string, readonly { lower: string; upper: string }[]>;
  computationMetadata: Record<string, LocalComputation>;
  computationNames: string[];
  computationOrder: string[];
  cyclicComputations: string[];
  computationExpressions: Map<string, LocalExpression>;
  constValues: Record<string, LocalValue>;
  constErrors: Map<string, LocalExpressionError>;
  cycleErrors: Map<string, LocalExpressionError>;
  validationRules: RuntimeValidationRule[];
  validationLineStarts: number[];
}

/**
 * Position-free fingerprint of everything that constrains one binding: the
 * binding facts, each control's tag and attributes, its dynamic bound
 * expressions and its compiled value rules. Two documents with the same
 * fingerprint for a name validate that name identically given the same reads.
 */
export function constraintDefinition(loaded: RuntimeCore, name: string): string | undefined {
  const binding = loaded.document.bindings[name];
  if (!binding) return undefined;
  // nodeIds 与 owner 是按位置分配的节点 ID，前置正文就会改变它们。
  const { nodeIds: _nodeIds, owner: _owner, ...facts } = binding;
  const controls = (loaded.controls.get(name) ?? []).map((node) => {
    const dynamic = loaded.document.dynamicConstraints?.[node.id] ?? {};
    return {
      name: node.name ?? null,
      attrs: node.attrs ?? {},
      dynamic: Object.fromEntries(Object.entries(dynamic).map(([key, item]) => [key, item ? { source: item.source, numeric: item.numeric ?? null } : null])),
      rules: loaded.valueRules.get(node.id) ?? null,
    };
  });
  return JSON.stringify({ facts, legacy: loaded.legacyValueRules, controls });
}

/**
 * Compile a metadata expression through the runtime-wide source cache. A
 * failed compile returns its error without caching it, so fixing the source
 * recovers on the next document adoption.
 */
export function compileMetadataExpression(
  source: string,
  cache: Map<string, LocalExpression>,
): { expression: LocalExpression; error: null } | { expression: null; error: LocalExpressionError } {
  const cached = cache.get(source);
  if (cached) return { expression: cached, error: null };
  try {
    const compiled = compileExpression(source);
    if (cache.size >= RUNTIME_EXPRESSION_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(source, compiled);
    return { expression: compiled, error: null };
  } catch (error) {
    return { expression: null, error: normalizeComputationError(error) };
  }
}

export function loadRuntimeCore(document: LocalDocument, expressions: Map<string, LocalExpression>): RuntimeCore {
  const nodeIndex = new Map<string, LocalNode>();
    for (const node of walkLocalNodes(document.nodes)) {
      nodeIndex.set(node.id, node);
    }

  const initial: Record<string, LocalValue> = {};
  /** Registered controls per binding; caller-supplied node metadata is ignored. */
  const controls = new Map<string, LocalNode[]>();
  for (const [key, binding] of Object.entries(document.bindings)) {
    const budget = localValueBudgetIssue(binding.initial);
    if (budget) {
      throw new LocalExpressionError('expression-budget', `Parameter "${key}": ${diagnosticEnglish(budget)}`, 0);
    }
    initial[key] = cloneValue(binding.initial);
    const nodes: LocalNode[] = [];
    for (const id of binding.nodeIds) {
      const node = nodeIndex.get(id);
      if (node) nodes.push(node);
    }
    controls.set(key, nodes);
  }

  /** Canonical node id -> slot -> binding key, for range-slider and coordinate. */
  const slotKeys = new Map<string, Record<string, string>>();
  for (const [id, slots] of Object.entries(document.bindingSlots ?? {})) {
    slotKeys.set(id, { ...slots });
  }

  const metadata = kernelDocumentMetadata(document);
  const valueRules = new Map<string, readonly KernelValueRule[]>(
    Object.entries(metadata?.valueRules ?? {}),
  );
  const legacyValueRules = metadata === undefined;
  const slotRelations = new Map<string, { lower: string; upper: string }[]>();
  if (metadata) {
    for (const relation of metadata.slotRelations) {
      const slots = slotKeys.get(relation.nodeId);
      const lower = slots?.[relation.lower];
      const upper = slots?.[relation.upper];
      if (!lower || !upper) continue;
      const list = slotRelations.get(relation.nodeId) ?? [];
      list.push({ lower, upper });
      slotRelations.set(relation.nodeId, list);
    }
  } else {
    // Phase-one hand-built documents keep the conventional range slot names.
    for (const [id, slots] of slotKeys) {
      if (!slots.start || !slots.end) continue;
      slotRelations.set(id, [{ lower: slots.start, upper: slots.end }]);
    }
  }

  // Scalar binding key per owner node. Custom `bind` attribute names make the
  // legacy `attrs.bind` convention insufficient.
  const bindingByNode = new Map<string, string>();
  for (const [key, binding] of Object.entries(document.bindings)) {
    for (const id of binding.nodeIds) {
      if (slotKeys.has(id)) continue;
      const current = bindingByNode.get(id);
      if (current === undefined || (current.startsWith('@') && !key.startsWith('@'))) {
        bindingByNode.set(id, key);
      }
    }
  }

  const publicNames = Object.freeze(
    Object.keys(document.bindings).filter((key) => !key.startsWith('@')).sort(),
  );

  /** Public slot binding key -> ids of the components that own it. */
  const publicSlotOwners = new Map<string, Set<string>>();
  for (const [id, slots] of slotKeys) {
    for (const key of Object.values(slots)) {
      if (key.startsWith('@')) continue;
      const owners = publicSlotOwners.get(key) ?? new Set<string>();
      owners.add(id);
      publicSlotOwners.set(key, owners);
    }
  }

  /* --------------------------------------------------------- computations */

  const computationMetadata = (document.computations ?? {}) as Record<string, LocalComputation>;
  const computationNames = Object.keys(computationMetadata);
  const computationExpressions = new Map<string, LocalExpression>();
  for (const [name, meta] of Object.entries(computationMetadata)) {
    const compiled = compileMetadataExpression(meta.source, expressions);
    // A hand-built document can carry an invalid expression. The runtime
    // reports it through the same lazy-error channel as a domain failure.
    if (compiled.expression) computationExpressions.set(name, compiled.expression);
  }
  const { order: computationOrder, cyclic: cyclicComputations } = orderComputations(computationMetadata);
  const constValues: Record<string, LocalValue> = {};
  const constErrors = new Map<string, LocalExpressionError>();
  for (const name of computationOrder) {
    const meta = computationMetadata[name];
    if (!meta || meta.kind !== 'const') continue;
    if (Object.hasOwn(meta, 'value')) {
      const value = meta.value as LocalValue;
      const budget = localValueBudgetError(value);
      if (budget) {
        constErrors.set(name, new LocalExpressionError('expression-budget', `Constant "${name}": ${budget}`, 0));
        continue;
      }
      constValues[name] = cloneValue(value);
      continue;
    }
    const compiled = computationExpressions.get(name);
    if (!compiled) {
      constErrors.set(name, new LocalExpressionError('expression-eval', `Constant "${name}" cannot be evaluated.`, 0));
      continue;
    }
    try {
      const value = compiled.evaluate({ ...constValues });
      const budget = localValueBudgetError(value);
      if (budget) {
        constErrors.set(name, new LocalExpressionError('expression-budget', `Constant "${name}": ${budget}`, 0));
        continue;
      }
      constValues[name] = cloneValue(value);
    } catch (error) {
      constErrors.set(name, normalizeComputationError(error));
    }
  }
  const cycleErrors = new Map<string, LocalExpressionError>();
  for (const name of cyclicComputations) {
    cycleErrors.set(name, new LocalExpressionError('expression-cycle', `Computation "${name}" is part of a dependency cycle.`, 0));
  }

  /* --------------------------------------------------------- validations */

  const validationRules: RuntimeValidationRule[] = [];
  if (Array.isArray(document.validations)) {
    for (const rule of document.validations) {
      if (!isLocalValidation(rule)) continue;
      const compiled = compileMetadataExpression(rule.expression, expressions);
      validationRules.push({ rule, expression: compiled.expression, error: compiled.error });
    }
  }
  const validationLineStarts = localLineStarts(typeof document.source === 'string' ? document.source : '');

  return {
    document,
    nodeIndex,
    controls,
    slotKeys,
    publicNames,
    publicSlotOwners,
    initial,
    valueRules,
    legacyValueRules,
    slotRelations,
    bindingByNode,
    computationMetadata,
    computationNames,
    computationOrder,
    cyclicComputations,
    computationExpressions,
    constValues,
    constErrors,
    cycleErrors,
    validationRules,
    validationLineStarts,
  };
}

export function runtimeDocumentProblem(document: LocalDocument | null | undefined): string | null {
  if (!document || document.syntax !== 'local') {
    return 'createLocalRuntime requires a local interaction document.';
  }
  if ((document.syntaxVersion !== undefined && document.syntaxVersion !== LOCAL_SYNTAX_VERSION)
    || (document.versionDeclaration && document.versionDeclaration.version !== LOCAL_SYNTAX_VERSION)) {
    return `createLocalRuntime requires ${LOCAL_SYNTAX_VERSION}; migrate the source before constructing a runtime.`;
  }
  return null;
}

function nodeForBinding(core: RuntimeCore, binding: LocalBinding): LocalNode | undefined {
  return (core.controls.get(binding.name) ?? [])[0]
    ?? (binding.owner ? core.nodeIndex.get(binding.owner) : undefined)
    ?? (binding.nodeIds[0] ? core.nodeIndex.get(binding.nodeIds[0]) : undefined);
}

export function valueDiagnosticFor(core: RuntimeCore, binding: LocalBinding, detail: LocalDiagnosticDetails): Diagnostic {
  const node = nodeForBinding(core, binding);
  return node
    ? diagnosticFor(core.document, node, 'local.runtime.value', detail)
    : parameterDiagnostic('local.runtime.value', diagnosticEnglish(detail));
}

/** Reject a range whose lower slot would cross its upper slot before any commit. */
export function slotRelationError(core: RuntimeCore, nodeId: string, next: Record<string, LocalValue>): boolean {
  const relations = core.slotRelations.get(nodeId);
  if (!relations?.length) return false;
  return relations.some(({ lower, upper }) => {
    const lowerValue = next[lower];
    const upperValue = next[upper];
    return typeof lowerValue === 'number' && typeof upperValue === 'number' && lowerValue > upperValue;
  });
}

export function rangeOrderDiagnostic(core: RuntimeCore, nodeId: string): Diagnostic {
  const node = core.nodeIndex.get(nodeId);
  return node
    ? diagnosticFor(core.document, node, 'local.runtime.value', localDiagnosticDetails('local.runtime.value.range-order'))
    : parameterDiagnostic('local.runtime.value', diagnosticEnglish(localDiagnosticDetails('local.runtime.value.range-order')));
}

export const RUNTIME_EXPRESSION_CACHE_LIMIT = 200;
