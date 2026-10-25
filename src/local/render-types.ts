import type { ReactNode } from 'react';
import type { LocalNode, LocalRuntime } from './types';

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
 * It is read only by the client renderer and never enters the worker.
 */
export type LocalHostData = Readonly<Record<string, unknown>>;

/**
 * Client-only renderer for `hostComponent` nodes. Receiving `unknown` keeps the
 * contract loose; a synchronous throw falls back to the inert placeholder, so
 * a bad renderer never blanks the whole document.
 */
export type LocalHostRenderer = (
  node: LocalNode,
  data: unknown,
  ctx: LocalRenderContext,
) => ReactNode;
