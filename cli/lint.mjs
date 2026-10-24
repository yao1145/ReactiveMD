import { compareDiagnostics, compareText, diagnosticToJson, displayPath, formatDiagnostic } from './document.mjs';
import { CliError, EXIT, errorText } from './errors.mjs';
import { readTextFile } from './fs-utils.mjs';
import { expandLintInputs } from './glob.mjs';
import { loadCore } from './package.mjs';

/**
 * `reactive-md lint`
 * @param {{inputs: string[], json: boolean, strict: boolean}} options
 * @param {{packageRoot: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream}} context
 */
export async function runLint(options, context) {
  const { packageRoot, stdout } = context;
  const files = await expandLintInputs(options.inputs);
  const core = await loadCore(packageRoot, ['compileLocal']);

  /** @type {{file: string, display: string, ok: boolean, diagnostics: any[]}[]} */
  const entries = [];
  let hasError = false;
  let hasWarning = false;

  for (const file of files) {
    const label = displayPath(file);
    const source = await readTextFile(file, {
      label: 'Cannot read document',
      exitCode: EXIT.IO,
    });

    let compiled;
    try {
      compiled = core.compileLocal(source);
    } catch (error) {
      throw new CliError(
        `The compiler failed on "${label}": ${errorText(error)}`,
        EXIT.DOCUMENT,
        { cause: error },
      );
    }
    if (!compiled || typeof compiled !== 'object' || !Array.isArray(compiled.diagnostics)) {
      throw new CliError(
        `The core build returned an invalid compile result for "${label}". Run "npm run build" again.`,
        EXIT.DOCUMENT,
      );
    }

    const diagnostics = compiled.diagnostics.slice().sort(compareDiagnostics);
    const errors = diagnostics.filter((diagnostic) => diagnostic?.severity === 'error');
    const warnings = diagnostics.filter((diagnostic) => diagnostic?.severity === 'warning');
    const compileFailed = compiled.ok !== true;
    if (compileFailed || errors.length > 0) hasError = true;
    if (warnings.length > 0) hasWarning = true;
    const ok = !compileFailed
      && errors.length === 0
      && (!options.strict || warnings.length === 0);

    entries.push({ file, display: label, ok, diagnostics });
  }

  entries.sort((a, b) => compareText(a.display, b.display));

  if (options.json) {
    const report = {
      version: 1,
      files: entries.map((entry) => ({
        file: entry.display,
        ok: entry.ok,
        diagnostics: entry.diagnostics.map(diagnosticToJson),
      })),
    };
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const entry of entries) {
      for (const diagnostic of entry.diagnostics) {
        stdout.write(`${formatDiagnostic(entry.display, diagnostic)}\n`);
      }
    }
  }

  if (hasError) return EXIT.DOCUMENT;
  if (options.strict && hasWarning) return EXIT.DOCUMENT;
  return EXIT.OK;
}
