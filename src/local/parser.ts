import type { LocalCompileOptions } from './types';
import { MAX_LOCAL_DOCUMENT_LENGTH } from './limits';
import type { LocalOptionCheck } from './options-core';
import { readLocalCompileOptions } from './options';
import { parseLocalCore, type ParsedLocal, type ParserWork } from './parser-core';
import type { SourceContext } from './source-context';
import type { ParseSessionCache } from './parse-budget';
import type { InlinePlanLookup } from './fast-markdown';

export type { ParsedLocal, ParserWork } from './parser-core';

/**
 * Compatibility facade for the pure kernel. Host options are read and
 * validated here; the kernel itself never imports options, SDK config, the
 * schema registry or theme implementations.
 *
 * Source validation still precedes option validation: the kernel checks the
 * source first and returns `local.parse`/`local.budget` for it. The
 * placeholder option check below is therefore never inspected.
 */
export function parseLocal(
  source: string,
  options?: LocalCompileOptions,
  context?: SourceContext,
  cache?: ParseSessionCache,
  rowPlans?: InlinePlanLookup,
): ParsedLocal {
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    return parseLocalCore(source, undefined as unknown as LocalOptionCheck, context, cache, rowPlans);
  }
  return parseLocalCore(source, readLocalCompileOptions(options), context, cache, rowPlans);
}
