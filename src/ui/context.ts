import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type {
  Diagnostic,
  DocumentNode,
  Json,
  Runtime,
  RuntimeSnapshot,
  SourceRange,
  ValueSource,
  CompiledDocument,
} from '../core/types';

export interface ViewerContextValue {
  runtime: Runtime;
  snapshot: RuntimeSnapshot;
  /** Show runtime diagnostics in the editor diagnostics panel. */
  report: (diagnostics: Diagnostic[]) => void;
  /** Move the editor caret to a diagnostic range. */
  focusDiagnostic: (range: SourceRange) => void;
  locals?: Record<string, Json>;
  document?: CompiledDocument;
}

export const ViewerContext = createContext<ViewerContextValue | null>(null);

export function useViewer(): ViewerContextValue {
  const value = useContext(ViewerContext);
  if (!value) throw new Error('ViewerContext 未初始化');
  return value;
}

/** A row scope is explicit, read-only, and inherited by nested component trees. */
export function ScopedViewer({ values, children }: { values: Record<string, Json>; children: ReactNode }) {
  const parent = useViewer();
  const context = useMemo<ViewerContextValue>(() => {
    const merge = (extra?: Record<string, Json>) => ({ ...parent.locals, ...values, ...extra });
    const runtime: Runtime = {
      ...parent.runtime,
      evaluate: (value, extra) => parent.runtime.evaluate(value, merge(extra)),
      dispatch: (action, extra) => parent.runtime.dispatch(action, merge(extra)),
      dispatchAsync: (action, extra) => parent.runtime.dispatchAsync(action, merge(extra)),
      writeBinding: (id, value, extra) => parent.runtime.writeBinding(id, value, merge(extra)),
    };
    return { ...parent, locals: merge(), runtime };
  }, [parent, values]);
  return createElement(ViewerContext.Provider, { value: context }, children);
}

export function nodeProps(node: DocumentNode): Record<string, ValueSource> {
  return node.props ?? {};
}

export type Evaluated<T = Json> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function evaluateSource(runtime: Runtime, source: ValueSource | undefined): Evaluated {
  if (!source) return { ok: false, message: '缺少属性值' };
  try {
    return { ok: true, value: runtime.evaluate(source) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function propOf(node: DocumentNode, name: string): ValueSource | undefined {
  return node.props?.[name];
}

/** Evaluate a property, falling back when it is absent. */
export function evalProp(
  runtime: Runtime,
  node: DocumentNode,
  name: string,
  fallback: Json,
): Json {
  const source = propOf(node, name);
  if (!source) return fallback;
  const result = evaluateSource(runtime, source);
  if (!result.ok) throw new Error(`属性 ${name} 求值失败：${result.message}`);
  return result.value;
}

export function evalString(runtime: Runtime, node: DocumentNode, name: string, fallback = ''): string {
  const value = evalProp(runtime, node, name, fallback);
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function evalBoolean(runtime: Runtime, node: DocumentNode, name: string, fallback = false): boolean {
  const source = propOf(node, name);
  if (!source) return fallback;
  const result = evaluateSource(runtime, source);
  if (!result.ok) throw new Error(`属性 ${name} 求值失败：${result.message}`);
  if (typeof result.value !== 'boolean') {
    throw new Error(`属性 ${name} 必须是布尔值`);
  }
  return result.value;
}

export function evalNumber(runtime: Runtime, node: DocumentNode, name: string, fallback: number): number {
  const source = propOf(node, name);
  if (!source) return fallback;
  const result = evaluateSource(runtime, source);
  if (!result.ok) throw new Error(`属性 ${name} 求值失败：${result.message}`);
  if (typeof result.value !== 'number' || !Number.isFinite(result.value)) {
    throw new Error(`属性 ${name} 必须是有限数字`);
  }
  return result.value;
}

/** Dynamic label wins over the directive label; both are plain text. */
export function labelOf(runtime: Runtime, node: DocumentNode, fallback = ''): string {
  const source = propOf(node, 'label');
  if (source) {
    const result = evaluateSource(runtime, source);
    if (result.ok) {
      if (result.value === null) return '';
      if (typeof result.value === 'string') return result.value;
      if (typeof result.value === 'number' || typeof result.value === 'boolean') {
        return String(result.value);
      }
      return fallback;
    }
  }
  return node.label ?? fallback;
}

export function boundValue(snapshot: RuntimeSnapshot, node: DocumentNode): Json {
  if (!node.binding) return null;
  const value = snapshot.state[node.binding];
  return value === undefined ? null : value;
}

export function diagnosticText(diagnostic: Diagnostic): string {
  return `${diagnostic.message}（第 ${diagnostic.line} 行，第 ${diagnostic.column} 列）`;
}

/**
 * Only http(s) links, mailto/tel links, and same-page or relative URLs are
 * accepted. Images accept http(s) and relative URLs. Everything else, notably
 * script and data protocols, is rendered as plain text.
 */
export function safeUrl(raw: string | undefined, kind: 'link' | 'image'): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\u0000-  ]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    const allowed =
      kind === 'image'
        ? name === 'http' || name === 'https'
        : name === 'http' || name === 'https' || name === 'mailto' || name === 'tel';
    return allowed ? trimmed : null;
  }
  // Protocol-relative URLs are network URLs but not script execution.
  if (normalized.startsWith('//')) return trimmed;
  return trimmed;
}

export function formatValue(value: Json | undefined, format: string, currency: string): string {
  if (value === null || value === undefined) return '';
  if (format === 'currency') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('currency 格式要求数字值');
    }
    const code = /^[A-Z]{3}$/.test(currency) ? currency : 'CNY';
    try {
      return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: code }).format(value);
    } catch {
      throw new Error(`货币代码 ${code} 无效`);
    }
  }
  if (format === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('number 格式要求数字值');
    }
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error('该值不是可显示的标量');
}
