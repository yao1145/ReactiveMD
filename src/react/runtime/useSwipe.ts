import { useEffect, useRef, type RefObject } from 'react';

export type LocalSwipeDirection = 'left' | 'right' | 'up' | 'down';
export type LocalSwipeAxis = 'horizontal' | 'vertical' | 'both';

export interface LocalSwipeOptions {
  readonly threshold?: number;
  readonly axis?: LocalSwipeAxis;
  /** Set `touch-action: none` on the target while mounted. */
  readonly preventScroll?: boolean;
  readonly disabled?: boolean;
  readonly pointerTypes?: readonly ('mouse' | 'pen' | 'touch')[];
}

export interface LocalSwipeHandlers {
  onSwipe(direction: LocalSwipeDirection, event: PointerEvent): void;
}

/**
 * Pure direction classifier. Exported so behavior can be tested without a DOM.
 * Returns null until the movement exceeds the threshold.
 */
export function classifySwipe(
  deltaX: number,
  deltaY: number,
  axis: LocalSwipeAxis = 'both',
  threshold = 24,
): LocalSwipeDirection | null {
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);
  if (Math.max(horizontal, vertical) < threshold) return null;
  if (axis === 'horizontal') {
    return horizontal >= vertical ? (deltaX < 0 ? 'left' : 'right') : null;
  }
  if (axis === 'vertical') {
    return vertical >= horizontal ? (deltaY < 0 ? 'up' : 'down') : null;
  }
  return horizontal >= vertical
    ? (deltaX < 0 ? 'left' : 'right')
    : (deltaY < 0 ? 'up' : 'down');
}

/**
 * Pointer/touch swipe recognition for one element.
 *
 * The hook owns recognition, cancellation, pointer capture and listener
 * cleanup. The component still owns the business action, scroll policy,
 * keyboard parity and accessible labels.
 */
export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  handlers: LocalSwipeHandlers,
  options?: LocalSwipeOptions,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const threshold = Math.max(1, options?.threshold ?? 24);
  const axis = options?.axis ?? 'both';
  const preventScroll = options?.preventScroll ?? false;
  const disabled = options?.disabled ?? false;
  const pointerTypes = options?.pointerTypes;
  const pointerTypeKey = pointerTypes === undefined ? '' : pointerTypes.join(',');

  useEffect(() => {
    const element = ref.current;
    if (element === null || disabled) return;
    const acceptedTypes = pointerTypeKey === ''
      ? undefined
      : pointerTypeKey.split(',') as ('mouse' | 'pen' | 'touch')[];

    const previousTouchAction = element.style.touchAction;
    if (preventScroll) element.style.touchAction = 'none';

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let fired = false;

    const accepts = (event: PointerEvent): boolean => {
      if (!event.isPrimary) return false;
      if (acceptedTypes === undefined) return true;
      return acceptedTypes.includes(event.pointerType as 'mouse' | 'pen' | 'touch');
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (!accepts(event)) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      fired = false;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is not available in every environment.
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId || fired) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      const horizontal = Math.abs(deltaX);
      const vertical = Math.abs(deltaY);
      if (Math.max(horizontal, vertical) < threshold) return;
      // A gesture that crosses the threshold on the wrong axis is consumed:
      // a later perpendicular move must not turn it into a valid swipe.
      if ((axis === 'horizontal' && vertical > horizontal)
        || (axis === 'vertical' && horizontal > vertical)) {
        fired = true;
        return;
      }
      const direction = classifySwipe(deltaX, deltaY, axis, threshold);
      if (direction === null) return;
      fired = true;
      if (preventScroll) event.preventDefault();
      handlersRef.current.onSwipe(direction, event);
    };

    const finish = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      fired = false;
      try {
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
      } catch {
        // The pointer may already be released.
      }
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove, { passive: false });
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
      element.style.touchAction = previousTouchAction;
    };
  }, [ref, threshold, axis, preventScroll, disabled, pointerTypeKey]);
}
