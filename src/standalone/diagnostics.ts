import type { Diagnostic } from '../local/types';

/** Build a host-level diagnostic for payload, fetch and mount failures. */
export function standaloneDiagnostic(code: string, message: string): Diagnostic {
  return {
    code,
    message,
    severity: 'error',
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

/** Human-readable text used inside thrown errors and the alert fallback. */
export function formatStandaloneDiagnostics(
  diagnostics: readonly Diagnostic[],
  limit = 8,
): string {
  const shown = diagnostics.slice(0, limit).map((item) => (
    `- [${item.code}] ${item.message} (line ${item.line}, column ${item.column})`
  ));
  if (diagnostics.length > shown.length) {
    shown.push(`- ${diagnostics.length - shown.length} more diagnostic(s).`);
  }
  return shown.join('\n');
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Thrown by `mount`/`prepareStandaloneDocument` before any content is mounted.
 * The message embeds the diagnostics; the array is also available programmatically.
 */
export class ReactiveMDMountError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[]) {
    const details = formatStandaloneDiagnostics(diagnostics);
    super(details ? `${message}\n${details}` : message);
    this.name = 'ReactiveMDMountError';
    this.diagnostics = diagnostics;
  }
}

/** Recover a diagnostic list from a caught value, keeping unknown errors readable. */
export function diagnosticsFromError(error: unknown, fallbackCode = 'standalone.mount'): Diagnostic[] {
  if (
    error !== null
    && typeof error === 'object'
    && Array.isArray((error as { diagnostics?: unknown }).diagnostics)
  ) {
    const diagnostics = (error as { diagnostics: Diagnostic[] }).diagnostics;
    if (diagnostics.length > 0) return diagnostics;
  }
  return [standaloneDiagnostic(fallbackCode, errorText(error))];
}
