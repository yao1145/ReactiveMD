import { readLocalCompileOptions } from './options';
import type { LocalCompileOptions } from './types';
import { readLocalConfig } from '../sdk/config';

/** Copy only validated, serializable compile semantics into a portable payload. */
export function portableCompileOptions(input?: LocalCompileOptions): LocalCompileOptions | undefined {
  if (input === undefined) return undefined;
  const check = readLocalCompileOptions(input);
  if (!check.ok) throw new TypeError(`Invalid portable compile options: ${check.message}`);
  const output: LocalCompileOptions = {
    enableCss: check.html.enableCss,
    enableJavaScript: check.html.enableJavaScript,
    enableExtendedHtml: check.html.enableExtendedHtml,
    ...(input.markdownBreaks === undefined ? {} : { markdownBreaks: check.markdownBreaks }),
    ...(input.config === undefined
      ? check.hostComponents.length ? { hostComponents: check.hostComponents } : {}
      : { config: readLocalConfig(input.config) }),
    ...(input.limits === undefined ? {} : {
      limits: {
        ...(input.limits.maxSyntaxNodes === undefined ? {} : { maxSyntaxNodes: check.maxSyntaxNodes }),
        ...(input.limits.maxParseWork === undefined ? {} : { maxParseWork: check.maxParseWork }),
        ...(input.limits.maxMarkdownDepth === undefined ? {} : { maxMarkdownDepth: check.maxMarkdownDepth }),
      },
    }),
  };
  return output;
}
