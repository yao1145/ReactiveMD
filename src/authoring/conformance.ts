import type { EditorLocale } from '../editor/command-types';
import { compileLocal } from '../local/compiler';
import { readLocalConfig } from '../sdk/config';
import type { LocalConfig } from '../sdk/types';
import { createLocalComponentCatalog, insertLocalComponent } from './extensions';

/**
 * Insertion-template conformance for external components.
 *
 * Authoring templates are not compiled at registration time: a host may
 * declare a template before the component set (or its config) is final. This
 * helper performs the deferred check against the *same* configuration that
 * editing uses, so a catalog never offers a snippet that fails immediately.
 *
 * The compiler import is a normal static ESM binding in this dedicated module.
 * The compiler does not import authoring, so there is no module-initialization
 * cycle; keeping it out of `extensions.ts` also keeps plain catalog/completion
 * users from loading the compiler through that module.
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
  for (const entry of createLocalComponentCatalog(validated, locale)) {
    if (!external.has(entry.name)) continue;
    // Validate the exact insertion output: binding tokens and selection/caret
    // markers are resolved by the same pipeline the editor uses.
    const edit = insertLocalComponent(validated, entry.id, '', { start: 0, end: 0 }, locale);
    const result = compileLocal(edit.value, { config: validated });
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
