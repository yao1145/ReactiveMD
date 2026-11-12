import { useEffect, useLayoutEffect, type RefObject } from 'react';

/*
 * Tooltips use the top layer instead of a portal. A popover is rendered outside
 * every ancestor's overflow/transform/contain clip without leaving the DOM, so
 * the bubble keeps the document's theme tokens, density, colour scheme, author
 * selectors and print rules, and each document stays isolated in its own tree.
 */

type PopoverElement = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Layout effect that stays silent during server rendering. */
export const useTooltipLayoutEffect = useIsoLayoutEffect;

function isPopoverOpen(element: Element): boolean {
  try {
    return element.matches(':popover-open');
  } catch {
    return false;
  }
}

/**
 * Keeps a `popover="manual"` bubble in the top layer while `open`. Bubbles are
 * positioned by the caller, so nothing but the clip changes. Closing waits for
 * the fade-out so the bubble does not drop back into a clipped ancestor mid
 * transition. Engines without the Popover API keep the inline presentation.
 */
export function useTooltipPopover(
  bubbleRef: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useIsoLayoutEffect(() => {
    const bubble = bubbleRef.current as PopoverElement | null;
    if (!bubble?.showPopover) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (open) {
        if (!isPopoverOpen(bubble)) bubble.showPopover();
      } else if (isPopoverOpen(bubble)) {
        timer = setTimeout(() => {
          try {
            bubble.hidePopover?.();
          } catch {
            /* The element may have left the document by now. */
          }
        }, 200);
      }
    } catch {
      /* A detached or unsupported element keeps the inline presentation. */
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [bubbleRef, open]);
}
