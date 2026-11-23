import type { Diagnostic } from './types';

export interface LocalTraceEvent {
  readonly type: 'compile-start' | 'compile-end' | 'worker-request' | 'worker-response'
    | 'worker-timeout' | 'worker-stale-response' | 'worker-cancel' | 'worker-error'
    | 'export-start' | 'export-end' | 'export-error';
  readonly traceId: string;
  readonly requestId?: number;
  readonly sourceRevision?: number;
  readonly timestamp: number;
  readonly durationMs?: number;
  readonly code?: string;
  readonly status?: string;
  readonly stage?: string;
}

export interface LocalObserver {
  onDiagnostic?: (diagnostic: Diagnostic) => void;
  onTrace?: (event: LocalTraceEvent) => void;
}

export function createLocalTraceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `rmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emitLocalTrace(observer: LocalObserver | undefined, event: LocalTraceEvent): void {
  try { observer?.onTrace?.({ ...event }); } catch { /* Isolate host callbacks. */ }
}

export function emitLocalDiagnostic(observer: LocalObserver | undefined, diagnostic: Diagnostic): void {
  if (!observer?.onDiagnostic) return;
  const phase = diagnostic.phase ?? (
    diagnostic.code.startsWith('local.budget') ? 'resource'
      : diagnostic.code.startsWith('local.parse') || diagnostic.code.startsWith('local.tag') || diagnostic.code.startsWith('local.html') ? 'parse'
        : diagnostic.code.startsWith('local.runtime') ? 'runtime'
          : diagnostic.code.startsWith('local.worker') ? 'worker'
            : diagnostic.code.startsWith('local.export') ? 'export'
              : diagnostic.code.startsWith('host.') ? 'host' : 'semantic'
  );
  const copy = {
    ...diagnostic,
    phase,
    recoverable: diagnostic.recoverable ?? diagnostic.severity === 'warning',
    ...(diagnostic.range ? { range: { ...diagnostic.range } } : {}),
    ...(diagnostic.params ? { params: { ...diagnostic.params } } : {}),
    ...(diagnostic.details ? { details: { ...diagnostic.details } } : {}),
  };
  try { observer.onDiagnostic(copy); } catch { /* Isolate host callbacks. */ }
}
