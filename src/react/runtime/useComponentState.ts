import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalComponentContext } from '../component-api';
import type { LocalComponentStateSaveResult } from '../../runtime-services/component-state';

export interface UseComponentStateOptions<T> {
  /** Used when no valid saved state exists. Called once per mounted instance. */
  initial: () => T;
  /** Reject states that do not match the current shape. */
  validate?: (value: unknown) => value is T;
  /** Monotonic state version owned by the component. Defaults to 0. */
  version?: number;
  /** Save on every `setValue`. Defaults to false: saving stays explicit. */
  autoSave?: boolean;
}

export interface UseComponentStateResult<T> {
  value: T;
  setValue(next: T): void;
  /** Persist the current or supplied value. */
  save(next?: T): LocalComponentStateSaveResult;
  /** Delete the saved progress without changing the current in-memory value. */
  clear(): void;
  loaded: boolean;
  error: string | null;
}

/**
 * Restore and explicitly save one component's state.
 *
 * Invalid, missing or version-mismatched records are skipped. They never
 * prevent the rest of the document from rendering. `runtime.reset` restores
 * the in-memory initial value; `clear()` separately deletes saved progress.
 */
export function useComponentState<T>(
  context: LocalComponentContext,
  options: UseComponentStateOptions<T>,
): UseComponentStateResult<T> {
  const handle = context.services.state;
  const version = options.version ?? 0;
  const initialRef = useRef(options.initial);
  initialRef.current = options.initial;
  const validateRef = useRef(options.validate);
  validateRef.current = options.validate;
  const reportRef = useRef(context.report);
  reportRef.current = context.report;
  const loadedRef = useRef(false);
  const initialErrorRef = useRef<string | null>(null);

  const [value, setValueState] = useState<T>(() => {
    const record = handle.load();
    if (record !== null) {
      if (record.component !== handle.component) {
        initialErrorRef.current = `Saved state belongs to component "${record.component}", not "${handle.component}".`;
      } else if (record.stateVersion !== version) {
        initialErrorRef.current = `Saved state version ${record.stateVersion} is not supported (expected ${version}).`;
      } else if (validateRef.current !== undefined && !validateRef.current(record.data)) {
        initialErrorRef.current = 'Saved state does not match the current component shape.';
      } else {
        loadedRef.current = true;
        return record.data as T;
      }
    }
    return initialRef.current();
  });
  const [error, setError] = useState<string | null>(initialErrorRef.current);
  const resetRef = useRef(context.resetToken);

  useEffect(() => {
    if (resetRef.current === context.resetToken) return;
    resetRef.current = context.resetToken;
    const next = initialRef.current();
    setValueState(next);
    setError(null);
    loadedRef.current = false;
    if (options.autoSave === true) {
      const result = handle.save(next, { version });
      if (!result.ok) {
        const message = result.diagnostics.map((item) => item.message).join('; ');
        setError(message);
        try {
          reportRef.current(result.diagnostics);
        } catch {
          // Reporting must not break the component.
        }
      }
    }
  }, [context.resetToken, handle, version, options.autoSave]);

  useEffect(() => {
    const message = initialErrorRef.current;
    if (message === null) return;
    initialErrorRef.current = null;
    try {
      reportRef.current([{
        code: 'local.runtime.state.restore',
        message,
        severity: 'error',
        range: { ...context.content.range },
        line: 1,
        column: 1,
      }]);
    } catch {
      // Reporting must not break the component.
    }
  }, [context.content.range]);

  const save = useCallback((next?: T): LocalComponentStateSaveResult => {
    const result = handle.save(next === undefined ? value : next, { version });
    if (result.ok) {
      setError(null);
    } else {
      const message = result.diagnostics.map((item) => item.message).join('; ');
      setError(message);
      try {
        reportRef.current(result.diagnostics);
      } catch {
        // Reporting must not break the component.
      }
    }
    return result;
  }, [handle, value, version]);

  const clear = useCallback((): void => {
    handle.clear();
    setError(null);
  }, [handle]);

  const setValue = useCallback((next: T): void => {
    setValueState(next);
    if (options.autoSave === true) {
      const result = handle.save(next, { version });
      if (!result.ok) {
        setError(result.diagnostics.map((item) => item.message).join('; '));
        try {
          reportRef.current(result.diagnostics);
        } catch {
          // Reporting must not break the component.
        }
      }
    }
  }, [handle, options.autoSave, version]);

  return {
    value,
    setValue,
    save,
    clear,
    loaded: loadedRef.current,
    error,
  };
}
