/**
 * Result adaptation for the single-pass compiler entries.
 *
 * The semantic pass still produces `LocalCompileResult`. This module is the
 * only place that maps it to the public `CompileResult` union: it determines
 * `valid` / `recovered` / `failed`, keeps the task-one `ok` and `document`
 * aliases, and publishes the program as an independent, iteratively frozen
 * plain-data snapshot. It never creates a runtime, session, worker, timer or
 * cache.
 */
import type { LocalCompileResult, LocalDocument, LocalRecovery } from '../local/contracts/types';
import { plainCompiledData } from '../local/transport/compiled-data';
import type { CheckCoverage, CompileResult, Program } from './types';

/** Optional-check coverage used by the minimal compiler. */
export const MINIMAL_CHECKS: CheckCoverage = Object.freeze({ optional: Object.freeze([]) });

/** Optional-check coverage used by the standard compiler. */
export const STANDARD_CHECKS: CheckCoverage = Object.freeze({
  optional: Object.freeze([Object.freeze({ id: 'math-display', version: '1' })]),
});

/**
 * Freeze a plain compiler value without recursion. The stack is explicit so a
 * deeply nested document cannot exhaust the call stack, and a `Set` guards
 * against accidental cycles.
 */
export function freezeProgram<T>(value: T): T {
  const seen = new Set<object>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    const object = current as object;
    if (seen.has(object)) continue;
    seen.add(object);
    Object.freeze(object);
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index += 1) pending.push(object[index]);
    } else {
      for (const key of Object.keys(object)) {
        pending.push((object as Record<string, unknown>)[key]);
      }
    }
  }
  return value;
}

/** One recovery list, plain and independent from parser-owned arrays. */
function plainRecoveries(recoveries: readonly LocalRecovery[] | undefined): readonly LocalRecovery[] {
  return recoveries ? plainCompiledData([...recoveries]) : [];
}

/**
 * Adapt one semantic-pass result. Author-source errors become `failed`; a
 * successful pass is `recovered` only when the parser actually recorded a
 * repair. Recoveries never upgrade a failure, so unrelated semantic errors
 * keep their `failed` status. Internal exceptions are not caught here and
 * cannot be reported as recoveries by construction.
 */
export function toCompileResult(result: LocalCompileResult, checks: CheckCoverage): CompileResult {
  const diagnostics = plainCompiledData(result.diagnostics);
  const recoveries = plainRecoveries(result.recoveries);
  if (!result.ok) {
    return { ok: false, status: 'failed', diagnostics, recoveries };
  }
  // `program` is the publication copy: independent from the compiler-owned
  // document and frozen for every holder.
  const sourceDocument = result.document;
  const program = freezeProgram(plainCompiledData(sourceDocument)) as Program;
  // `document` stays the mutable plain-data alias task-one consumers read. It
  // is materialized only when requested, so program-only consumers pay one
  // document copy instead of two while both fields stay independent.
  let documentCopy: LocalDocument | undefined;
  return {
    ok: true,
    status: recoveries.length > 0 ? 'recovered' : 'valid',
    get document(): LocalDocument {
      documentCopy ??= plainCompiledData(sourceDocument);
      return documentCopy;
    },
    program,
    diagnostics,
    recoveries,
    checks,
  };
}
