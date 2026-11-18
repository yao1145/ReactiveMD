import type { ReactNode } from 'react';
import type { LocalVisualProps } from '../rendering/render-types';
import { renderLegacyComponent } from '../rendering/legacy-component-adapter';

/**
 * Legacy visual entry points.
 *
 * The actual table/chart/plot/timeline/diagram implementations now live in
 * `src/components/shared/visuals.tsx` and are resolved through the default React
 * preset. This module keeps the historical fixture surface (`LocalVisual`,
 * `VisualFrame`) and the generic native-HTML-table helper used by the main
 * renderer; it contains no builtin view implementation or tag dispatch.
 */

export { VisualFrame } from '../../components/shared/visual-frame';
export { tableNumericColumns } from './table-numeric-columns';

/**
 * Legacy fixture renderer for one visual component. It adapts the historical
 * `{ node, runtime, render, visible, mode }` props into the public component
 * context and resolves the actual implementation from the default preset.
 */
export function LocalVisual(props: LocalVisualProps): ReactNode {
  return renderLegacyComponent(props.node.name ?? '', {
    node: props.node,
    runtime: props.runtime,
    mode: props.mode ?? 'interactive',
    visible: props.visible,
    render: props.render,
  });
}
