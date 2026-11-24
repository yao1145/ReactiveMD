import { createElement, type ReactNode } from 'react';
import type { Diagnostic, LocalNode, LocalRuntime, LocalValue } from '../../local/types';
import type { LocalRenderMode } from './render-types';
import type { LocalLocale, Localize } from '../localization';
import { localize } from '../localization';
import { getLocalComponentDefinition } from '../../assemblies/default-registry';
import {
  createLocalComponentContext,
  type LocalComponentAdapterEnvironment,
  type LocalComponentContext,
  type LocalReactComponent,
} from '../component-api';
import { defaultReactPreset } from '../../components/default-preset';

/**
 * Legacy fixture adapter.
 *
 * Older visual/data-table tests build a `LocalNode` and pass a minimal runtime
 * instead of going through `LocalDocumentView`. This module adapts exactly that
 * shape into the public component context and resolves the actual implementation
 * from the default React preset by manifest name. It is a compatibility entry,
 * not a second renderer: all markup comes from `src/components/**`.
 */

export interface LegacyComponentAdapterOptions {
  readonly node: LocalNode;
  readonly runtime: LocalRuntime;
  readonly mode?: LocalRenderMode;
  readonly visible?: boolean;
  /** Legacy block renderer used for the component's parsed children. */
  readonly render?: (nodes?: LocalNode[], visible?: boolean) => ReactNode;
  /** Legacy localizer; defaults to English. */
  readonly t?: Localize;
  readonly locale?: LocalLocale;
  readonly report?: (diagnostics: Diagnostic[]) => void;
}

let viewIndex: ReadonlyMap<string, LocalReactComponent> | null = null;

function defaultViews(): ReadonlyMap<string, LocalReactComponent> {
  if (!viewIndex) {
    const index = new Map<string, LocalReactComponent>();
    for (const component of defaultReactPreset.components) {
      index.set(component.definition.name, component);
    }
    viewIndex = index;
  }
  return viewIndex;
}

function plainNodeText(
  runtime: Pick<LocalRuntime, 'evaluate'>,
  nodes: LocalNode[] | undefined,
  t: Localize,
  depth = 0,
): string {
  if (!nodes || depth > 64) return '';
  let text = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
      case 'code':
      case 'fallback':
        text += node.value ?? '';
        break;
      case 'interpolation':
        try {
          const value: LocalValue = runtime.evaluate((node.value ?? '').trim());
          if (value === null) text += '';
          else if (typeof value === 'string') text += value;
          else if (typeof value === 'number' && Number.isFinite(value)) text += String(value);
          else if (typeof value === 'boolean') text += value ? 'true' : 'false';
          else text += t('Cannot compute', '无法计算');
        } catch {
          text += t('Cannot compute', '无法计算');
        }
        break;
      case 'break':
        text += ' ';
        break;
      case 'inlineMath':
      case 'math':
        text += node.value ?? '';
        break;
      case 'image':
        text += node.alt ?? '';
        break;
      default:
        text += plainNodeText(runtime, node.children, t, depth + 1);
        break;
    }
  }
  return text;
}

/**
 * Build the public context for one legacy fixture node. The returned context
 * only exposes public services; the node stays inside this adapter.
 */
export function createLegacyComponentContext(
  options: LegacyComponentAdapterOptions,
): LocalComponentContext {
  const locale = options.locale ?? 'en';
  const t = options.t ?? ((en: string, zh: string) => localize(locale, en, zh));
  const render = options.render ?? (() => null);
  const report = options.report ?? (() => {});
  let resetToken = 0;
  try {
    resetToken = options.runtime.resetToken(options.node);
  } catch {
    resetToken = 0;
  }
  const environment: LocalComponentAdapterEnvironment = {
    runtime: options.runtime,
    mode: options.mode ?? 'interactive',
    locale,
    visible: options.visible ?? true,
    disabled: false,
    disabledInvalid: false,
    resetToken,
    definitionFor: (name) => getLocalComponentDefinition(name),
    validationFieldFor: () => ({ invalid: false }),
    validationHintFor: () => null,
    sourceAttributes: () => ({}),
    renderChildren: (nodes, visible) => render(nodes ?? [], visible),
    renderInline: (nodes, visible) => render(nodes ?? [], visible),
    renderToText: (nodes) => plainNodeText(options.runtime, nodes, t),
    report,
    targetId: () => undefined,
    anchorId: () => undefined,
    jumpAllowed: () => false,
    jumpTo: () => 'missing',
  };
  return createLocalComponentContext(options.node, environment);
}

/**
 * Render one legacy fixture node through the default manifest implementation.
 * Unknown names keep the previous `null` result.
 */
export function renderLegacyComponent(
  name: string,
  options: LegacyComponentAdapterOptions,
): ReactNode {
  const implementation = defaultViews().get(name);
  if (!implementation) return null;
  return createElement(implementation.render, createLegacyComponentContext(options));
}

export interface DataTableViewProps {
  node: LocalNode;
  visible: boolean;
  runtime: Pick<LocalRuntime, 'evaluate'>;
  t: Localize;
}

/**
 * Minimal runtime for fixture-only rendering. The view only needs
 * `evaluate`; everything else stays inert so no kernel state is touched.
 */
function fixtureRuntime(runtime: Pick<LocalRuntime, 'evaluate'>): LocalRuntime {
  return {
    get: () => null,
    set: () => [],
    setMany: () => [],
    evaluate: (expression: string) => runtime.evaluate(expression),
    snapshot: () => ({ revision: 0, state: {} }),
    validate: () => [],
    text: (template: string) => template,
    reset: () => {},
    resetToken: () => 0,
  } as unknown as LocalRuntime;
}

/** Compatibility wrapper around the actual public `<data-table>` view. */
export function DataTableView({ node, visible, runtime, t }: DataTableViewProps): ReactNode {
  return renderLegacyComponent('data-table', {
    node,
    runtime: fixtureRuntime(runtime),
    mode: 'interactive',
    visible,
    t,
    locale: t('en', 'zh') === 'zh' ? 'zh' : 'en',
    render: () => null,
  });
}
