import type { ReactNode } from 'react';
import type { Diagnostic, LocalNode, LocalRuntime, LocalValue, SourceRange } from '../../local/types';

/** Rendering contract shared by the React views. Kept out of types.ts so the
 * core compiler and runtime types never depend on React. */
export type LocalRenderMode = 'interactive' | 'static';

export interface LocalRenderContext {
  runtime: LocalRuntime;
  render(nodes?: LocalNode[], visible?: boolean): ReactNode;
  visible: boolean;
  mode: LocalRenderMode;
}

export interface LocalVisualProps extends Omit<LocalRenderContext, 'mode'> {
  node: LocalNode;
  /** Defaults to interactive so hand-built visual fixtures stay compatible. */
  mode?: LocalRenderMode;
}

/**
 * JSON-safe host data indexed by `${kind}:${ref}` for `hostComponent` nodes.
 * The host supplies it to the view; it never enters the compiler or worker.
 */
export type LocalHostData = Readonly<Record<string, unknown>>;

/** A resolved host property; full interpolations keep their expression type. */
export type LocalHostPropValue = string | number | boolean | null;

/**
 * Context passed to a host renderer. It extends the read-only render context
 * with the component's own binding, reset and property state. `setValue`
 * validates through the runtime; it never bypasses shared binding constraints.
 */
export interface LocalHostComponentContext extends LocalRenderContext {
  /** Current binding value, or `null` when the host component has no binding. */
  value: LocalValue;
  /** Write this component's bound value; returns false and reports diagnostics on rejection. */
  setValue(value: LocalValue): boolean;
  /** Resolved `disabled` state; false when the component has no binding. */
  disabled: boolean;
  /** Incrementing token that changes on panel reset. */
  resetToken: number;
  /** Resolved non-binding attributes; full interpolations keep their type. */
  props: Readonly<Record<string, LocalHostPropValue>>;
  /** Report host-owned diagnostics to the document's `onDiagnostics` callback. */
  report(diagnostics: Diagnostic[]): void;
}

/**
 * Renderer for legacy `hostComponent` nodes. Synchronous callback failures
 * fall back to a node placeholder. The runtime-free view also calls it on the
 * server, with a read-only runtime projection.
 */
export type LocalHostRenderer = (
  node: LocalNode,
  data: unknown,
  ctx: LocalHostComponentContext,
) => ReactNode;

/** A preview location reported to `onSourceNavigate`. */
export interface LocalSourceTarget {
  /** UTF-16 half-open offsets into the original document source. */
  range: SourceRange;
  nodeId: string;
  nodeType: string;
  /** Present when the target is a component or host component. */
  componentName?: string;
}
