import type { LocalOptionCheck } from '../configuration/options-core';
import type { Diagnostic, LocalNode } from '../types';
import { reportWarning, type CompileState } from './compiler-services';
import { scanInterpolations } from './compiler-values';
import { kernelRules, kernelValueBinding } from '../../contracts/component-kernel';
import { hasLiteralComponentAttributes } from './runtime-requirement';
import { validateAttributeRelations, validateAttributes, validateBindingConstraintAttributes } from './compiler-attributes';
import type { LocalDiagnosticDetails } from '../configuration/diagnostics';
import type { ReportDiagnostic } from './compiler-structure';

type Embedding = Extract<LocalOptionCheck, { ok: true }>['embedding'];

export type ReportForNode = (node: LocalNode) => ReportDiagnostic;

export interface EmbeddingRejection {
  code: string;
  message: string | LocalDiagnosticDetails;
  details?: LocalDiagnosticDetails;
}

export function collectEmbeddingRejections(report: ReportDiagnostic, rejected: Map<string, EmbeddingRejection>): ReportForNode {
  return node => (code, message, start, end, details) => {
    if (code.includes('budget')) report(code, message, start, end, details);
    else if (!rejected.has(node.id)) rejected.set(node.id, { code, message, details });
  };
}

export function embeddingFallback(
  state: CompileState, node: LocalNode, profile: Embedding, code: string,
  message: string | LocalDiagnosticDetails = { key: code }, details?: LocalDiagnosticDetails,
): LocalNode {
  const { id, range } = node;
  const reasonKey = (typeof message === 'string' ? details?.key : message.key) ?? code;
  if (profile.onUnsupported === 'error') state.report(code, message, range.start, range.end, details);
  else reportWarning(state, code, message, range.start, range.end, details);
  return {
    type: 'fallback', id, range,
    value: state.source.slice(range.start, range.end),
    fallback: { code, range, reasonKey },
  };
}

export function replaceEmbeddingNodes(nodes: LocalNode[], replace: (node: LocalNode) => LocalNode | undefined): LocalNode[] {
  return nodes.map(node => replace(node) ?? (node.children?.length
    ? { ...node, children: replaceEmbeddingNodes(node.children, replace) }
    : node));
}

export function applyEmbedding(state: CompileState, profile: Embedding): void {
  const literal = profile.expressions === 'literal';
  // A restrictive profile is what makes parser fallbacks fatal: it forbids
  // content the parser had to leave uninterpreted. Opting into external slots
  // alone is additive, so it must never change fallback severity.
  const restrictive = literal || !profile.allowImages || !profile.allowInteractive;
  if (!restrictive && profile.onUnsupported === 'error' && !profile.allowExternalSlots) return;
  const parserFallbacks = new Map<string, Diagnostic>();
  const errors = new Set<Diagnostic>();
  for (const item of state.diagnostics) {
    if (item.severity === 'warning' && (item.code === 'local.component.unknown' || item.code === 'local.html.fallback')) {
      parserFallbacks.set(`${item.range.start}:${item.range.end}`, item);
    }
  }
  const transform = (node: LocalNode): LocalNode => {
    if (node.type === 'fallback') {
      const diagnostic = parserFallbacks.get(`${node.range.start}:${node.range.end}`);
      if (!diagnostic) return node;
      if (restrictive && profile.onUnsupported === 'error') errors.add(diagnostic);
      return { ...node, fallback: { code: diagnostic.code, range: node.range, reasonKey: diagnostic.messageKey } };
    }
    if (literal && node.type === 'interpolation') {
      return { ...node, type: 'text', value: state.source.slice(node.range.start, node.range.end) };
    }
    if (!profile.allowImages && (node.type === 'image' || node.type === 'imageReference')) {
      return embeddingFallback(state, node, profile, 'local.embedding.image');
    }
    if (!profile.allowInteractive && node.type === 'authorJavaScript') {
      return embeddingFallback(state, node, profile, 'local.embedding.interactive');
    }
    if (node.type === 'component' || node.type === 'hostComponent') {
      const name = node.name ?? '';
      if (name === 'external' && profile.allowExternalSlots && Object.hasOwn(node.attrs ?? {}, 'slot')) {
        const slot = node.attrs!.slot;
        if (Object.keys(node.attrs!).length !== 1 || node.children?.length || !/^[a-z][a-z0-9_-]{0,63}$/.test(slot)) {
          return embeddingFallback(state, node, profile, 'local.embedding.external-slot');
        }
        return { type: 'externalSlot', id: node.id, range: node.range, name: slot };
      }
      const definition = state.definitionsByName.get(name);
      const schema = state.schemaByName.get(name);
      const staticIf = literal && definition?.id === 'reactive-md/if' && (node.attrs?.when === 'true' || node.attrs?.when === 'false');
      if (!profile.allowInteractive && !staticIf) {
        const legacyStatic = schema?.legacyHost && !kernelValueBinding(schema) && (literal || hasLiteralComponentAttributes(node));
        if (definition?.capabilities.interactive || (!definition && node.type === 'hostComponent' && !legacyStatic)) {
          return embeddingFallback(state, node, profile, 'local.embedding.interactive');
        }
      }
      if (literal && (name === 'const' || name === 'computed' || name === 'validation' || name === 'external')) {
        return embeddingFallback(state, node, profile, 'local.embedding.declaration');
      }
      if (literal) {
        if (staticIf) {
          node = { ...node, literalAttributes: true };
        }
        const templates = Object.entries(node.attrs ?? {}).filter(([, value]) => {
          if (!value.includes('{{')) return false;
          const scanned = scanInterpolations(value);
          return scanned.segments.length > 0 || scanned.unterminated.length > 0;
        });
        if (templates.length) {
          const rules = schema ? kernelRules(schema) : [];
          const incompatible = templates.some(([attribute, value]) => {
            const prop = schema?.props[attribute];
            return prop?.kind !== 'string' || prop.color || (prop.pattern !== undefined && !new RegExp(prop.pattern).test(value))
              || rules.some(rule => (rule.kind === 'scoped-expressions' || rule.kind === 'require-full-interpolation')
                && rule.attributes.includes(attribute) || rule.kind === 'row-values' && (rule.rows === attribute || rule.key === attribute));
          });
          if (incompatible) return embeddingFallback(state, node, profile, 'local.embedding.attribute');
          node = { ...node, literalAttributes: true };
        }
      }
    }
    return node.children?.length ? { ...node, children: node.children.map(transform) } : node;
  };
  state.nodes = state.nodes.map(transform);
  if (errors.size) {
    for (let index = 0; index < state.diagnostics.length; index++) {
      const diagnostic = state.diagnostics[index];
      if (errors.has(diagnostic)) state.diagnostics[index] = { ...diagnostic, severity: 'error', recoverable: false };
    }
  }
}

export function compileEmbeddingAttributes(state: CompileState, rejectAttribute?: (node: LocalNode) => void): void {
  const skipped = new Set<LocalNode>();
  let localError = false;
  const validationState: CompileState = rejectAttribute ? {
    ...state, semantic: undefined,
    report: (code, ...args) => {
      if (code.startsWith('local.budget')) state.report(code, ...args);
      else localError = true;
    },
  } : state;
  for (const entry of state.entries) {
    if (entry.parent && skipped.has(entry.parent.node)) {
      skipped.add(entry.node);
      continue;
    }
    localError = false;
    state.attrs.set(entry.node.id, validateAttributes(entry, validationState));
    validateAttributeRelations(entry, validationState);
    validateBindingConstraintAttributes(entry, validationState);
    if (!localError) continue;
    rejectAttribute?.(entry.node);
    skipped.add(entry.node);
  }
}
