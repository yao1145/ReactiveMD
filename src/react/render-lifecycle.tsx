import React, { useEffect, useRef } from 'react';
import { createLocalTraceId, emitLocalTrace } from '../local/observability-core';
import type { LocalComponentDefinition } from '../sdk/types';
import type { LocalReactTraceContext } from './component-loader';

/** Emit effect setup and cleanup for a mounted document or component. */
export function RenderLifecycle({ trace, component }: { trace: LocalReactTraceContext; component?: LocalComponentDefinition }) {
  const current = useRef(trace);
  current.current = trace;
  useEffect(() => {
    const context = current.current;
    if (!context.observer?.onTrace) return;
    const traceId = context.traceId ?? createLocalTraceId();
    const environment = typeof React.captureOwnerStack === 'function' ? 'development' : 'production';
    const started = globalThis.performance?.now() ?? Date.now();
    const identity = { traceId, environment, componentName: component?.name, componentVersion: component?.version } as const;
    emitLocalTrace(context.observer, { ...identity, type: 'render-mount', timestamp: Date.now(),
      documentId: context.documentId, sourceRevision: context.sourceRevision });
    return () => {
      const latest = current.current;
      const durationMs = Math.max(0, Math.round((globalThis.performance?.now() ?? Date.now()) - started));
      emitLocalTrace(context.observer, { ...identity, type: 'render-unmount', timestamp: Date.now(), durationMs,
        documentId: latest.documentId, sourceRevision: latest.sourceRevision });
    };
  }, [trace.observer, component]);
  return null;
}
