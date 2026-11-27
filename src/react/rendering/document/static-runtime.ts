import type { LocalDocument, LocalRuntime, LocalSnapshot, LocalValue } from '../../../local/types';

/**
 * Read-only runtime projection for a compiler-proven static document.
 *
 * Static components receive the same public context as interactive renders,
 * but there is no expression evaluation, binding write, subscription or timer
 * behind it. Reads resolve to the document's initial state; any operation that
 * would require live runtime state throws so a misclassified document fails
 * visibly instead of rendering a stale or invented value.
 */
export function createStaticRuntime(document: LocalDocument): LocalRuntime {
  const state = Object.freeze({ ...document.initialState }) as Readonly<Record<string, LocalValue>>;
  const readOnly = (): never => {
    throw new Error('Static rendering has no writable runtime state.');
  };
  return Object.freeze({
    document,
    snapshot: (): LocalSnapshot => ({ revision: 0, state }),
    get: () => null,
    set: readOnly,
    setMany: readOnly,
    parameterNames: () => Object.freeze(Object.keys(document.bindings ?? {})),
    getParameter: (name: string) => state[name],
    getParameters: () => state,
    readSubmissionFields: (fields: readonly string[]) => ({ ok: false as const, field: fields[0] ?? '', reason: 'unavailable' as const }),
    registerSubmissionField: () => () => {},
    setParameter: readOnly,
    setParameters: readOnly,
    getExternal: () => undefined,
    getExternalValues: () => Object.freeze({}),
    setExternalValues: readOnly,
    evaluate: (): never => {
      throw new Error('Static rendering does not evaluate expressions.');
    },
    validate: () => [],
    text: (template: string) => template,
    reset: readOnly,
    resetToken: () => 0,
    subscribe: () => () => {},
    dispose: () => {},
  });
}