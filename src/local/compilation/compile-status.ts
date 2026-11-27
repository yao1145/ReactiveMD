import type { LocalCompileResult } from '../types';

export function compileTraceStatus(result: LocalCompileResult): 'ok' | 'budget-rejected' | 'failed' {
  if (result.ok) return 'ok';
  return result.diagnostics.some(item => item.severity === 'error' && (item.phase === 'resource' || item.code.startsWith('local.budget')))
    ? 'budget-rejected' : 'failed';
}
