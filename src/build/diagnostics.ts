import type { Diagnostic } from '../local/types';
import { localCodeUnitPrefix } from '../local/source/source-context';

/** Build-side diagnostics use the same shape as compile and export diagnostics. */
export function buildDiagnostic(
  code: string,
  message: string,
  structured?: Readonly<Record<string, string | number | boolean>>,
): Diagnostic {
  const resource = structured && Object.hasOwn(structured, 'budget');
  return {
    code,
    message,
    severity: 'error',
    ...(resource ? { phase: 'resource' as const, recoverable: true, messageKey: 'local.resource.budget', details: structured } : { phase: 'host' as const, recoverable: false }),
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

function summary(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .slice(0, 12)
    .map((item) => `[${item.code}] ${item.message.length > 400 ? `${localCodeUnitPrefix(item.message, 400)}…` : item.message}`)
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
