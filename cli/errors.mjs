/**
 * CLI exit codes. They are also printed by `reactive-md --help`.
 *
 * 0 success
 * 2 usage or argument error
 * 3 document compile/render/React/artifact error
 * 4 input or output file I/O error
 * 5 asset or security policy error
 */
export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 2,
  DOCUMENT: 3,
  IO: 4,
  ASSET: 5,
});

/**
 * An operational CLI failure. `reported` means diagnostics were already written
 * to stderr, so the entry point should only set the exit code.
 */
export class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode]
   * @param {{cause?: unknown, reported?: boolean}} [options]
   */
  constructor(message, exitCode = EXIT.DOCUMENT, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.reported = options.reported === true;
  }
}

/** @param {string} message */
export function usageError(message) {
  return new CliError(message, EXIT.USAGE);
}

/** @param {unknown} error */
export function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build a one-line filesystem error that still names the path and the OS code.
 * @param {string} action
 * @param {string} filePath
 * @param {unknown} error
 * @param {number} [exitCode]
 */
export function fsFailure(action, filePath, error, exitCode = EXIT.IO) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : 'ERROR';
  const detail = errorText(error);
  return new CliError(`${action} "${filePath}": ${code}${detail ? ` (${detail})` : ''}`, exitCode, {
    cause: error,
  });
}
