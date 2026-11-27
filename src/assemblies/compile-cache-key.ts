import { LOCAL_COMPILE_CACHE_VERSION } from '../local/compilation/cache-version';
import { readCompilerOptions } from '../local/configuration/options-core';
import { STANDARD_PARSER_CAPABILITIES } from '../local/parsing/parser-standard';
import type { LocalCompileOptions, LocalSourcePhase } from '../local/types';
import defaultPreset from '../presets/default';
import { localCompileOptionsKey, readLocalCompileOptions } from './default-options';

export interface LocalCompileCacheKeyOptions {
  /** The compiler entry that produces the cached result. Defaults to the session compiler. */
  readonly entry?: 'session' | 'local' | 'minimal' | 'standard';
  /** Overrides the phase in the compile options, as in the session and pool APIs. */
  readonly sourcePhase?: LocalSourcePhase;
  /** Optional version of the host's own compilation policy. */
  readonly policyVersion?: string;
}

/** Stable identity for a valid compile request. The opaque key contains the exact source. */
export function localCompileCacheKey(
  source: string,
  options?: LocalCompileOptions,
  identity: LocalCompileCacheKeyOptions = {},
): string {
  const { entry = 'session', sourcePhase, policyVersion } = identity;
  if (typeof source !== 'string') throw new TypeError('localCompileCacheKey requires a source string.');
  if (sourcePhase !== undefined && sourcePhase !== 'final' && sourcePhase !== 'streaming') {
    throw new TypeError('sourcePhase must be "streaming" or "final".');
  }
  const check = entry === 'minimal' ? readCompilerOptions(options)
    : entry === 'standard' ? readCompilerOptions(options, defaultPreset.components, STANDARD_PARSER_CAPABILITIES)
    : readLocalCompileOptions(options);
  if (!check.ok) throw new TypeError(check.message);
  const phase = sourcePhase ?? check.sourcePhase ?? (entry === 'session' ? 'legacy' : 'final');
  const legacySchemas = check.legacyHostNames.size ? check.hostComponents.map(({ props, ...schema }) => [
    schema, Object.keys(props).sort().map(name => [name, props[name]]),
  ]) : null;
  return JSON.stringify([
    LOCAL_COMPILE_CACHE_VERSION,
    entry, phase, policyVersion ?? null, check.componentConfigKey,
    localCompileOptionsKey(options), legacySchemas, source,
  ]);
}
