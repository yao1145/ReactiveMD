import type { EditorLocale } from '../editor/command-types';
import { compileLocal } from '../local/compiler';
import { readLocalConfig } from '../sdk/config';
import type { LocalConfig } from '../sdk/types';
import { createLocalComponentCatalogUnchecked, localCatalogParentContext } from './catalog';
import { insertCatalogEntryFromOptions } from './insert';

/**
 * Insertion-template conformance for external components.
 *
 * Authoring templates are not compiled at registration time: a host may
 * declare a template before the component set (or its config) is final. This
 * helper performs the deferred check against the *same* configuration that
 * editing uses, so a catalog never offers a snippet that fails immediately.
 *
 * Static compiler imports are shared with catalog validation. The compiler
 * does not import authoring, so this dependency has no initialization cycle.
 */

export interface LocalInsertTemplateIssue {
  readonly id: string;
  readonly name: string;
  readonly message: string;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

/** Compile every external catalog insertion template with `config`. */
export function validateLocalComponentInsertTemplates(
  config: LocalConfig,
  locale: EditorLocale = 'en',
): readonly LocalInsertTemplateIssue[] {
  const validated = readLocalConfig(config);
  const external = new Set(validated.components.map((component) => component.name));
  const issues: LocalInsertTemplateIssue[] = [];
  const options = { config: validated };
  const entries = createLocalComponentCatalogUnchecked(validated, locale);
  for (const entry of entries) {
    if (!external.has(entry.name)) continue;
    // Validate the exact insertion output: binding tokens and selection/caret
    // markers are resolved by the same pipeline the editor uses. Parent-only
    // children are checked inside the same legal parent context the catalog
    // uses, so a correctly registered child is not reported as broken.
    const text = insertCatalogEntryFromOptions(entry, options, '', { start: 0, end: 0 }).value;
    const context = localCatalogParentContext(entry, entries);
    const source = context === undefined ? text : `${context.before}${text}${context.after}`;
    const result = compileLocal(source, options);
    if (result.ok) continue;
    issues.push(Object.freeze({
      id: entry.id,
      name: entry.name,
      message: `Insert template for <${entry.name}> does not compile with this configuration.`,
      diagnostics: Object.freeze(result.diagnostics.map((diagnostic) => Object.freeze({
        code: diagnostic.code,
        message: diagnostic.message,
      }))),
    }));
  }
  return Object.freeze(issues);
}
