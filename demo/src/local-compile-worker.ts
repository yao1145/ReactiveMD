import { compileLocal } from 'reactive-md';
import type { LocalCompileRequest, LocalCompileResponse } from './local-compile-scheduler';

interface WorkerScope {
  onmessage: ((event: MessageEvent<LocalCompileRequest>) => void) | null;
  postMessage(message: LocalCompileResponse): void;
}

const scope = self as unknown as WorkerScope;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || typeof request.id !== 'number' || typeof request.source !== 'string') return;

  const started = performance.now();
  try {
    const result = compileLocal(request.source);
    const duration = Math.max(0, Math.round(performance.now() - started));
    try {
      scope.postMessage({ id: request.id, ok: true, result, duration });
    } catch (error) {
      scope.postMessage({ id: request.id, ok: false, message: `Could not return the compile result: ${errorMessage(error)}` });
    }
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, message: errorMessage(error) });
  }
};
