import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Anchor { id: string; element: SVGElement; pinned: boolean }

/** Keeps transient inspection separate from the diagram's persistent selection. */
export function useDiagramInspector(enabled: boolean, resetToken: number) {
  const [active, setActive] = useState<Anchor | null>(null);
  const activeRef = useRef<Anchor | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissed = useRef<SVGElement | null>(null);
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  const update = (next: Anchor | null) => { activeRef.current = next; setActive(next); };
  const close = () => {
    cancel();
    const current = activeRef.current;
    if (current && tooltipRef.current?.contains(document.activeElement)) {
      dismissed.current = current.element;
      current.element.focus({ preventScroll: true });
    }
    update(null);
  };
  const show = (id: string, element: SVGElement, source: 'pointer' | 'focus' | 'click') => {
    if (!enabled || (source === 'focus' && dismissed.current === element)) return;
    cancel();
    if (source !== 'focus') dismissed.current = null;
    const reveal = () => update({ id, element, pinned: source === 'click' });
    if (activeRef.current?.id === id) {
      if (source === 'click') update({ id, element, pinned: true });
      return;
    }
    if (source === 'pointer') timer.current = setTimeout(reveal, 120);
    else reveal();
  };
  const leave = (source: 'pointer' | 'focus' = 'pointer') => {
    cancel();
    if (source === 'focus') dismissed.current = null;
    timer.current = setTimeout(() => {
      const current = activeRef.current;
      if (!current) return;
      if (source === 'pointer' && current.pinned) return;
      if (document.activeElement === current.element || tooltipRef.current?.contains(document.activeElement)) return;
      update(null);
    }, 130);
  };
  useEffect(() => { cancel(); update(null); dismissed.current = null; }, [enabled, resetToken]);
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const outside = (event: PointerEvent) => {
      const current = activeRef.current;
      if (current && event.target instanceof Node && !current.element.contains(event.target) && !tooltipRef.current?.contains(event.target)) close();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside, true);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside, true); cancel(); };
  }, [enabled]);
  useEffect(() => () => cancel(), []);
  return { active, tooltipRef, show, leave, close, cancel };
}

export function DiagramInspector({ inspector, id, title, tone, children, closeLabel }: {
  inspector: ReturnType<typeof useDiagramInspector>; id: string; title: string;
  tone: string; children: ReactNode; closeLabel: string;
}) {
  const anchor = inspector.active?.element;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ x: 8, y: 8, ready: false });
  const measureRef = useRef<() => void>(() => {});
  measureRef.current = () => {
    const bubble = inspector.tooltipRef.current;
    if (!anchor || !bubble) return;
    const box = anchor.getBoundingClientRect();
    if (!anchor.isConnected || box.width === 0 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) { inspector.close(); return; }
    const width = bubble.offsetWidth, height = bubble.offsetHeight;
    const x = Math.max(10, Math.min(innerWidth - width - 10, box.left + box.width / 2 - width / 2));
    const below = box.bottom + 10;
    const preferredY = below + height <= innerHeight - 10 ? below : box.top - height - 10;
    const y = Math.max(10, Math.min(innerHeight - height - 10, preferredY));
    setPosition(current => current.x === x && current.y === y && current.ready ? current : { x, y, ready: true });
  };
  useLayoutEffect(() => {
    setHost(anchor?.closest<HTMLElement>('.md-document') ?? null);
  }, [anchor]);
  useLayoutEffect(() => { measureRef.current(); });
  useEffect(() => {
    if (!anchor || !host) return;
    let frame = 0;
    const schedule = (event?: Event) => {
      if (event?.target instanceof Node && inspector.tooltipRef.current?.contains(event.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measureRef.current());
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    observer?.observe(anchor);
    if (inspector.tooltipRef.current) observer?.observe(inspector.tooltipRef.current);
    return () => { window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [anchor, host]);
  if (!anchor || !host) return null;
  return createPortal(<div id={id} ref={inspector.tooltipRef} role="dialog" aria-label={title} aria-modal="false"
    className="rmd-diagram-tooltip" data-tone={tone} style={{ left: position.x, top: position.y, visibility: position.ready ? 'visible' : 'hidden' }}
    onPointerEnter={inspector.cancel} onPointerLeave={() => inspector.leave()}
    onFocus={inspector.cancel} onBlur={() => inspector.leave('focus')}>
    <div className="rmd-diagram-tooltip-head"><span className="rmd-diagram-tone-dot" /><strong>{title}</strong>
      <button type="button" data-rmd-appearance="custom" className="rmd-diagram-tooltip-close" aria-label={closeLabel} onClick={inspector.close}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div><div id={`${id}-body`} className="rmd-diagram-tooltip-body">{children}</div>
  </div>, host);
}
