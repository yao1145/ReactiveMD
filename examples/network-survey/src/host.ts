import { httpSubmit, sseStream } from 'reactive-md/runtime/browser';
import type { SseEventSourceLike } from 'reactive-md/runtime/browser';
import type {
  ChannelValidator,
  Json,
  JsonPayload,
  NetworkConfig,
  SubmitAdapterContext,
  SubmitResult,
  SubscribeAdapterContext,
} from 'reactive-md/runtime';

/**
 * Host-side survey backend.
 *
 * Two transports share one public host shape:
 *
 * - `memory` (default) keeps answers in a plain object and pushes them to every
 *   open subscription. The example runs with no service.
 * - `http` uses `httpSubmit` and `sseStream` from `reactive-md/runtime/browser`
 *   against the endpoints served by `vite --mode http`.
 *
 * Both paths expose the same counters. The page ledger reads them, so opening
 * one shared stream and releasing it after the last listener leaves is visible
 * without developer tools.
 */

export interface SurveyCounts {
  readonly yes: number;
  readonly no: number;
}

export interface SurveyStats {
  readonly transport: 'memory' | 'http';
  readonly submits: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly streamOpens: number;
  readonly streamReleases: number;
  readonly liveStreams: number;
  readonly lastChoice: 'yes' | 'no' | null;
  readonly lastError: string | null;
}

export interface SurveyHost {
  readonly name: string;
  readonly network: NetworkConfig;
  readonly stats: SurveyStats;
  subscribe(listener: () => void): () => void;
  /** Only the in-memory backend resets its counts. */
  reset?: () => void;
}

function isCounts(value: unknown): value is SurveyCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as { readonly [key: string]: unknown };
  const { yes, no } = record;
  return typeof yes === 'number' && Number.isInteger(yes) && yes >= 0
    && typeof no === 'number' && Number.isInteger(no) && no >= 0;
}

const validateAnswer: ChannelValidator<JsonPayload> = (payload) => {
  const keys = Object.keys(payload).sort();
  if (keys.length !== 2 || keys[0] !== 'choice' || keys[1] !== 'comment') {
    return '提交内容必须且只能包含 choice 和 comment。';
  }
  const { choice, comment } = payload;
  if (choice !== 'yes' && choice !== 'no') return 'choice 只能是 yes 或 no。';
  if (typeof comment !== 'string') return 'comment 必须是文本。';
  if (comment.length > 2000) return 'comment 最多 2000 个字符。';
  return true;
};

const validateCounts: ChannelValidator<Json> = (value) => isCounts(value)
  ? true
  : '统计消息必须是 { yes, no } 两个非负整数。';

function createLedger(transport: SurveyStats['transport']) {
  let stats: SurveyStats = {
    transport,
    submits: 0,
    accepted: 0,
    rejected: 0,
    streamOpens: 0,
    streamReleases: 0,
    liveStreams: 0,
    lastChoice: null,
    lastError: null,
  };
  const listeners = new Set<() => void>();
  return {
    get stats(): SurveyStats { return stats; },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update(patch: Partial<SurveyStats>) {
      stats = { ...stats, ...patch };
      for (const listener of [...listeners]) {
        try { listener(); } catch { /* The ledger is diagnostic only. */ }
      }
    },
  };
}

/* ------------------------------------------------------- in-memory backend */

function createMemoryHost(): SurveyHost {
  let counts: SurveyCounts = { yes: 2, no: 1 };
  const ledger = createLedger('memory');
  const readers = new Set<(counts: SurveyCounts) => void>();
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const deliver = (): void => {
    for (const reader of [...readers]) {
      try { reader(counts); } catch { /* A detached subscription ignores updates. */ }
    }
  };

  // A push backend resends its snapshot while a stream is open. This keeps a
  // component that joins an existing shared stream current and is also what a
  // polling relay looks like; the components treat duplicates as no-ops.
  const syncKeepAlive = (): void => {
    if (readers.size > 0 && keepAlive === undefined) {
      keepAlive = setInterval(deliver, 2000);
    } else if (readers.size === 0 && keepAlive !== undefined) {
      clearInterval(keepAlive);
      keepAlive = undefined;
    }
  };

  const network: NetworkConfig = {
    channels: {
      answers: {
        submit: {
          validate: validateAnswer,
          send(payload: JsonPayload, context: SubmitAdapterContext): Promise<SubmitResult> {
            ledger.update({ submits: ledger.stats.submits + 1 });
            return new Promise<SubmitResult>((resolve) => {
              let settled = false;
              let timer: ReturnType<typeof setTimeout> | undefined;
              const finish = (result: SubmitResult): void => {
                if (settled) return;
                settled = true;
                if (timer !== undefined) clearTimeout(timer);
                context.signal.removeEventListener('abort', cancel);
                resolve(result);
              };
              const cancel = (): void => finish({ ok: false, error: { code: 'cancelled', message: '提交已取消。' } });
              timer = setTimeout(() => {
                const choice = payload.choice as 'yes' | 'no';
                counts = choice === 'yes'
                  ? { yes: counts.yes + 1, no: counts.no }
                  : { yes: counts.yes, no: counts.no + 1 };
                ledger.update({ accepted: ledger.stats.accepted + 1, lastChoice: choice, lastError: null });
                deliver();
                finish({ ok: true });
              }, 220);
              context.signal.addEventListener('abort', cancel, { once: true });
              if (context.signal.aborted) cancel();
            });
          },
        },
      },
      results: {
        subscribe: {
          validate: validateCounts,
          open(context: SubscribeAdapterContext): () => void {
            let active = true;
            const reader = (next: SurveyCounts): void => context.data(next);
            const release = (): void => {
              if (!active) return;
              active = false;
              readers.delete(reader);
              syncKeepAlive();
              context.signal.removeEventListener('abort', release);
              ledger.update({
                streamReleases: ledger.stats.streamReleases + 1,
                liveStreams: Math.max(0, ledger.stats.liveStreams - 1),
              });
            };

            readers.add(reader);
            syncKeepAlive();
            ledger.update({
              streamOpens: ledger.stats.streamOpens + 1,
              liveStreams: ledger.stats.liveStreams + 1,
            });
            context.status('open');
            // A backend sends its snapshot on connect; so does this one.
            context.data(counts);
            context.signal.addEventListener('abort', release, { once: true });
            if (context.signal.aborted) release();
            return release;
          },
        },
      },
    },
  };

  return {
    name: '内存适配器',
    network,
    get stats() { return ledger.stats; },
    subscribe: ledger.subscribe,
    reset() {
      counts = { yes: 0, no: 0 };
      ledger.update({ lastChoice: null, lastError: null });
      deliver();
    },
  };
}

/* ------------------------------------------------------------- HTTP backend */

function createHttpHost(): SurveyHost {
  const ledger = createLedger('http');
  const participant = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    byte => byte.toString(16).padStart(2, '0')).join('');

  const network: NetworkConfig = {
    channels: {
      answers: {
        submit: httpSubmit({
          endpoint: '/api/survey/answers',
          validate: validateAnswer,
          headers: { 'X-Survey-Participant': participant },
          fetch: (url, init) => {
            ledger.update({ submits: ledger.stats.submits + 1 });
            return fetch(url, init);
          },
          // Surface the server's reason instead of only the status. Returning
          // `undefined` keeps the default rules (2xx confirms, 5xx unconfirmed).
          interpret: (response) => {
            if (response.ok) {
              ledger.update({ accepted: ledger.stats.accepted + 1, lastError: null });
              return undefined;
            }
            if (response.status < 400 || response.status >= 500) return undefined;
            let message = `服务端拒绝了这次提交（HTTP ${response.status}）。`;
            try {
              const parsed = JSON.parse(response.text) as { error?: unknown };
              if (typeof parsed.error === 'string') message = parsed.error;
            } catch { /* Keep the status summary. */ }
            ledger.update({ rejected: ledger.stats.rejected + 1, lastError: message });
            return { ok: false, error: { code: 'rejected', message } };
          },
        }),
      },
      results: {
        subscribe: sseStream({
          endpoint: '/api/survey/results/events',
          validate: validateCounts,
          // The default `EventSource` exposes no close hook, so wrap it to keep
          // the ledger accurate when the last listener leaves. The adapter still
          // owns decoding, status and validation.
          createEventSource: (url): SseEventSourceLike => {
            const source = new EventSource(url);
            let live = true;
            ledger.update({
              streamOpens: ledger.stats.streamOpens + 1,
              liveStreams: ledger.stats.liveStreams + 1,
            });
            return {
              get readyState() { return source.readyState; },
              addEventListener(type, listener) { source.addEventListener(type, listener as EventListener); },
              removeEventListener(type, listener) { source.removeEventListener(type, listener as EventListener); },
              close: () => {
                if (!live) return;
                live = false;
                source.close();
                ledger.update({
                  streamReleases: ledger.stats.streamReleases + 1,
                  liveStreams: Math.max(0, ledger.stats.liveStreams - 1),
                });
              },
            };
          },
        }),
      },
    },
  };

  return {
    name: 'HTTP 提交 + SSE 订阅',
    network,
    get stats() { return ledger.stats; },
    subscribe: ledger.subscribe,
  };
}

/**
 * `--mode http` runs Vite with the survey endpoints and selects them here.
 * `?transport=memory` keeps the page on the in-memory adapter; `?transport=http`
 * selects HTTP even in the default mode.
 */
const requested = typeof location === 'undefined'
  ? null
  : new URLSearchParams(location.search).get('transport');
const httpMode = import.meta.env.MODE === 'http';
const useHttp = requested === 'http' || (requested !== 'memory' && httpMode);

export const surveyHost: SurveyHost = useHttp ? createHttpHost() : createMemoryHost();

/** Exposed for the console: `__surveyHost.stats` is always the live snapshot. */
declare global {
  // eslint-disable-next-line no-var
  var __surveyHost: SurveyHost | undefined;
}
if (typeof window !== 'undefined') globalThis.__surveyHost = surveyHost;
