import { useEffect, useRef } from 'react';
import type { LocalComponentContext } from '../component-api';
import type { LocalSchedulerBackground } from '../../runtime-services/scheduler';
import { reportError } from './common';

export interface UseTickerOptions {
  /** `pause` stops while hidden; `wall-clock` settles on resume. */
  readonly background?: LocalSchedulerBackground;
  /** Further restrict the default `interactive && visible && !disabled` gate. */
  readonly enabled?: boolean;
  /** Restart the subscription after `runtime.reset`. */
  readonly restartOnReset?: boolean;
}

/**
 * Run a callback on a managed interval. The hook owns subscription cleanup
 * and pauses automatically in static mode, when hidden, or when disabled.
 */
export function useTicker(
  context: LocalComponentContext,
  intervalMs: number,
  run: () => void,
  options?: UseTickerOptions,
): void {
  const runRef = useRef(run);
  runRef.current = run;
  const contextRef = useRef(context);
  contextRef.current = context;
  const scheduler = context.services.scheduler;
  const background = options?.background ?? 'pause';
  const interactive = context.mode !== 'static' && context.visible && !context.disabled;
  const enabled = interactive && (options?.enabled ?? true);
  const resetToken = options?.restartOnReset === true ? context.resetToken : 0;

  useEffect(() => {
    if (!enabled) return;
    let cancel: (() => void) | null = null;
    try {
      cancel = scheduler.every(intervalMs, () => {
        try {
          runRef.current();
        } catch (error) {
          reportError(contextRef.current, 'local.runtime.scheduler', error);
        }
      }, { background });
    } catch (error) {
      reportError(contextRef.current, 'local.runtime.scheduler', error);
    }
    return () => {
      cancel?.();
    };
  }, [scheduler, intervalMs, background, enabled, resetToken]);
}

/** Run a callback on every animation frame with a measured delta. */
export function useFrame(
  context: LocalComponentContext,
  run: (deltaMs: number) => void,
  options?: Pick<UseTickerOptions, 'enabled' | 'restartOnReset'>,
): void {
  const runRef = useRef(run);
  runRef.current = run;
  const contextRef = useRef(context);
  contextRef.current = context;
  const scheduler = context.services.scheduler;
  const interactive = context.mode !== 'static' && context.visible && !context.disabled;
  const enabled = interactive && (options?.enabled ?? true);
  const resetToken = options?.restartOnReset === true ? context.resetToken : 0;

  useEffect(() => {
    if (!enabled) return;
    let cancel: (() => void) | null = null;
    try {
      cancel = scheduler.frame((delta) => {
        try {
          runRef.current(delta);
        } catch (error) {
          reportError(contextRef.current, 'local.runtime.scheduler', error);
        }
      });
    } catch (error) {
      reportError(contextRef.current, 'local.runtime.scheduler', error);
    }
    return () => {
      cancel?.();
    };
  }, [scheduler, enabled, resetToken]);
}
