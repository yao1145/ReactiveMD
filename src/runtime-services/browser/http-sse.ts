/**
 * HTTP submission and SSE subscription adapters.
 *
 * This module belongs to the browser layer. It reads `fetch` and `EventSource`
 * lazily when an operation starts, never at import time, and every default is
 * replaceable so tests and non-DOM hosts can inject their own transport.
 *
 * Creating an adapter only validates the host configuration. No request is
 * issued until the runtime calls `send` or `open`; this keeps a document with
 * registered channels free of I/O until a reader submits or a component
 * subscribes.
 */

import type {
  ChannelError,
  ChannelValidator,
  Json,
  JsonPayload,
  SubmitAdapter,
  SubmitAdapterContext,
  SubmitResult,
  SubscribeAdapter,
  SubscribeAdapterContext,
} from '../network';
import { DEFAULT_NETWORK_MAX_BYTES } from '../network';

const textEncoder = new TextEncoder();

function exceedsBudget(value: string, maxBytes: number): boolean {
  return value.length > maxBytes || textEncoder.encode(value).length > maxBytes;
}

const MAX_ENDPOINT_LENGTH = 2048;
const DEFAULT_IDEMPOTENCY_HEADER = 'Idempotency-Key';
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_VALUE = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const HTTP_METHOD = /^[A-Za-z][A-Za-z0-9!#$%&'*+\-.^_`|~]*$/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const HTTP_AUTHORITY = /^https?:\/\/[^/]/i;
const CONTROL_OR_SPACE = /[\u0000- \u007f]/;

/** Injected `fetch` replacement: receives the resolved endpoint and init. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Request body produced by the default encoder or a host `encode` hook. */
export interface HttpEncodedBody {
  readonly body: string;
  /** Defaults to `application/json`; `null` omits the header. */
  readonly contentType?: string | null;
}

/** The response facts `interpret` receives after a request completes. */
export interface HttpSubmitResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  /** Decoded response text. Empty when there is no response body. */
  readonly text: string;
}

export interface HttpSubmitOptions {
  /** Absolute HTTP(S) URL or a same-origin relative path. */
  readonly endpoint: string;
  /** Applied to the payload before the runtime calls `send`. */
  readonly validate: ChannelValidator<JsonPayload>;
  /** Outbound budget in UTF-8 bytes of the encoded body. Defaults to 64 KiB. */
  readonly maxBytes?: number;
  /** Budget for response bytes delivered to the interpreter. Defaults to 64 KiB. */
  readonly maxResponseBytes?: number;
  /** Deadline for fetching and reading the response, in milliseconds. Defaults to 15000. */
  readonly timeoutMs?: number;
  /** Defaults to `POST`. */
  readonly method?: string;
  /**
   * Static headers, or a per-submission function that can read
   * `requestId` and `idempotencyKey` from the context.
   */
  readonly headers?: Readonly<Record<string, string>>
    | ((context: SubmitAdapterContext) => Readonly<Record<string, string>>);
  /** Passed to `fetch`; omitted leaves the platform default. */
  readonly credentials?: RequestCredentials;
  /** Defaults to `globalThis.fetch`, read when a submission starts. */
  readonly fetch?: HttpFetch;
  /**
   * Map the validated payload to a request body. The byte budget applies to
   * the returned text. Defaults to `JSON.stringify` with a JSON content type.
   */
  readonly encode?: (payload: JsonPayload, context: SubmitAdapterContext) => HttpEncodedBody;
  /**
   * Business confirmation. Return a result to use it; return `undefined` to
   * fall back to the status rules (2xx confirms, 4xx rejects, anything else is
   * unconfirmed). Receives the response body text.
   */
  readonly interpret?: (response: HttpSubmitResponse) => SubmitResult | undefined;
  /** Header used for `idempotencyKey`; `null` or `''` disables it. Defaults to `Idempotency-Key`. */
  readonly idempotencyHeader?: string | null;
}

/** The subset of an EventSource-compatible client this adapter needs. */
export interface SseEventSourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  /**
   * 0 / 1 / 2 as in the EventSource spec. Optional, but a client that omits
   * it cannot report a terminal close through an `error` event.
   */
  readonly readyState?: number;
}

export interface SseStreamOptions {
  /** Absolute HTTP(S) URL or a same-origin relative path. */
  readonly endpoint: string;
  /** Applied by the runtime to every decoded message before dispatch. */
  readonly validate: ChannelValidator<Json>;
  /** Early limit in UTF-8 bytes of the raw event text. Defaults to 64 KiB. */
  readonly maxBytes?: number;
  /** Event names to listen for; defaults to `['message']`. */
  readonly events?: readonly string[];
  /** Passed to the built-in `EventSource` constructor. */
  readonly withCredentials?: boolean;
  /**
   * Replace the built-in `EventSource`, for example with a client that sends
   * authorization headers. The adapter never reconnects; clients that own
   * reconnection keep doing so.
   */
  readonly createEventSource?: (url: string) => SseEventSourceLike;
  /** Decode raw event data; defaults to `JSON.parse` for string data. */
  readonly decode?: (data: unknown, event: Event) => unknown;
}

function fail(code: ChannelError['code'], message: string): SubmitResult {
  return { ok: false, error: { code, message } };
}

function requireOptions(value: unknown, label: string): asserts value is object {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${label} requires an options object.`);
  }
}

function requireEndpoint(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} requires a string endpoint.`);
  }
  const endpoint = value.trim();
  if (endpoint.length === 0) {
    throw new TypeError(`${label} requires a non-empty endpoint.`);
  }
  if (endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw new TypeError(`${label} endpoint must be at most ${MAX_ENDPOINT_LENGTH} characters.`);
  }
  if (CONTROL_OR_SPACE.test(endpoint)) {
    throw new TypeError(`${label} endpoint must not contain whitespace or control characters.`);
  }
  if (endpoint.includes('\\')) {
    throw new TypeError(`${label} endpoint must not contain backslashes.`);
  }
  if (URL_SCHEME.test(endpoint)) {
    if (!HTTP_AUTHORITY.test(endpoint)) {
      throw new TypeError(`${label} endpoint must use HTTP(S) or be a same-origin relative path.`);
    }
    try {
      new URL(endpoint);
    } catch {
      throw new TypeError(`${label} endpoint must be a valid HTTP(S) URL.`);
    }
    return endpoint;
  }
  if (endpoint.startsWith('//')) {
    throw new TypeError(`${label} endpoint must not be protocol-relative.`);
  }
  if (endpoint.startsWith('#')) {
    throw new TypeError(`${label} endpoint must name a resource, not a fragment.`);
  }
  return endpoint;
}

function requireFunction<T>(value: T | undefined, label: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

function requireBudget(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function requireMethod(value: unknown): string {
  if (value === undefined) return 'POST';
  if (typeof value !== 'string' || !HTTP_METHOD.test(value)) {
    throw new TypeError('httpSubmit method must be an HTTP method token.');
  }
  return value;
}

function requireCredentials(value: unknown): RequestCredentials | undefined {
  if (value === undefined) return undefined;
  if (value !== 'omit' && value !== 'same-origin' && value !== 'include') {
    throw new TypeError('httpSubmit credentials must be "omit", "same-origin" or "include".');
  }
  return value;
}

function requireIdempotencyHeader(value: unknown): string | null {
  if (value === undefined) return DEFAULT_IDEMPOTENCY_HEADER;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !HEADER_NAME.test(value)) {
    throw new TypeError('httpSubmit idempotencyHeader must be an HTTP header name, null or an empty string.');
  }
  return value;
}

function normalizeHeaderRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('HTTP headers must be a plain object of strings.');
  }
  const result: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (!HEADER_NAME.test(name)) {
      throw new TypeError(`Invalid HTTP header name: ${name}.`);
    }
    if (typeof headerValue !== 'string' || HEADER_VALUE.test(headerValue)) {
      throw new TypeError(`Invalid value for HTTP header ${name}.`);
    }
    result[name] = headerValue;
  }
  return result;
}

function requireHeaders(
  value: HttpSubmitOptions['headers'],
): Readonly<Record<string, string>> | ((context: SubmitAdapterContext) => Readonly<Record<string, string>>) | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'function') return value;
  return normalizeHeaderRecord(value);
}

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function requestHeaders(
  base: Readonly<Record<string, string>>,
  contentType: string | null,
  idempotencyHeader: string | null,
  context: SubmitAdapterContext,
): Record<string, string> {
  const headers: Record<string, string> = { ...base };
  if (contentType !== null && !hasHeader(headers, 'content-type')) {
    headers['Content-Type'] = contentType;
  }
  if (idempotencyHeader !== null && context.idempotencyKey !== undefined
    && !hasHeader(headers, idempotencyHeader)) {
    headers[idempotencyHeader] = context.idempotencyKey;
  }
  return headers;
}

function resolveFetch(injected: HttpFetch | undefined): HttpFetch | undefined {
  if (injected !== undefined) return injected;
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== 'function') return undefined;
  const fetchImpl = candidate as HttpFetch;
  return (url, init) => fetchImpl.call(globalThis, url, init);
}

/** Returns undefined if the stream exceeds the budget. */
async function readResponseText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (body === null) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let remaining = maxBytes;
  let text = '';
  let complete = false;
  const cancel = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) {
        complete = true;
        return text + decoder.decode();
      }
      remaining -= chunk.value.byteLength;
      if (remaining < 0) return undefined;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete && !signal.aborted) cancel();
    reader.releaseLock();
  }
}

async function confirmHttpResponse(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
  interpret: HttpSubmitOptions['interpret'],
): Promise<SubmitResult> {
  if (!interpret || signal.aborted) {
    void response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
  } else {
    let text: string | undefined;
    try {
      text = await readResponseText(response.body, maxResponseBytes, signal);
    } catch {
      return fail('unconfirmed', 'The server responded but its confirmation could not be read.');
    }
    if (text === undefined) {
      return fail('unconfirmed', `The server response exceeds the ${maxResponseBytes}-byte budget.`);
    }
    signal.throwIfAborted();
    try {
      const result = interpret({ status: response.status, ok: response.ok, headers: response.headers, text });
      if (result !== undefined) return result;
    } catch {
      return fail('unconfirmed', 'The server responded but its result could not be interpreted.');
    }
  }
  if (response.ok) return { ok: true };
  if (response.status >= 400 && response.status < 500) {
    return fail('rejected', `The server rejected the submission (HTTP ${response.status}).`);
  }
  return fail('unconfirmed', `The submission outcome was not confirmed (HTTP ${response.status}).`);
}

/**
 * Submit one payload with `fetch`.
 *
 * Status rules: a 2xx response confirms; a 4xx response is an explicit
 * rejection; any other received status leaves the outcome ambiguous. A fetch
 * that times out or fails after being called reports `unconfirmed`. When host
 * interpretation is configured, the response body must be readable within
 * the budget to confirm an outcome. Caller or session abort reports `cancelled`.
 */
export function httpSubmit(options: HttpSubmitOptions): SubmitAdapter {
  requireOptions(options, 'httpSubmit');
  const endpoint = requireEndpoint(options.endpoint, 'httpSubmit');
  if (typeof options.validate !== 'function') {
    throw new TypeError('httpSubmit requires a validate function.');
  }
  const maxBytes = requireBudget(options.maxBytes, 'httpSubmit maxBytes') ?? DEFAULT_NETWORK_MAX_BYTES;
  const maxResponseBytes = requireBudget(options.maxResponseBytes, 'httpSubmit maxResponseBytes') ?? DEFAULT_NETWORK_MAX_BYTES;
  const timeoutMs = requireBudget(options.timeoutMs, 'httpSubmit timeoutMs') ?? DEFAULT_HTTP_TIMEOUT_MS;
  if (timeoutMs > MAX_TIMER_DELAY_MS) throw new TypeError('httpSubmit timeoutMs exceeds the maximum timer delay.');
  const method = requireMethod(options.method);
  const headers = requireHeaders(options.headers);
  const credentials = requireCredentials(options.credentials);
  const fetchOption = requireFunction(options.fetch, 'httpSubmit fetch');
  const encode = requireFunction(options.encode, 'httpSubmit encode');
  const interpret = requireFunction(options.interpret, 'httpSubmit interpret');
  const idempotencyHeader = requireIdempotencyHeader(options.idempotencyHeader);

  return Object.freeze({
    validate: options.validate,
    maxBytes,
    async send(payload: JsonPayload, context: SubmitAdapterContext): Promise<SubmitResult> {
      if (context.signal.aborted || context.sessionSignal.aborted) {
        return fail('cancelled', 'The submission was cancelled.');
      }

      let body: string;
      let initHeaders: Record<string, string>;
      try {
        const encoded = encode === undefined
          ? { body: JSON.stringify(payload), contentType: 'application/json' as const }
          : encode(payload, context);
        if (typeof encoded.body !== 'string') {
          throw new TypeError('The encoder must return a string body.');
        }
        body = encoded.body;
        const contentType = encoded.contentType === undefined ? 'application/json' : encoded.contentType;
        if (contentType !== null && typeof contentType !== 'string') {
          throw new TypeError('The encoder contentType must be a string or null.');
        }
        const base = typeof headers === 'function' ? normalizeHeaderRecord(headers(context)) : headers ?? {};
        initHeaders = requestHeaders(base, contentType, idempotencyHeader, context);
      } catch {
        return fail('transport', 'The submission could not be encoded.');
      }

      const bodyless = method === 'GET' || method === 'HEAD';
      if (bodyless && body !== '') {
        return fail('invalid-data', `${method} submissions cannot carry a request body.`);
      }
      if (exceedsBudget(body, maxBytes)) {
        return fail('invalid-data', `The submission exceeds the ${maxBytes}-byte budget.`);
      }

      const fetchImpl = resolveFetch(fetchOption);
      if (fetchImpl === undefined) {
        return fail('transport', 'HTTP fetch is unavailable in this context; pass options.fetch.');
      }

      if (context.signal.aborted || context.sessionSignal.aborted) {
        return fail('cancelled', 'The submission was cancelled.');
      }
      const controller = new AbortController();
      let settleStop!: (result: SubmitResult) => void;
      const stopped = new Promise<SubmitResult>(resolve => { settleStop = resolve; });
      const stop = (result: SubmitResult): void => {
        // Settle even when an injected transport does not honor the signal.
        settleStop(result);
        controller.abort();
      };
      const cancel = (): void => stop(fail('cancelled', 'The submission was cancelled.'));
      context.signal.addEventListener('abort', cancel, { once: true });
      context.sessionSignal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => stop(fail('unconfirmed', 'The submission timed out before confirmation.')), timeoutMs);
      const request = async (): Promise<SubmitResult> => {
        try {
          const response = await fetchImpl(endpoint, {
            method,
            headers: initHeaders,
            body: bodyless ? undefined : body,
            credentials,
            signal: controller.signal,
          });
          return await confirmHttpResponse(response, controller.signal, maxResponseBytes, interpret);
        } catch {
          return fail('unconfirmed', 'The submission was sent but no confirmation arrived.');
        }
      };
      try {
        return await Promise.race([stopped, request()]);
      } finally {
        clearTimeout(timeout);
        context.signal.removeEventListener('abort', cancel);
        context.sessionSignal.removeEventListener('abort', cancel);
      }
    },
  });
}

function requireEventTypes(value: unknown): readonly string[] {
  if (value === undefined) return ['message'];
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('sseStream events must be a non-empty array of event names.');
  }
  const seen = new Set<string>();
  for (const type of value) {
    if (typeof type !== 'string' || type.length === 0 || CONTROL_OR_SPACE.test(type)) {
      throw new TypeError('sseStream event names must be non-empty strings without whitespace.');
    }
    if (type === 'open' || type === 'error') {
      throw new TypeError('sseStream event names must not be "open" or "error".');
    }
    if (seen.has(type)) {
      throw new TypeError(`sseStream event name "${type}" is listed twice.`);
    }
    seen.add(type);
  }
  return [...value];
}

function builtInSourceFactory(
  withCredentials: boolean,
): ((url: string) => SseEventSourceLike) | undefined {
  const scope = globalThis as unknown as {
    EventSource?: new (url: string, init?: { withCredentials?: boolean }) => SseEventSourceLike;
  };
  const EventSourceCtor = scope.EventSource;
  if (typeof EventSourceCtor !== 'function') return undefined;
  return (url) => new EventSourceCtor(url, { withCredentials });
}

function defaultDecode(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  return JSON.parse(data);
}

/**
 * Subscribe to a server-sent event stream.
 *
 * The adapter decodes each event and hands the value to the runtime, which
 * runs the host validator. It never reconnects; reconnection stays with the
 * EventSource-compatible client. Cancelling the operation or the session
 * removes listeners and closes the client, and the returned disposer is
 * idempotent.
 */
export function sseStream(options: SseStreamOptions): SubscribeAdapter {
  requireOptions(options, 'sseStream');
  const endpoint = requireEndpoint(options.endpoint, 'sseStream');
  if (typeof options.validate !== 'function') {
    throw new TypeError('sseStream requires a validate function.');
  }
  const maxBytes = requireBudget(options.maxBytes, 'sseStream maxBytes') ?? DEFAULT_NETWORK_MAX_BYTES;
  const eventTypes = requireEventTypes(options.events);
  if (options.withCredentials !== undefined && typeof options.withCredentials !== 'boolean') {
    throw new TypeError('sseStream withCredentials must be a boolean.');
  }
  const withCredentials = options.withCredentials === true;
  const createEventSource = requireFunction(options.createEventSource, 'sseStream createEventSource');
  const decode = requireFunction(options.decode, 'sseStream decode');

  return Object.freeze({
    validate: options.validate,
    maxBytes,
    open(context: SubscribeAdapterContext): () => void {
      if (context.signal.aborted || context.sessionSignal.aborted) return () => {};

      const createSource = createEventSource ?? builtInSourceFactory(withCredentials);
      if (createSource === undefined) {
        context.error({
          code: 'unavailable',
          message: 'EventSource is unavailable in this context; pass options.createEventSource.',
        });
        context.status('closed');
        return () => {};
      }
      let source: SseEventSourceLike;
      try {
        source = createSource(endpoint);
      } catch {
        context.error({ code: 'unavailable', message: 'The event stream could not be opened.' });
        context.status('closed');
        return () => {};
      }

      let disposed = false;
      const handlers: Array<readonly [string, (event: Event) => void]> = [];

      const onOpen = (): void => {
        if (disposed) return;
        context.status('open');
      };
      const onError = (): void => {
        if (disposed) return;
        context.error({ code: 'transport', message: 'The event stream reported an error.' });
        if (source.readyState === 2) {
          context.status('closed');
          dispose();
        } else if (source.readyState === 0) {
          context.status('connecting');
        }
      };
      const onMessage = (event: Event): void => {
        if (disposed) return;
        const raw = (event as MessageEvent).data;
        if (raw === undefined) return;
        if (typeof raw === 'string' && exceedsBudget(raw, maxBytes)) {
          context.error({
            code: 'invalid-data',
            message: `An event exceeded the ${maxBytes}-byte budget.`,
          });
          return;
        }
        let value: unknown;
        try {
          value = decode === undefined ? defaultDecode(raw) : decode(raw, event);
        } catch {
          context.error({ code: 'invalid-data', message: 'An event could not be decoded.' });
          return;
        }
        context.data(value);
      };

      function cancel(): void {
        dispose();
      }
      function dispose(): void {
        if (disposed) return;
        disposed = true;
        for (const [type, handler] of handlers) {
          source.removeEventListener(type, handler);
        }
        context.signal.removeEventListener('abort', cancel);
        context.sessionSignal.removeEventListener('abort', cancel);
        try {
          source.close();
        } catch {
          // The client is already unusable; closing is best effort.
        }
      }

      handlers.push(['open', onOpen], ['error', onError]);
      for (const type of eventTypes) handlers.push([type, onMessage]);
      for (const [type, handler] of handlers) source.addEventListener(type, handler);

      context.signal.addEventListener('abort', cancel, { once: true });
      context.sessionSignal.addEventListener('abort', cancel, { once: true });
      // The client may finish connecting after the runtime already cancelled.
      if (context.signal.aborted || context.sessionSignal.aborted) dispose();
      return dispose;
    },
  });
}
