import type { Diagnostic } from '../local/types';

/** Build-side diagnostics use the same shape as compile and export diagnostics. */
export function buildDiagnostic(code: string, message: string): Diagnostic {
  return {
    code,
    message,
    severity: 'error',
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

function summary(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .slice(0, 12)
    .map((item) => `[${item.code}] ${item.message.length > 400 ? `${item.message.slice(0, 400)}…` : item.message}`)
    .join('\n');
}

/** Thrown by the Node build adapter; carries every preflight/build diagnostic. */
export class LocalBuildError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[] = []) {
    super(diagnostics.length === 0 ? message : `${message}\n${summary(diagnostics)}`);
    this.name = 'LocalBuildError';
    this.diagnostics = Object.freeze(diagnostics.slice());
  }
}
