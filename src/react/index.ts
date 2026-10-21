export { ReactiveDocument } from './ReactiveDocument';
export type { ReactiveDocumentProps } from './ReactiveDocument';
export { RuntimeDocumentView } from '../ui/viewer';
export type { RuntimeDocumentViewProps } from '../ui/viewer';
export type { ComponentProps } from '../ui/components';
export { useViewer as useReactiveContext } from '../ui/context';

import type { ComponentType } from 'react';
import { registerComponent, type ComponentSchema } from '../core';
import { registerComponentRenderer, type ComponentProps } from '../ui/components';

export function registerReactiveComponent(schema: ComponentSchema, renderer: ComponentType<ComponentProps>): () => void {
  const unregisterSchema = registerComponent(schema);
  try {
    const unregisterRenderer = registerComponentRenderer(schema.name, renderer);
    return () => { unregisterRenderer(); unregisterSchema(); };
  } catch (error) {
    unregisterSchema();
    throw error;
  }
}
