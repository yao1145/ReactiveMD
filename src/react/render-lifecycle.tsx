import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createLocalTraceId, emitLocalTrace } from '../local/observability-core';
import type { LocalComponentDefinition } from '../sdk/types';
import type { LocalReactTraceContext } from './component-loader';

const clock = () => globalThis.performance?.now() ?? Date.now();
const duration = (start: number, end: number) => Math.max(0, Math.round(end - start));

/** Emit effect setup and cleanup for a mounted document or component. */
export function RenderLifecycle({ trace, component }: { trace: LocalReactTraceContext; component?: Pick<LocalComponentDefinition, 'name'> & { version?: string } }) {
  const current = useRef(trace);
  current.current = trace;
  const renderedAt = trace.observer?.onTrace ? clock() : undefined;
  const previousPhase = useRef(trace.sourcePhase);
  const mountTraceId = useRef<string | undefined>(undefined);
  const layoutCleanupAt = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!trace.observer?.onTrace) return;
    return () => { layoutCleanupAt.current = clock(); };
  }, [trace.observer, component]);
  useEffect(() => {
    const context = current.current;
    if (!context.observer?.onTrace || renderedAt === undefined) return;
    const traceId = context.traceId ?? createLocalTraceId();
    mountTraceId.current = traceId;
    const environment = typeof React.captureOwnerStack === 'function' ? 'development' : 'production';
    const started = clock();
    const identity = { traceId, environment, componentName: component?.name, componentVersion: component?.version } as const;
    emitLocalTrace(context.observer, { ...identity, type: 'render-mount', timestamp: Date.now(),
      documentId: context.documentId, sourceRevision: context.sourceRevision, sourcePhase: context.sourcePhase,
      durationMs: duration(renderedAt, started) });
    return () => {
      const latest = current.current;
      const ended = clock();
      const mountedMs = duration(started, ended);
      const unmountMs = layoutCleanupAt.current === undefined ? undefined : duration(layoutCleanupAt.current, ended);
      layoutCleanupAt.current = undefined;
      emitLocalTrace(context.observer, { ...identity, traceId: latest.traceId ?? traceId, type: 'render-unmount', timestamp: Date.now(), mountedMs, durationMs: mountedMs,
        unmountMs, documentId: latest.documentId, sourceRevision: latest.sourceRevision, sourcePhase: latest.sourcePhase });
    };
  }, [trace.observer, component]);
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = trace.sourcePhase;
    if (previous !== 'streaming' || trace.sourcePhase !== 'final' || !trace.observer?.onTrace) return;
    emitLocalTrace(trace.observer, { type: 'render-retained', traceId: trace.traceId ?? mountTraceId.current ?? createLocalTraceId(),
      timestamp: Date.now(), environment: typeof React.captureOwnerStack === 'function' ? 'development' : 'production',
      documentId: trace.documentId, sourceRevision: trace.sourceRevision, sourcePhase: trace.sourcePhase,
      componentName: component?.name, componentVersion: component?.version });
  }, [trace, component]);
  return null;
}
