/**
 * Read-only source scan entry.
 *
 * `reactive-md/scan` exposes `analyzeLocalSource` with its read-only result
 * types. The analysis reports tags, attributes, interpolation expressions,
 * binding declarations/references and diagnostics with UTF-16 source ranges,
 * so a host can draw its own markers from the same offsets the parser and
 * compiler use.
 *
 * The entry returns data only. It offers no completion, rename, formatting,
 * template insertion, catalog or editor commands; those stay in
 * `reactive-md/authoring`. It loads no React, CSS or Worker code.
 */
export { analyzeLocalSource } from '../local/source/authoring';
export type { AuthorAnalysis, AuthorBinding, AuthorToken } from '../local/source/authoring';