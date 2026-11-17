import { useEffect, useState, type RefObject } from 'react';
import type { LocalColorScheme } from '../theme/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
type ResolvedColorScheme = 'light' | 'dark';

function explicitColorScheme(value: string | null | undefined): ResolvedColorScheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * Nearest host preference. The renderer owns `data-color-scheme` on the root,
 * so only the legacy `data-theme` attribute is read from the root itself; a
 * host script that still toggles that attribute keeps working.
 */
function hostColorScheme(root: HTMLElement): ResolvedColorScheme | null {
  const own = explicitColorScheme(root.getAttribute('data-theme'));
  if (own) return own;
  let element: Element | null = root.parentElement;
  while (element) {
    const scheme =
      explicitColorScheme(element.getAttribute('data-color-scheme')) ??
      explicitColorScheme(element.getAttribute('data-theme'));
    if (scheme) return scheme;
    element = element.parentElement;
  }
  return null;
}

function systemColorScheme(): ResolvedColorScheme | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return null;
  }
}

/**
 * Resolve the effective mode for one document instance. Server rendering and
 * the hydration pass always start light so markup matches; the client effect
 * then follows the nearest host attribute and the OS, observing both.
 */
export function useResolvedColorScheme(
  rootRef: RefObject<HTMLElement | null>,
  requested: LocalColorScheme,
): ResolvedColorScheme {
  const explicit = explicitColorScheme(requested);
  const [resolved, setResolved] = useState<ResolvedColorScheme>('light');

  useEffect(() => {
    if (explicit) {
      setResolved(explicit);
      return;
    }
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') {
      setResolved('light');
      return;
    }
    const update = () => setResolved(hostColorScheme(root) ?? systemColorScheme() ?? 'light');
    update();

    let observers: MutationObserver[] = [];
    if (typeof MutationObserver === 'function') {
      try {
        const watch = (target: Element, filter: string[]) => {
          const observer = new MutationObserver(update);
          observer.observe(target, { attributes: true, attributeFilter: filter });
          observers.push(observer);
        };
        // A host script may still toggle the legacy attribute on the document
        // element itself; the renderer-owned data-color-scheme is not observed
        // there so its own writes never re-enter the resolver.
        watch(root, ['data-theme']);
        let element: Element | null = root.parentElement;
        while (element) {
          watch(element, ['data-color-scheme', 'data-theme']);
          element = element.parentElement;
        }
      } catch {
        for (const observer of observers) observer.disconnect();
        observers = [];
      }
    }

    const onMediaChange = () => update();
    let query: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      try {
        query = window.matchMedia(DARK_QUERY);
        if (typeof query.addEventListener === 'function') {
          query.addEventListener('change', onMediaChange);
        } else if (typeof query.addListener === 'function') {
          query.addListener(onMediaChange);
        }
      } catch {
        query = null;
      }
    }

    return () => {
      for (const observer of observers) observer.disconnect();
      if (!query) return;
      if (typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', onMediaChange);
      } else if (typeof query.removeListener === 'function') {
        query.removeListener(onMediaChange);
      }
    };
  }, [explicit, rootRef]);

  // Explicit props apply during server rendering too; `auto` starts light.
  return explicit ?? resolved;
}
