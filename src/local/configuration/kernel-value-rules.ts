import { kernelRules, type KernelComponentSchema, type KernelDiagnosticIssue } from '../../contracts/component-kernel';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
} from '../../contracts/limits';
import type { LocalNode } from '../types';

export type KernelValueRule =
  | { kind: 'date'; min?: string; max?: string; required?: string }
  | { kind: 'length'; min?: string; max?: string; email?: string; emailType?: string }
  | { kind: 'required'; required: string }
  | { kind: 'email'; type: string; value: string };

export interface KernelDocumentMetadata {
  readonly valueRules: Readonly<Record<string, readonly KernelValueRule[]>>;
  readonly slotRelations: readonly { nodeId: string; lower: string; upper: string }[];
  readonly retentionExclusions: readonly string[];
  /** Authored bind/initial attribute names per public binding. */
  readonly bindingAttributes?: Readonly<Record<string, { readonly bind: string; readonly initial: string }>>;
  /** Dependency-display capabilities per component node. */
  readonly dependencyRules?: Readonly<Record<string, {
    readonly selfBinding?: { readonly mode: 'always' | 'attribute'; readonly attribute?: string };
    readonly inlineMathReads?: boolean;
  }>>;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

/** Lower a component's runtime value rules; compile-time rules are ignored. */
export function kernelValueRules(schema: KernelComponentSchema): readonly KernelValueRule[] {
  const rules: KernelValueRule[] = [];
  for (const rule of kernelRules(schema)) {
    switch (rule.kind) {
      case 'value-date':
        rules.push(stripUndefined({ kind: 'date', min: rule.min, max: rule.max, required: rule.required }));
        break;
      case 'value-length':
        rules.push(stripUndefined({ kind: 'length', min: rule.min, max: rule.max }));
        if (rule.email !== undefined || rule.emailType !== undefined) {
          rules.push(stripUndefined({ kind: 'email', type: rule.email ?? 'type', value: rule.emailType ?? 'email' }));
        }
        break;
      case 'value-email':
        rules.push(stripUndefined({ kind: 'email', type: rule.type ?? 'type', value: rule.value ?? 'email' }));
        break;
      case 'value-required':
        rules.push({ kind: 'required', required: rule.required });
        break;
      default:
        break;
    }
  }
  return rules;
}

/** The serialized kernel metadata a compiled document carries. */
export function kernelDocumentMetadata(document: unknown): KernelDocumentMetadata | undefined {
  if (!document || typeof document !== 'object') return undefined;
  const value = (document as { kernel?: unknown }).kernel;
  if (!value || typeof value !== 'object') return undefined;
  return value as KernelDocumentMetadata;
}

const ANCHOR_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function isKernelAnchorId(value: string): boolean {
  return ANCHOR_ID.test(value);
}

export interface KernelNavigationTarget {
  name: string;
  target: string;
  offset: number;
}

/**
 * Check navigation targets against known anchors and heading slugs. Rules pick
 * the target attribute; the algorithm is shared by every declaring component.
 */
export function kernelNavigationIssues(
  targets: readonly KernelNavigationTarget[],
  explicit: ReadonlySet<string>,
  headings: ReadonlySet<string>,
): KernelDiagnosticIssue[] {
  const issues: KernelDiagnosticIssue[] = [];
  for (const item of targets) {
    const to = item.target;
    if (!to) {
      issues.push({
        code: 'local.jump.target',
        message: '<jump> target cannot be empty.',
        start: item.offset,
        key: 'local.jump.empty',
      });
      continue;
    }
    if (to.startsWith('#') || /\s/.test(to)) {
      issues.push({
        code: 'local.jump.target',
        message: `<${item.name}> target "${to}" must be a bare heading slug or anchor id without "#" or whitespace.`,
        start: item.offset,
        key: 'local.jump.bad-target',
        params: { target: to },
      });
      continue;
    }
    if (!explicit.has(to) && !headings.has(to)) {
      issues.push({
        code: 'local.jump.target',
        message: `<${item.name}> target "${to}" does not resolve to a heading or explicit anchor in this document.`,
        start: item.offset,
        key: 'local.jump.unresolved',
        params: { target: to },
      });
    }
  }
  return issues;
}

export const KERNEL_LIMITS = Object.freeze({
  arrayLength: MAX_LOCAL_ARRAY_LENGTH,
  dataTableColumns: MAX_LOCAL_DATA_TABLE_COLUMNS,
  plotCurves: MAX_LOCAL_PLOT_CURVES,
  plotPoints: MAX_LOCAL_PLOT_POINTS,
});

export function kernelMeaningfulChildren(nodes: readonly LocalNode[] | undefined): LocalNode[] {
  return (nodes ?? []).filter((node) => !(
    node.type === 'comment'
    || (node.type === 'text' && !(node.value ?? '').trim())
    || (node.type === 'paragraph' && !node.children?.length && !(node.value ?? '').trim())
  ));
}

export function kernelHasComponent(node: LocalNode): boolean {
  if (node.type === 'component' || node.type === 'hostComponent') return true;
  return (node.children ?? []).some(kernelHasComponent);
}
