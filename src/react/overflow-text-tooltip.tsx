import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface TruncatedText { anchor: Element; text: string }

function textOf(element: Element): string {
  return (element.getAttribute('data-rmd-overflow-text') ?? element.textContent ?? '').trim();
}

function truncated(element: Element): boolean {
  if (element.hasAttribute('data-rmd-overflow-text')) return true;
  const style = getComputedStyle(element);
  return style.textOverflow === 'ellipsis' && element.clientWidth > 0
    && element.scrollWidth > element.clientWidth + 1;
}

function findText(root: HTMLElement, target: EventTarget | null): TruncatedText | null {
  if (!(target instanceof Element) || !root.contains(target)) return null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    for (const label of target.labels ?? []) {
      for (const candidate of [label, ...label.querySelectorAll('*')]) {
        if (truncated(candidate) && textOf(candidate)) return { anchor: candidate, text: textOf(candidate) };
      }
    }
  }
  for (let element: Element | null = target; element && element !== root; element = element.parentElement) {
    if (truncated(element) && textOf(element)) return { anchor: element, text: textOf(element) };
    // Keyboard focus lands on the control, while its clipped label may be a child.
    if (element.matches('button, label, [role="option"], [role="radio"], [tabindex]')) {
      for (const child of element.querySelectorAll('*')) {
        if (truncated(child) && textOf(child)) return { anchor: child, text: textOf(child) };
      }
    }
  }
  return null;
}

/** One delegated tooltip per default document, shared by all clipped labels. */
export function OverflowTextTooltip({ rootRef, enabled }: {
  rootRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}) {
  const id = `${useId()}-overflow-text`;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TruncatedText | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, ready: false });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    let active: TruncatedText | null = null;
    let pending: Element | null = null;
    let descriptionTarget: Element | null = null;
    let focusedTarget: Element | null = null;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const titles = new Map<Element, string>();

    const hide = () => {
      clearTimeout(showTimer); clearTimeout(closeTimer);
      if (descriptionTarget) {
        const remaining = (descriptionTarget.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(token => token && token !== id);
        if (remaining.length) descriptionTarget.setAttribute('aria-describedby', remaining.join(' '));
        else descriptionTarget.removeAttribute('aria-describedby');
      }
      descriptionTarget = null;
      for (const [element, title] of titles) {
        if (!element.hasAttribute('title')) element.setAttribute('title', title);
      }
      titles.clear(); active = null; pending = null;
      if (!disposed) setTip(null);
    };
    const closeSoon = () => { clearTimeout(closeTimer); closeTimer = setTimeout(hide, 100); };
    const inspect = (target: EventTarget | null) => {
      if (target instanceof Node && bubbleRef.current?.contains(target)) {
        clearTimeout(closeTimer);
        return;
      }
      const found = findText(root, target);
      if (!found) { closeSoon(); return; }
      clearTimeout(closeTimer);
      if (active?.anchor === found.anchor || pending === found.anchor) return;
      hide(); pending = found.anchor;
      showTimer = setTimeout(() => {
        if (!root.contains(found.anchor) || !truncated(found.anchor)) return;
        active = { anchor: found.anchor, text: textOf(found.anchor) };
        pending = null;
        const label = found.anchor.closest('label');
        descriptionTarget = found.anchor.closest('button, input, [role="option"], [role="radio"], [tabindex]')
          ?? label?.control ?? found.anchor;
        const ids = (descriptionTarget.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
        descriptionTarget.setAttribute('aria-describedby', [...new Set([...ids, id])].join(' '));
        // Avoid showing a second native title bubble over the styled tooltip.
        for (let element: Element | null = found.anchor; element && element !== root; element = element.parentElement) {
          const title = element.getAttribute('title');
          if (title !== null) { titles.set(element, title); element.removeAttribute('title'); }
        }
        setPosition({ left: 8, top: 8, ready: false });
        setTip(active);
      }, 180);
    };
    const onOver = (event: Event) => {
      // Scrolling a newly focused control can synthesize mouseover beneath a
      // stationary pointer. Keyboard focus wins until the pointer really moves.
      if (focusedTarget === document.activeElement) return;
      inspect(event.target);
    };
    const onFocus = (event: FocusEvent) => {
      focusedTarget = event.target instanceof Element ? event.target : null;
      inspect(event.target);
    };
    const onMove = (event: MouseEvent) => {
      if (!focusedTarget || (!event.movementX && !event.movementY)) return;
      focusedTarget = null;
      inspect(event.target);
    };
    const onOut = (event: MouseEvent | FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (active?.anchor.contains(next) || bubbleRef.current?.contains(next))) return;
      closeSoon();
    };
    const onMouseOut = (event: MouseEvent) => {
      if (focusedTarget === document.activeElement) return;
      onOut(event);
    };
    const onBlur = (event: FocusEvent) => { focusedTarget = null; onOut(event); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && bubbleRef.current?.contains(event.target)) return;
      // Pointer/keyboard focus can scroll a clipped label into view. Keep the
      // pending reveal when its anchor remains visible; measure after it settles.
      if (pending) {
        const rect = pending.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth) return;
      }
      hide();
    };
    const observer = new MutationObserver(() => {
      if (active && (!root.contains(active.anchor) || textOf(active.anchor) !== active.text)) hide();
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    root.addEventListener('mouseover', onOver);
    root.addEventListener('mousemove', onMove);
    root.addEventListener('mouseout', onMouseOut);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('focusout', onBlur);
    window.addEventListener('keydown', onKey, true);
    root.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      disposed = true; hide(); observer.disconnect();
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mousemove', onMove);
      root.removeEventListener('mouseout', onMouseOut);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('focusout', onBlur);
      window.removeEventListener('keydown', onKey, true);
      root.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [enabled, id, rootRef]);

  useLayoutEffect(() => {
    if (!tip || !bubbleRef.current) return;
    const anchor = tip.anchor.getBoundingClientRect();
    const bubble = bubbleRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - bubble.width - 8));
    const below = anchor.bottom + 8;
    const top = below + bubble.height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - bubble.height - 8);
    setPosition({ left, top, ready: true });
  }, [tip]);

  if (!enabled || !tip) return null;
  return <div ref={bubbleRef} id={id} role="tooltip" className="rmd-overflow-tooltip" data-rmd-overflow-tooltip=""
    style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}>{tip.text}</div>;
}
