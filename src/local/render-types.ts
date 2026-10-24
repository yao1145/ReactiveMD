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
