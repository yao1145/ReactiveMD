import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import type { Diagnostic } from '../../../local/types';
import { SharedComponentLoader, type LocalReactTraceContext } from '../../component-loader';
import { localize } from '../../localization';
import { RenderLifecycle } from '../../render-lifecycle';
import type { LocalStaticExternalSlot } from './view-render-context';

type SlotComponent = ComponentType<LocalStaticExternalSlot>;
export type LocalStaticExternalResolver = (input: { readonly name: string; readonly signal: AbortSignal }) => SlotComponent | null | PromiseLike<SlotComponent | null>;

const loaders = new WeakMap<LocalStaticExternalResolver, SharedComponentLoader<{ name: string }, SlotComponent>>();

type Report = (diagnostics: Diagnostic[]) => void;
type Position = Pick<Diagnostic, 'line' | 'column'>;

export function StaticExternalSlot({ slot, render, resolver, trace, report, position }: {
  slot: LocalStaticExternalSlot;
  render?: (slot: LocalStaticExternalSlot) => ReactNode;
  resolver?: LocalStaticExternalResolver;
  trace?: LocalReactTraceContext;
  report?: Report;
  position?: () => Position;
}) {
  const content = render?.(slot);
  if (content != null) return content;
  if (resolver) return <DeferredExternalSlot slot={slot} resolver={resolver} trace={trace} report={report} position={position} />;
  return <span data-rmd-external-slot={slot.name}>{localize(slot.locale, 'Content unavailable', '内容暂不可用')}</span>;
}

function DeferredExternalSlot({ slot, resolver, trace, report, position }: {
  slot: LocalStaticExternalSlot; resolver: LocalStaticExternalResolver; trace?: LocalReactTraceContext; report?: Report; position?: () => Position;
}) {
  let loader = loaders.get(resolver);
  if (!loader) {
    loader = new SharedComponentLoader(resolver, definition => definition.name, (_definition, component) => typeof component === 'function' ? component : null);
    loaders.set(resolver, loader);
  }
  const definition = useMemo(() => ({ name: slot.name }), [slot.name]);
  const subscribe = useCallback((notify: () => void) => loader.subscribe(definition, notify, trace), [loader, definition, trace]);
  const snapshot = useCallback(() => loader.snapshot(definition), [loader, definition]);
  const state = useSyncExternalStore(subscribe, snapshot, loader.serverSnapshot);
  const reported = useRef(false);
  const loading = state.status === 'loading';
  const code = loading ? 'local.extension.load' : 'local.extension.load-failed';
  const message = loading ? localize(slot.locale, 'Loading component…', '正在加载组件…')
    : localize(slot.locale, 'The component could not be loaded.', '组件加载失败。');
  useEffect(() => {
    if (state.status !== 'failed') { reported.current = false; return; }
    if (reported.current || !report || !position) return;
    reported.current = true;
    report([{ code, message, messageKey: code, severity: 'warning', range: slot.range, ...position(), phase: 'host', recoverable: true }]);
  }, [state.status, report, code, message, slot.range, position]);
  if (state.status === 'ready') return <>
    {trace?.observer?.onTrace && <RenderLifecycle trace={trace} component={definition} />}
    <state.component {...slot} />
  </>;
  return <span data-rmd-external-slot={slot.name} data-rmd-component-load={state.status} role="status">
    {message}{!loading && <button type="button" onClick={() => loader.retry(definition, trace)}>{localize(slot.locale, 'Retry', '重试')}</button>}
  </span>;
}
