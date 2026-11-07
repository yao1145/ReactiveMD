/**
 * Injected clock and scheduler.
 *
 * The core scheduler never touches `window` directly. Browser ports are
 * supplied by the default adapter below; tests and non-DOM hosts can inject
 * their own. Page visibility is handled here so components do not each
 * reimplement it.
 */

export type LocalSchedulerBackground = 'pause' | 'wall-clock';

export interface LocalSchedulerPorts {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  requestAnimationFrame?(run: (time: number) => void): unknown;
  cancelAnimationFrame?(handle: unknown): void;
  isHidden?(): boolean;
  subscribeVisibility?(listener: (hidden: boolean) => void): () => void;
}

export interface LocalSchedulerOptions {
  readonly ports?: Partial<LocalSchedulerPorts>;
  /** Reject runaway components. Defaults to 64 subscriptions per runtime. */
  readonly maxSubscriptions?: number;
  /** Clamp `every` intervals to avoid hot loops. Defaults to 16 ms. */
  readonly minIntervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export interface LocalTickerOptions {
  readonly background?: LocalSchedulerBackground;
}

export interface LocalClock {
  now(): number;
  activeNow(): number;
  readonly suspended: boolean;
}

export interface LocalScheduler extends LocalClock {
  readonly size: number;
  every(intervalMs: number, run: () => void, options?: LocalTickerOptions): () => void;
  after(delayMs: number, run: () => void, options?: LocalTickerOptions): () => void;
  frame(run: (deltaMs: number) => void): () => void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}

interface SchedulerJob {
  readonly id: number;
  readonly kind: 'every' | 'after' | 'frame';
  readonly interval: number;
  readonly background: LocalSchedulerBackground;
  readonly run: (() => void) | ((deltaMs: number) => void);
  timer: unknown;
  frame: unknown;
  deadline: number;
  remaining: number;
  lastFrameAt: number;
  removed: boolean;
}

const DEFAULT_MAX_SUBSCRIPTIONS = 64;
const DEFAULT_MIN_INTERVAL_MS = 16;

function globalPorts(): LocalSchedulerPorts {
  const now = (): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  );
  const timer = (run: () => void, ms: number): unknown => globalThis.setTimeout(run, ms);
  const cancel = (handle: unknown): void => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  };
  const raf = typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : undefined;
  const caf = typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : undefined;
  const documentRef = typeof document === 'undefined' ? undefined : document;
  return {
    now,
    setTimeout: timer,
    clearTimeout: cancel,
    ...(raf === undefined ? {} : { requestAnimationFrame: raf }),
    ...(caf === undefined ? {} : { cancelAnimationFrame: caf }),
    isHidden: () => documentRef !== undefined && documentRef.visibilityState === 'hidden',
    subscribeVisibility: (listener) => {
      if (documentRef === undefined) return () => {};
      const onChange = (): void => listener(documentRef.visibilityState === 'hidden');
      documentRef.addEventListener('visibilitychange', onChange);
      return () => documentRef.removeEventListener('visibilitychange', onChange);
    },
  };
}

function resolvePorts(options: LocalSchedulerOptions | undefined): LocalSchedulerPorts {
  const defaults = globalPorts();
  const supplied = options?.ports ?? {};
  return {
    now: supplied.now ?? defaults.now,
    setTimeout: supplied.setTimeout ?? defaults.setTimeout,
    clearTimeout: supplied.clearTimeout ?? defaults.clearTimeout,
    ...(supplied.requestAnimationFrame ?? defaults.requestAnimationFrame
      ? { requestAnimationFrame: supplied.requestAnimationFrame ?? defaults.requestAnimationFrame }
      : {}),
    ...(supplied.cancelAnimationFrame ?? defaults.cancelAnimationFrame
      ? { cancelAnimationFrame: supplied.cancelAnimationFrame ?? defaults.cancelAnimationFrame }
      : {}),
    ...(supplied.isHidden ?? defaults.isHidden
      ? { isHidden: supplied.isHidden ?? defaults.isHidden }
      : {}),
    ...(supplied.subscribeVisibility ?? defaults.subscribeVisibility
      ? { subscribeVisibility: supplied.subscribeVisibility ?? defaults.subscribeVisibility }
      : {}),
  };
}

export function createLocalScheduler(options?: LocalSchedulerOptions): LocalScheduler {
  const ports = resolvePorts(options);
  const maxSubscriptions = options?.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;
  const minIntervalMs = options?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const onError = options?.onError ?? (() => {});
  const jobs = new Map<number, SchedulerJob>();
  let nextId = 1;
  let disposed = false;
  let suspended = false;
  let suspendedAt = 0;
  let suspendedElapsed = 0;
  let lastNow = 0;
  let unsubscribeVisibility: (() => void) | null = null;

  const now = (): number => {
    const value = ports.now();
    lastNow = Math.max(lastNow, value);
    return lastNow;
  };

  const activeNow = (): number => {
    const value = now();
    return value - suspendedElapsed - (suspended ? value - suspendedAt : 0);
  };

  const clearJobTimer = (job: SchedulerJob): void => {
    if (job.timer !== null) {
      ports.clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.frame !== null && ports.cancelAnimationFrame) {
      ports.cancelAnimationFrame(job.frame);
      job.frame = null;
    }
  };

  const runSafely = (job: SchedulerJob, delta?: number): void => {
    try {
      if (job.kind === 'frame') {
        (job.run as (deltaMs: number) => void)(delta ?? 0);
      } else {
        (job.run as () => void)();
      }
    } catch (error) {
      try {
        onError(error);
      } catch {
        // An error reporter must not break other subscriptions.
      }
    }
  };

  const arm = (job: SchedulerJob, delayMs: number): void => {
    if (disposed || suspended || job.removed) return;
    const delay = Math.max(0, delayMs);
    job.deadline = now() + delay;
    job.timer = ports.setTimeout(() => {
      job.timer = null;
      if (disposed || suspended || job.removed) return;
      runSafely(job);
      if (job.kind !== 'every') {
        job.removed = true;
        jobs.delete(job.id);
        return;
      }
      job.deadline = now() + job.interval;
      arm(job, job.interval);
    }, delay);
  };

  const startFrame = (job: SchedulerJob): void => {
    if (disposed || suspended || job.removed) return;
    const step = (time: number): void => {
      job.frame = null;
      if (disposed || suspended || job.removed) return;
      const previous = job.lastFrameAt;
      job.lastFrameAt = time;
      runSafely(job, Math.max(0, time - previous));
      startFrame(job);
    };
    if (ports.requestAnimationFrame && ports.cancelAnimationFrame) {
      job.frame = ports.requestAnimationFrame(step);
      return;
    }
    job.timer = ports.setTimeout(() => {
      job.timer = null;
      step(now());
    }, minIntervalMs);
  };

  const remove = (job: SchedulerJob): void => {
    job.removed = true;
    clearJobTimer(job);
    jobs.delete(job.id);
  };

  const register = (
    kind: SchedulerJob['kind'],
    interval: number,
    background: LocalSchedulerBackground,
    run: SchedulerJob['run'],
  ): (() => void) => {
    if (disposed) throw new Error('The local scheduler has been disposed.');
    if (jobs.size >= maxSubscriptions) {
      throw new RangeError(
        `Local scheduler subscriptions exceed the limit of ${maxSubscriptions}.`,
      );
    }
    const job: SchedulerJob = {
      id: nextId,
      kind,
      interval,
      background,
      run,
      timer: null,
      frame: null,
      deadline: now() + interval,
      remaining: interval,
      lastFrameAt: now(),
      removed: false,
    };
    nextId += 1;
    jobs.set(job.id, job);
    if (kind === 'frame') {
      startFrame(job);
    } else if (!suspended) {
      arm(job, interval);
    }
    return () => remove(job);
  };

  const suspend = (): void => {
    if (disposed || suspended) return;
    suspended = true;
    suspendedAt = now();
    for (const job of jobs.values()) {
      clearJobTimer(job);
      if (job.kind === 'frame') continue;
      if (job.background === 'pause') {
        job.remaining = Math.max(0, job.deadline - now());
      }
    }
  };

  const resume = (): void => {
    if (disposed || !suspended) return;
    suspended = false;
    suspendedElapsed += Math.max(0, now() - suspendedAt);
    for (const job of [...jobs.values()]) {
      if (job.removed) continue;
      if (job.kind === 'frame') {
        job.lastFrameAt = now();
        startFrame(job);
        continue;
      }
      if (job.background === 'pause') {
        arm(job, job.remaining);
        continue;
      }
      const due = now() >= job.deadline;
      if (!due) {
        arm(job, job.deadline - now());
        continue;
      }
      runSafely(job);
      if (job.kind !== 'every') {
        remove(job);
      } else {
        job.deadline = now() + job.interval;
        arm(job, job.interval);
      }
    }
  };

  if (ports.subscribeVisibility) {
    unsubscribeVisibility = ports.subscribeVisibility((hidden) => {
      if (hidden) suspend();
      else resume();
    });
  }
  if (ports.isHidden?.() === true) suspend();

  return Object.freeze({
    now,
    activeNow,
    get suspended(): boolean {
      return suspended;
    },
    get size(): number {
      return jobs.size;
    },
    every(intervalMs: number, run: () => void, tickerOptions?: LocalTickerOptions): () => void {
      const interval = Number.isFinite(intervalMs)
        ? Math.max(minIntervalMs, intervalMs)
        : minIntervalMs;
      return register('every', interval, tickerOptions?.background ?? 'pause', run);
    },
    after(delayMs: number, run: () => void, tickerOptions?: LocalTickerOptions): () => void {
      const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
      return register('after', delay, tickerOptions?.background ?? 'wall-clock', run);
    },
    frame(run: (deltaMs: number) => void): () => void {
      return register('frame', minIntervalMs, 'pause', run);
    },
    suspend,
    resume,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const job of jobs.values()) clearJobTimer(job);
      jobs.clear();
      unsubscribeVisibility?.();
      unsubscribeVisibility = null;
    },
  });
}
