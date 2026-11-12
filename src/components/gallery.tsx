import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  LocalComponentContext,
  LocalComponentContent,
} from '../react/component-api';

const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const FADE_SIZE = 24;
const MIN_THUMB = 28;
const HIDE_DELAY = 700;

interface RangeState {
  start: number;
  end: number;
  prev: boolean;
  next: boolean;
}

function clampItemWidth(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_WIDTH;
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, numeric)));
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function galleryItems(context: LocalComponentContext): LocalComponentContent[] {
  return context.children.items().filter(
    (item) => item.kind === 'component' && item.name === 'gallery-item',
  );
}

function itemCaption(item: LocalComponentContent): string {
  const label = item.props.label;
  return typeof label === 'string' ? label.trim() : '';
}

/* ------------------------------------------------------------- interactive */

export function Gallery(context: LocalComponentContext) {
  const items = galleryItems(context);
  const total = items.length;
  const width = clampItemWidth(context.props['item-width']);
  const label = typeof context.props.label === 'string' ? context.props.label.trim() : '';
  const viewportId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLUListElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; scroll: number; ratio: number } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const rangeKey = useRef('');
  const [range, setRange] = useState<RangeState>(() => ({
    start: total > 0 ? 1 : 0,
    end: total,
    prev: false,
    next: false,
  }));

  /* Scroll state is measured from the DOM. React only re-renders when the
     edge state or the visible item range changes; fades and the thumb are
     written straight to the elements. */
  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const root = rootRef.current;
    if (!viewport || !root || viewport.clientWidth === 0) return;

    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const left = Math.max(0, viewport.scrollLeft);
    const prev = left > 0.5;
    const next = max - left > 0.5;

    root.setAttribute('data-rmd-gallery-ready', '');
    root.setAttribute('data-rmd-gallery-overflow', max > 0.5 ? 'true' : 'false');
    viewport.style.setProperty('--rmd-gallery-fade-left', `${prev ? Math.min(FADE_SIZE, left) : 0}px`);
    viewport.style.setProperty('--rmd-gallery-fade-right', `${next ? Math.min(FADE_SIZE, max - left) : 0}px`);

    const viewportRect = viewport.getBoundingClientRect();
    const viewportStyle = window.getComputedStyle(viewport);
    const contentLeft = viewportRect.left + viewport.clientLeft + (parseFloat(viewportStyle.paddingLeft) || 0);
    const contentRight = viewportRect.left + viewport.clientLeft + viewport.clientWidth - (parseFloat(viewportStyle.paddingRight) || 0);
    let first = 0;
    let last = 0;
    let ordinal = 0;
    for (const child of Array.from(viewport.children)) {
      if (!child.classList.contains('rmd-gallery-item')) continue;
      ordinal += 1;
      const rect = child.getBoundingClientRect();
      if (rect.right > contentLeft + 0.5 && rect.left < contentRight - 0.5) {
        if (first === 0) first = ordinal;
        last = ordinal;
      }
    }

    const start = first === 0 ? (ordinal > 0 ? 1 : 0) : first;
    const end = last === 0 ? ordinal : last;
    const key = `${start}|${end}|${prev}|${next}`;
    if (key !== rangeKey.current) {
      rangeKey.current = key;
      setRange({ start, end, prev, next });
    }

    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;
    const overflowing = max > 0.5;
    track.toggleAttribute('data-hidden', !overflowing);
    if (!overflowing) return;
    const trackLength = track.clientWidth;
    const size = Math.min(trackLength, Math.max(MIN_THUMB, trackLength * viewport.clientWidth / Math.max(1, viewport.scrollWidth)));
    const offset = Math.max(0, Math.min(trackLength - size, (trackLength - size) * (left / max)));
    thumb.style.width = `${size}px`;
    thumb.style.transform = `translateX(${offset}px)`;
  }, []);

  const wake = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.setAttribute('data-rmd-gallery-scrolling', '');
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = undefined;
      root.removeAttribute('data-rmd-gallery-scrolling');
    }, HIDE_DELAY);
  }, []);

  /* Scroll and resize observation. Every listener, frame and timer is removed
     on unmount. */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const onScroll = (): void => {
      schedule();
      wake();
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    measure();

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(viewport);
      for (const child of Array.from(viewport.children)) observer.observe(child);
    }
    const mutations = typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(() => {
        observer?.disconnect();
        if (observer) {
          observer.observe(viewport);
          for (const child of Array.from(viewport.children)) observer.observe(child);
        }
        schedule();
      });
    mutations?.observe(viewport, { childList: true });

    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations?.disconnect();
      if (hideTimer.current !== undefined) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = undefined;
      }
    };
  }, [measure, wake, total]);

  /* A document reset (and the first mount) returns the strip to its start. */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = 0;
    const frame = window.requestAnimationFrame(() => measure());
    return () => window.cancelAnimationFrame(frame);
  }, [context.resetToken, context.visible, measure]);

  /* Vertical wheel and Shift+wheel move the strip only while that direction
     still has content; at the edges the page keeps the event. Ctrl/Meta zoom
     and native horizontal deltas are left alone. */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const max = viewport.scrollWidth - viewport.clientWidth;
      if (max <= 0.5) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      if (Math.abs(deltaX) > Math.abs(deltaY) || deltaY === 0) return;
      const left = viewport.scrollLeft;
      if (deltaY < 0 && left <= 0.5) return;
      if (deltaY > 0 && left >= max - 0.5) return;
      event.preventDefault();
      viewport.scrollBy({ left: deltaY, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  const page = (direction: 1 | -1): void => {
    const viewport = viewportRef.current;
    if (!viewport || context.disabled) return;
    viewport.scrollBy({
      left: direction * viewport.clientWidth * 0.9,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target !== event.currentTarget
      && target.closest('input, textarea, select, button, a[href], [contenteditable="true"], [role="textbox"], [role="slider"]')) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const left = viewport.scrollLeft;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (event.key === 'ArrowRight') {
      if (left >= max - 0.5) return;
      event.preventDefault();
      viewport.scrollBy({ left: viewport.clientWidth * 0.9, behavior });
    } else if (event.key === 'ArrowLeft') {
      if (left <= 0.5) return;
      event.preventDefault();
      viewport.scrollBy({ left: -viewport.clientWidth * 0.9, behavior });
    } else if (event.key === 'Home') {
      if (left <= 0.5) return;
      event.preventDefault();
      viewport.scrollTo({ left: 0, behavior });
    } else if (event.key === 'End') {
      if (left >= max - 0.5) return;
      event.preventDefault();
      viewport.scrollTo({ left: max, behavior });
    }
  };

  const onThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!viewport || !track || !thumb || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const max = viewport.scrollWidth - viewport.clientWidth;
    const travel = Math.max(1, track.clientWidth - thumb.offsetWidth);
    drag.current = {
      startX: event.clientX,
      scroll: viewport.scrollLeft,
      ratio: max / travel,
    };
    rootRef.current?.setAttribute('data-rmd-gallery-dragging', '');
    viewport.style.scrollSnapType = 'none';
  };

  const onThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    const viewport = viewportRef.current;
    if (!state || !viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const next = state.scroll + (event.clientX - state.startX) * state.ratio;
    viewport.scrollLeft = Math.max(0, Math.min(max, next));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    rootRef.current?.removeAttribute('data-rmd-gallery-dragging');
    const viewport = viewportRef.current;
    if (viewport) viewport.style.scrollSnapType = '';
    wake();
  };

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const viewport = viewportRef.current;
    const thumb = thumbRef.current;
    if (!viewport) return;
    event.preventDefault();
    const thumbRect = thumb?.getBoundingClientRect();
    const ahead = thumbRect
      ? event.clientX > thumbRect.left + thumbRect.width / 2
      : event.clientX > viewport.getBoundingClientRect().left + viewport.clientWidth / 2;
    viewport.scrollBy({
      left: (ahead ? 1 : -1) * viewport.clientWidth * 0.9,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  const displayStart = total === 0 ? 0 : Math.min(total, Math.max(1, range.start || 1));
  const displayEnd = total === 0 ? 0 : Math.min(total, Math.max(displayStart, range.end || total));
  const style = { '--rmd-gallery-item-width': `${width}px` } as CSSProperties;
  const viewportLabel = label
    ? context.locale.t(`Browse ${label}`, `浏览${label}`)
    : context.locale.t('Gallery items', '画廊项目');

  return (
    <section ref={rootRef} className="rmd-gallery" style={style} aria-label={label || undefined}>
      <div className="rmd-gallery-head">
        <h3 className="rmd-gallery-title" title={label || undefined}>{label}</h3>
        <div className="rmd-gallery-controls">
          {total > 0 ? (
            <span className="rmd-gallery-count" aria-live="polite" aria-atomic="true">
              {displayStart}–{displayEnd} / {total}
            </span>
          ) : null}
          <button
            type="button"
            className="rmd-gallery-button"
            data-direction="previous"
            data-rmd-appearance="custom"
            aria-label={context.locale.t('Previous items', '上一组')}
            aria-controls={viewportId}
            disabled={context.disabled || !range.prev}
            onClick={() => page(-1)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            type="button"
            className="rmd-gallery-button"
            data-direction="next"
            data-rmd-appearance="custom"
            aria-label={context.locale.t('Next items', '下一组')}
            aria-controls={viewportId}
            disabled={context.disabled || !range.next}
            onClick={() => page(1)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
      <ul
        id={viewportId}
        ref={viewportRef}
        className="rmd-gallery-viewport"
        role="list"
        tabIndex={0}
        aria-label={viewportLabel}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          const caption = itemCaption(item);
          return (
            <li key={item.id} className="rmd-gallery-item">
              <figure className="rmd-gallery-figure">
                {caption ? (
                  <figcaption><h3 className="rmd-gallery-caption" title={caption}>{caption}</h3></figcaption>
                ) : null}
                <div className="rmd-gallery-body">
                  {context.children.renderItems(item.children, item.visible)}
                </div>
              </figure>
            </li>
          );
        })}
      </ul>
      <div
        className="rmd-gallery-track"
        ref={trackRef}
        aria-hidden="true"
        onPointerDown={onTrackPointerDown}
      >
        <div
          className="rmd-gallery-thumb"
          ref={thumbRef}
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ static */

export function GalleryStatic(context: LocalComponentContext) {
  const items = galleryItems(context);
  const width = clampItemWidth(context.props['item-width']);
  const label = typeof context.props.label === 'string' ? context.props.label.trim() : '';
  const style = { '--rmd-gallery-item-width': `${width}px` } as CSSProperties;
  return (
    <section className="rmd-gallery rmd-gallery-static" style={style} aria-label={label || undefined}>
      <div className="rmd-gallery-head">
        <h3 className="rmd-gallery-title" title={label || undefined}>{label}</h3>
      </div>
      <ul className="rmd-gallery-static-grid" role="list">
        {items.map((item) => {
          const caption = itemCaption(item);
          return (
            <li key={item.id} className="rmd-gallery-static-item">
              <figure className="rmd-gallery-figure">
                {caption ? (
                  <figcaption><h3 className="rmd-gallery-caption" title={caption}>{caption}</h3></figcaption>
                ) : null}
                <div className="rmd-gallery-body">
                  {context.children.renderItems(item.children, item.visible)}
                </div>
              </figure>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------- item (standalone) */

export function GalleryItemView(context: LocalComponentContext) {
  const caption = typeof context.props.label === 'string' ? context.props.label.trim() : '';
  return (
    <section className="rmd-gallery-item-standalone" aria-label={caption || undefined}>
      {caption ? <h3 className="rmd-gallery-caption" title={caption}>{caption}</h3> : null}
      <div className="rmd-gallery-body">{context.children.render()}</div>
    </section>
  );
}
/** Render every item in static documents without interactive controls. */
export function GalleryView(context: LocalComponentContext) {
  return context.mode === 'static' ? <GalleryStatic {...context} /> : <Gallery {...context} />;
}
