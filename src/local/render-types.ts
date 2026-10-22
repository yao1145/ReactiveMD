import type { ReactNode } from 'react';
import type { LocalNode, LocalRuntime } from './types';

/** Rendering contract shared by the React views. Kept out of types.ts so the
 * core compiler and runtime types never depend on React. */
export interface LocalRenderContext {
  runtime: LocalRuntime;
  render(nodes?: LocalNode[], visible?: boolean): ReactNode;
  visible: boolean;
}

export interface LocalVisualProps extends LocalRenderContext {
  node: LocalNode;
}
