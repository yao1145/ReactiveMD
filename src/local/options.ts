import { DEFAULT_MAX_LOCAL_SYNTAX_NODES } from './limits';
import type { LocalCompileOptions, LocalHtmlPolicy } from './types';

/** Capability flags that select the temporary whole-document HTML branch. */
export const LOCAL_HTML_FLAGS = ['enableCss', 'enableJavaScript', 'enableExtendedHtml'] as const;

export type LocalHtmlFlag = (typeof LOCAL_HTML_FLAGS)[number];

export type LocalOptionCheck =
  | {
      ok: true;
      /** Validated syntax-node budget for this compilation. */
      maxSyntaxNodes: number;
      /** Effective HTML policy; every flag is false by default. */
      html: LocalHtmlPolicy;
      /** True when at least one capability flag is enabled. */
      htmlActive: boolean;
    }
  | { ok: false; message: string; key: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read and validate host compile options once. Every call site (Markdown
 * parser, HTML compiler, worker and React component) uses the same rules so a
 * malformed flag can never silently fall back to the Markdown pipeline.
 */
export function readLocalCompileOptions(options: LocalCompileOptions | undefined): LocalOptionCheck {
  if (options === undefined) {
    return {
      ok: true,
      maxSyntaxNodes: DEFAULT_MAX_LOCAL_SYNTAX_NODES,
      html: { enableCss: false, enableJavaScript: false, enableExtendedHtml: false },
      htmlActive: false,
    };
  }
  if (!isRecord(options)) {
    return { ok: false, message: 'Compile options must be an object.', key: 'local.options.invalid.object' };
  }

  const html: { enableCss: boolean; enableJavaScript: boolean; enableExtendedHtml: boolean } = {
    enableCss: false,
    enableJavaScript: false,
    enableExtendedHtml: false,
  };
  for (const flag of LOCAL_HTML_FLAGS) {
    if (!Object.hasOwn(options, flag)) continue;
    const value = options[flag];
    // An explicit `undefined` is the same as omitting the optional flag.
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      return {
        ok: false,
        message: `Compile option ${flag} must be a boolean.`,
        key: 'local.options.invalid.html-flag',
      };
    }
    html[flag] = value;
  }

  const limits = options.limits;
  let maxSyntaxNodes = DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (limits !== undefined) {
    if (!isRecord(limits)) {
      return { ok: false, message: 'Compile option limits must be an object.', key: 'local.options.invalid.limits' };
    }
    const value = limits.maxSyntaxNodes;
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        return {
          ok: false,
          message: 'Compile option limits.maxSyntaxNodes must be a positive safe integer.',
          key: 'local.options.invalid.max-syntax-nodes',
        };
      }
      maxSyntaxNodes = value;
    }
  }

  return {
    ok: true,
    maxSyntaxNodes,
    html,
    htmlActive: html.enableCss || html.enableJavaScript || html.enableExtendedHtml,
  };
}

/**
 * Stable signature of the option values that affect compilation. Used to
 * recompile on flag/limit changes and to keep worker races keyed by more than
 * the source text. Unknown keys are deliberately ignored.
 */
export function localCompileOptionsKey(options: LocalCompileOptions | undefined): string {
  if (options === undefined) return 'default';
  if (!isRecord(options)) return 'invalid';
  const flags = LOCAL_HTML_FLAGS.map((flag) => {
    if (!Object.hasOwn(options, flag)) return '-';
    const value = options[flag];
    if (value === undefined) return '-';
    if (value === true) return '1';
    if (value === false) return '0';
    return '!';
  }).join('');
  let maxSyntaxNodes = '';
  if (Object.hasOwn(options, 'limits')) {
    const limits = options.limits;
    if (limits === undefined) maxSyntaxNodes = 'default';
    else if (!isRecord(limits)) maxSyntaxNodes = 'invalid';
    else if (!Object.hasOwn(limits, 'maxSyntaxNodes') || limits.maxSyntaxNodes === undefined) maxSyntaxNodes = 'default';
    else maxSyntaxNodes = String(limits.maxSyntaxNodes);
  }
  return `${flags}:${maxSyntaxNodes}`;
}
