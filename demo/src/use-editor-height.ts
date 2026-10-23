import { useLayoutEffect, type RefObject } from 'react';

const MIN_EDITOR_HEIGHT = 360;
const VIEWPORT_GAP = 24;
const DESKTOP_MIN_WIDTH = 980;

// Measure from the document offset so scrolling never changes the height.
export function useEditorHeight(
  frameRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  deps: readonly unknown[],
) {
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      if (!enabled || window.innerWidth <= DESKTOP_MIN_WIDTH) {
        frame.style.removeProperty('height');
        return;
      }
      const top = frame.getBoundingClientRect().top + window.scrollY;
      const height = Math.max(MIN_EDITOR_HEIGHT, window.innerHeight - top - VIEWPORT_GAP);
      frame.style.height = `${Math.round(height)}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    document.fonts?.ready.then(apply).catch(() => {});
    return () => {
      cancelled = true;
      window.removeEventListener('resize', apply);
    };
  }, [frameRef, enabled, ...deps]);
}
