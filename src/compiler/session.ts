/**
 * Incremental compile session entry.
 *
 * `reactive-md/compiler/session` exposes the stateful compile path for hosts
 * that keep one session per document: compile a snapshot, reuse unchanged
 * Markdown blocks across edits and dispose the session when the document goes
 * away. The session owns parser caches and the standard compile assembly, but
 * it creates no Worker, loads no React, theme implementation, CSS, or authoring
 * service/catalog modules, and performs no DOM access. The standard assembly
 * may carry preset authoring data such as localized titles and insertion text.
 *
 * This facade re-exports the existing implementation. It adds no logic and
 * does not depend on `reactive-md/compiler`, `reactive-md/compiler/standard`,
 * `reactive-md/authoring` or the root entry.
 */
export { createLocalCompileSession, LocalCompileSession } from '../local/compilation/session/incremental';
export type { LocalIncrementalStats } from '../local/compilation/session/incremental';
export { localCompileOptionsKey } from '../assemblies/default-options';
export { localCompileCacheKey, type LocalCompileCacheKeyOptions } from '../assemblies/compile-cache-key';
