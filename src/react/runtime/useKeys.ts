import { useEffect, useRef, type RefObject } from 'react';

export interface LocalKeyOptions {
  readonly disabled?: boolean;
  /** Ignore events originating in form fields or editable regions. */
  readonly ignoreEditable?: boolean;
  /** `handled` prevents default only when a handler exists. */
  readonly preventDefault?: boolean | 'handled';
  readonly repeat?: boolean;
}

export type LocalKeyBindings = Readonly<Record<string, (event: KeyboardEvent) => void>>;

const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
].join(',');

export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return target.closest(EDITABLE_SELECTOR) !== null;
}

/**
 * Focus-scoped keyboard handling for one element. The hook never installs a
 * global listener and never prevents keys the component did not handle.
 */
export function useKeys(
  ref: RefObject<HTMLElement | null>,
  bindings: LocalKeyBindings,
  options?: LocalKeyOptions,
): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const disabled = options?.disabled ?? false;
  const ignoreEditable = options?.ignoreEditable ?? true;
  const preventDefault = options?.preventDefault ?? 'handled';
  const repeat = options?.repeat ?? false;

  useEffect(() => {
    const element = ref.current;
    if (element === null || disabled) return;
    const handler = (event: KeyboardEvent): void => {
      if (!repeat && event.repeat) return;
      if (ignoreEditable && isEditableTarget(event.target)) return;
      const direct = bindingsRef.current[event.key];
      const lower = event.key.length === 1 ? bindingsRef.current[event.key.toLowerCase()] : undefined;
      const run = direct ?? lower;
      if (run === undefined) return;
      if (preventDefault === true || preventDefault === 'handled') event.preventDefault();
      run(event);
    };
    element.addEventListener('keydown', handler);
    return () => element.removeEventListener('keydown', handler);
  }, [ref, disabled, ignoreEditable, preventDefault, repeat]);
}
