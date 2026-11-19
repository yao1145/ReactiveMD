import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LocalSubmissionFieldCheck } from '../local/contracts/types';
import type { LocalComponentContext } from './component-api';
import { useResetToken } from './component-utils';

/** Keep only committed field constraints in the runtime's submission checks. */
export function useSubmissionField(context: LocalComponentContext, check: LocalSubmissionFieldCheck): void {
  const latest = useRef(check);
  useLayoutEffect(() => { latest.current = check; });
  const { runtime, mode, content } = context;
  const binding = content.attrs.bind;
  useLayoutEffect(() => {
    if (mode === 'static' || binding === undefined) return;
    return runtime.registerSubmissionField?.(content, value => latest.current(value));
    // The registration is scoped to the runtime, node and binding across renders.
  }, [runtime.identity, content.id, binding, mode]);
}

/**
 * Editable draft state shared by text-like controls. The draft follows the
 * bound display value while the field is neither focused nor composing; a
 * subtree reset restores the latest display value and clears field state.
 */
export function useDraftField(
  context: LocalComponentContext,
  display: string,
  clearWriterError: (value: null) => void,
) {
  const [draft, updateDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const pendingDraft = useRef<string | undefined>(undefined);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) {
        pendingDraft.current = undefined;
        updateDraft(display);
      }
    }
  }, [display, focused]);

  useResetToken(context, () => {
    composing.current = false;
    pendingDraft.current = undefined;
    updateDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    clearWriterError(null);
  });

  return {
    draft,
    focused,
    touched,
    draftError,
    composing,
    pendingDraft,
    setDraft(value: string) {
      pendingDraft.current = value;
      updateDraft(value);
    },
    setFocused,
    setTouched,
    setDraftError,
  };
}
