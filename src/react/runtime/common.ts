import type { Diagnostic } from '../../local/contracts/types';
import type { LocalComponentContext } from '../component-api';

export function componentDiagnostic(
  context: LocalComponentContext,
  code: string,
  message: string,
): Diagnostic {
  return {
    code,
    message,
    severity: 'error',
    range: { ...context.content.range },
    line: 1,
    column: 1,
  };
}

export function reportError(
  context: LocalComponentContext,
  code: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  try {
    context.report([componentDiagnostic(context, code, message)]);
  } catch {
    // Error reporting must not break other document content.
  }
}
