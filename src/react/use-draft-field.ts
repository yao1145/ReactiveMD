import { useEffect, useRef, useState } from 'react';
import type { LocalComponentContext } from './component-api';
import { useResetToken } from './component-utils';

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
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(context, () => {
    composing.current = false;
    setDraft(displayRef.current);
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
    setDraft,
    setFocused,
    setTouched,
    setDraftError,
  };
}
