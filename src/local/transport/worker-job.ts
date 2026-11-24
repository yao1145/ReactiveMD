import type { LocalCompileOptions, LocalCompileResult } from '../types';
import { analyzeLocalSource, type AuthorAnalysis } from '../source/authoring';
import { MAX_LOCAL_HOST_COMPONENTS, MAX_LOCAL_HOST_ENUM_VALUES } from '../../contracts/limits';
import { LOCAL_HTML_FLAGS, localCompileOptionsKey } from '../../assemblies/default-options';
import { snapshotLocalConfig } from '../../assemblies/default-config';

/** Editors are coalesced for this long before a compile is dispatched. */
export const LOCAL_COMPILE_DELAY_MS = 150;

/**
 * Idle delay after a successful result before the worker asks the session to
 * prepare the next revision. A new request cancels the pending preparation.
 */
export const LOCAL_COMPILE_PREPARATION_DELAY_MS = 200;

/** Extra limits this transport snapshots before another module adds them. */
const LIMIT_KEYS = ['maxSyntaxNodes', 'maxParseWork', 'maxMarkdownDepth'] as const;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

// Budget failures must never start another parse. Successful documents carry
// the exact source and nodes already produced by this compile.
export function analyzeResult(source: string, options: LocalCompileOptions | undefined, result: LocalCompileResult): AuthorAnalysis {
  const empty:AuthorAnalysis={ tokens: [], bindings: [], diagnostics: [] };
  if (result.ok && result.document.source !== source) return empty;
  if (!result.ok && result.diagnostics.some(d=>d.code.startsWith('local.budget') || d.code.startsWith('local.options.'))) return empty;
  // A temporarily unknown binding must not blank the whole editor. Recover
  // syntax on this worker with the same limits, without another semantic compile.
  try { return analyzeLocalSource(source, options, { ...(result.ok ? {document:result.document} : {}), diagnostics: false }); }
  catch { return { tokens: [], bindings: [], diagnostics: [] }; }
}

/**
 * Clone host component schemas so a caller mutating its option object after
 * `schedule` cannot change an in-flight compile. Obviously invalid shapes pass
 * through unchanged for `readLocalCompileOptions` to report.
 */
function snapshotHostComponents(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  // The compiler rejects oversized arrays. Check before map() and replace the
  // array with a bounded marker so the worker message never clones it.
  if (value.length > MAX_LOCAL_HOST_COMPONENTS) return new Array<unknown>(MAX_LOCAL_HOST_COMPONENTS + 1);
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const source = entry as Record<string, unknown>;
    const clone: Record<string, unknown> = { ...source };
    const props = source.props;
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      clone.props = props;
      return clone;
    }
    const propsCopy: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(props as Record<string, unknown>)) {
      if (!prop || typeof prop !== 'object' || Array.isArray(prop)) {
        propsCopy[name] = prop;
        continue;
      }
      const propSource = prop as Record<string, unknown>;
      const propCopy: Record<string, unknown> = { ...propSource };
      if (Array.isArray(propSource.enum) && propSource.enum.length <= MAX_LOCAL_HOST_ENUM_VALUES) {
        propCopy.enum = [...propSource.enum];
      }
      propsCopy[name] = propCopy;
    }
    clone.props = propsCopy;
    return clone;
  });
}

/**
 * Copy the option values that affect routing, budgets and host components.
 * Invalid values are preserved so the compiler can report them; known keys are
 * snapshotted so a caller mutating its object after `schedule` cannot widen an
 * in-flight compile. `maxParseWork` and `maxMarkdownDepth` are copied even
 * before their declarations land, so a queued job keeps its own budget.
 */
export function snapshotCompileOptions(options: LocalCompileOptions | undefined): LocalCompileOptions | undefined {
  if (options === undefined) return undefined;
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) return options;
    const source = options as unknown as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const flag of LOCAL_HTML_FLAGS) {
      if (Object.hasOwn(source, flag)) copy[flag] = source[flag];
    }
    // Observers are host callbacks and must never cross the Worker boundary.
    if (Object.hasOwn(source, 'markdownBreaks')) {
      copy.markdownBreaks = source.markdownBreaks;
    }
    // The phase is not part of the compile identity, but the worker still
    // honors it when the host placed it on the options object.
    if (Object.hasOwn(source, 'sourcePhase')) {
      copy.sourcePhase = source.sourcePhase;
    }
    // Preserve the raw value, including invalid ones that the compiler must
    // report. Only an explicit `false` changes the recovery identity.
    if (Object.hasOwn(source, 'strict')) {
      copy.strict = source.strict;
    }
    if (Object.hasOwn(source, 'limits')) {
      const limits = source.limits;
      if (limits && typeof limits === 'object' && !Array.isArray(limits)) {
        const limitCopy: Record<string, unknown> = {};
        for (const key of LIMIT_KEYS) {
          if (Object.hasOwn(limits, key)) limitCopy[key] = (limits as Record<string, unknown>)[key];
        }
        copy.limits = limitCopy;
      } else {
        copy.limits = limits;
      }
    }
    if (Object.hasOwn(source, 'hostComponents')) {
      copy.hostComponents = snapshotHostComponents(source.hostComponents);
    }
    if (Object.hasOwn(source, 'config')) {
      // Revalidate into fresh frozen JSON so a caller mutating its config after
      // `schedule` cannot widen an in-flight compile. Invalid payloads pass
      // through for the compiler to report.
      copy.config = snapshotLocalConfig(source.config);
    }
    return copy as unknown as LocalCompileOptions;
  } catch {
    // A hostile getter is reported by the compiler itself; keep the original.
    return options;
  }
}

function limitsKeyPart(options: LocalCompileOptions | undefined): string {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return '';
    const limits = (options as unknown as Record<string, unknown>).limits;
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return '';
    const part = (key: string): string => {
      const record = limits as Record<string, unknown>;
      if (!Object.hasOwn(record, key) || record[key] === undefined) return '-';
      const value = record[key];
      return `${typeof value}:${String(value)}`;
    };
    return `:${part('maxParseWork')}:${part('maxMarkdownDepth')}`;
  } catch {
    return ':unreadable';
  }
}

function baseOptionsKey(options: LocalCompileOptions | undefined): string {
  const key = localCompileOptionsKey(options);
  if (key !== 'invalid') return key;
  // Different invalid payloads must still invalidate an in-flight result.
  try {
    return `invalid:${JSON.stringify(options)}`;
  } catch {
    return 'invalid';
  }
}

/**
 * Canonical job/transport signature. Extends the compiler's public key with
 * the newer per-compile budgets once they exist, without modifying options.ts.
 * Strict identity, including the recovery-strategy version for `strict:false`,
 * comes from `localCompileOptionsKey`; both sides key the same snapshot.
 */
export function localWorkerOptionsKey(options: LocalCompileOptions | undefined): string {
  return `${baseOptionsKey(options)}${limitsKeyPart(options)}`;
}
