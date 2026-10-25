import { compileLocal } from '../local/compiler';
import { parseLocalState, type LocalStateFile } from '../local/state';
import type { Diagnostic, LocalCompileOptions, LocalDocument } from '../local/types';
import { resolveLocalStateBaseline } from '../shareable';
import { ReactiveMDMountError, standaloneDiagnostic } from './diagnostics';

export interface PreparedStandaloneDocument {
  document: LocalDocument;
  /** Non-fatal compiler diagnostics already produced for this document. */
  diagnostics: Diagnostic[];
}

/**
 * Compile the source once and, when an exported state is supplied, rebase it
 * through `resolveLocalStateBaseline` so first render and Reset both start from
 * the shared values. Invalid source/state throws before anything is mounted.
 *
 * `theme` is an optional host-only override (used by `<reactive-md-doc theme>`):
 * it replaces the document-level theme on a shallow, immutable clone so the
 * source, nodes, bindings, digest and validated state stay intact.
 *
 * `compileOptions` replays the capability flags and limits an export was
 * created with; omitting them keeps the default ReactiveMD route.
 */
export function prepareStandaloneDocument(
  source: string,
  state?: LocalStateFile | string,
  theme?: string,
  compileOptions?: LocalCompileOptions,
): PreparedStandaloneDocument {
  if (typeof source !== 'string') {
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: source must be a string.',
      [standaloneDiagnostic('standalone.source', 'source must be a string.')],
    );
  }

  const compiled = compileLocal(source, compileOptions);
  if (!compiled.ok) {
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: the source contains syntax errors.',
      compiled.diagnostics,
    );
  }

  let document = compiled.document;

  if (state !== undefined) {
    const parsed = parseLocalState(state);
    if (!parsed.ok) {
      throw new ReactiveMDMountError(
        'Cannot mount a Reactive MD document: the state payload is invalid.',
        parsed.diagnostics,
      );
    }
    const baseline = resolveLocalStateBaseline(document, parsed.file);
    if (!baseline.ok) {
      throw new ReactiveMDMountError(
        'Cannot mount a Reactive MD document: the state does not match this source.',
        baseline.diagnostics,
      );
    }
    document = baseline.baseline.document;
  }

  if (typeof theme === 'string' && theme.trim().length > 0) {
    // Shallow clone: all content stays shared and immutable; only the theme
    // name changes for this host.
    document = { ...document, theme: theme.trim(), themeRange: undefined };
  }

  return { document, diagnostics: compiled.diagnostics.slice() };
}
