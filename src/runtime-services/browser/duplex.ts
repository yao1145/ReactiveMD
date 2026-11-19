/**
 * Bidirectional (submit + subscribe) network adapters over WebSocket and
 * WebRTC data channels.
 *
 * The default wire protocol is JSON:
 *
 *   client -> server  {"type":"submit","requestId":"1","payload":{...},"idempotencyKey":"..."}
 *   server -> client  {"type":"ack","requestId":"1"}
 *                     {"type":"reject","requestId":"1","message":"..."}
 *                     {"type":"data","value":...}
 *
 * `data` messages are pushes and carry no request id. Hosts with a different
 * protocol pass a `codec`; the core still performs inbound validation and byte
 * budgeting before any component sees a value.
 *
 * Every runtime session (identified by the adapter's `sessionSignal`) owns one
 * connection. Subscriptions and pending submissions in that session share it;
 * a session that still waits for an ack keeps the connection open after its
 * last subscription leaves. Submits are never replayed, whether after a
 * timeout, a disconnect or a reconnect.
 *
 * The module only touches `WebSocket` (or host-injected factories) when a
 * connection is actually opened, so importing it on the server is safe.
 */

import type {
  ChannelError,
  ChannelValidator,
  Json,
  JsonPayload,
  NetworkChannel,
  SubmitAdapterContext,
  SubmitResult,
  SubscribeAdapterContext,
} from '../network';

/** A decoded inbound message. Unknown types are ignored by the adapter. */
export interface DuplexAck {
  readonly type: 'ack';
  readonly requestId: string;
}
export interface DuplexReject {
  readonly type: 'reject';
  readonly requestId: string;
  readonly message?: string;
}
export interface DuplexPush {
  readonly type: 'data';
  readonly value: unknown;
}
export type DuplexInbound = DuplexAck | DuplexReject | DuplexPush;

export interface DuplexSubmit {
  readonly type: 'submit';
  readonly requestId: string;
  readonly payload: JsonPayload;
  readonly idempotencyKey?: string;
}

/**
 * Wire mapping for a duplex channel. `encodeSubmit` returns whatever the
 * transport accepts (`string` or binary). `decode` receives the raw message
 * from the transport and returns a normalized message, or `undefined` to
 * ignore it. Throwing from `decode` is reported as invalid data.
 */
export interface DuplexCodec {
  encodeSubmit(message: DuplexSubmit): unknown;
  decode(raw: unknown): DuplexInbound | undefined;
}

export interface DuplexTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DuplexReconnectOptions {
  /** First retry delay in milliseconds. Defaults to 1000. */
  readonly delayMs?: number;
  /** Exponential backoff cap in milliseconds. Defaults to 30000. */
  readonly maxDelayMs?: number;
  /** Maximum consecutive attempts. Defaults to unbounded. */
  readonly attempts?: number;
}

interface ReconnectPlan {
  readonly delayMs: number;
  readonly maxDelayMs: number;
  readonly attempts: number;
}

export interface DuplexChannelOptions {
  /** Enables submission and authorizes outbound payloads. */
  readonly validateSubmit?: ChannelValidator<JsonPayload>;
  /** Enables subscription and authorizes inbound values. */
  readonly validateSubscribe?: ChannelValidator<Json>;
  /** Encoded JSON byte budget handed to the core. Omitted uses the core default. */
  readonly maxBytes?: number;
  /**
   * Raw inbound message budget in UTF-8 bytes for text and bytes for binary
   * messages. Defaults to 64 KiB and applies before decoding.
   */
  readonly maxMessageBytes?: number;
  /** Defaults to `jsonDuplexCodec`. */
  readonly codec?: DuplexCodec;
  /** How long a sent submit waits for an ack. Defaults to 15000 ms. */
  readonly ackTimeoutMs?: number;
  /**
   * How long one connection attempt may take before it counts as a transport
   * failure. Defaults to 15000 ms.
   */
  readonly connectTimeoutMs?: number;
  /**
   * Reconnect a session's subscription transport after an unexpected close.
   * Disabled by default; a session only reconnects while a subscription is
   * still attached. Submits are never replayed either way.
   */
  readonly reconnect?: boolean | DuplexReconnectOptions;
  /** Timer injection for tests. Defaults to the global timers. */
  readonly timers?: DuplexTimers;
}

/** Minimal structural WebSocket surface used by the adapter. */
export interface DuplexSocketLike {
  send(data: unknown): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export type DuplexSocketFactory = (url: string, protocols: readonly string[]) => DuplexSocketLike;

export interface WebSocketEndpoint {
  readonly url?: string;
  readonly protocols?: string | readonly string[];
}

export interface WebSocketChannelOptions extends DuplexChannelOptions {
  /** Absolute `ws:` or `wss:` URL. */
  readonly endpoint: string;
  /** Subprotocols sent during the upgrade; often used for authentication. */
  readonly protocols?: string | readonly string[];
  /**
   * Resolve the URL and subprotocols for each connection attempt, for example
   * to attach a short-lived token. Runs only on connect, never at import time.
   */
  readonly prepare?: (
    context: { readonly signal: AbortSignal },
  ) => WebSocketEndpoint | Promise<WebSocketEndpoint>;
  /** Injected socket factory for tests or non-browser hosts. */
  readonly webSocket?: DuplexSocketFactory;
}

/** Minimal structural RTCDataChannel surface used by the adapter. */
export interface DuplexDataChannelLike {
  readonly readyState?: string;
  send(data: unknown): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/**
 * A data channel borrowed from the host. The adapter never closes it; on
 * teardown it removes its listeners and calls `release`, if provided.
 */
export interface WebRtcPeer {
  readonly channel: DuplexDataChannelLike;
  readonly release?: () => void;
}

export type WebRtcConnect = (
  endpoint: string,
  signal: AbortSignal,
) => WebRtcPeer | Promise<WebRtcPeer>;

export interface WebRtcChannelOptions extends DuplexChannelOptions {
  /** Signaling path or peer identifier handed to `connect`. */
  readonly endpoint: string;
  /**
   * Select a trusted peer and return its data channel. `signal` aborts when
   * the session no longer needs the connection. The host owns signaling,
   * authentication and peer selection.
   */
  readonly connect: WebRtcConnect;
}

export const DEFAULT_DUPLEX_ACK_TIMEOUT_MS = 15_000;
export const DEFAULT_DUPLEX_MESSAGE_BYTES = 64 * 1024;

const CANCELLED: ChannelError = Object.freeze({
  code: 'cancelled',
  message: 'The operation was cancelled.',
});
const TRANSPORT: ChannelError = Object.freeze({
  code: 'transport',
  message: 'The channel could not communicate with its endpoint.',
});
const UNCONFIRMED: ChannelError = Object.freeze({
  code: 'unconfirmed',
  message: 'The submission was sent but was not confirmed.',
});
const INVALID: ChannelError = Object.freeze({
  code: 'invalid-data',
  message: 'The channel received invalid data.',
});

const EMPTY_PROTOCOLS: readonly string[] = Object.freeze([]);
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_PROTOCOLS = 16;
const MAX_REASON_LENGTH = 200;
const PROTOCOL_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// Keep the test pattern stateless; a global `test` would advance `lastIndex`.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;

const DEFAULT_TIMERS: DuplexTimers = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function failure(error: ChannelError): SubmitResult {
  return { ok: false, error };
}

function positiveInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
  return value;
}

function normalizeProtocols(input: unknown): readonly string[] {
  if (input === undefined) return EMPTY_PROTOCOLS;
  const list = typeof input === 'string' ? [input] : Array.isArray(input) ? input : undefined;
  if (list === undefined || list.length > MAX_PROTOCOLS) {
    throw new TypeError(`protocols must be a string or an array of at most ${MAX_PROTOCOLS} tokens.`);
  }
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || !PROTOCOL_TOKEN.test(item)) {
      throw new TypeError('Each WebSocket subprotocol must be a non-empty HTTP token.');
    }
    if (result.includes(item)) throw new TypeError('WebSocket subprotocols must be unique.');
    result.push(item);
  }
  return Object.freeze(result);
}

function normalizeWebSocketEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint !== endpoint.trim()
    || endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw new TypeError('endpoint must be a non-empty, trimmed ws: or wss: URL.');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('endpoint must be an absolute ws: or wss: URL.');
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new TypeError('endpoint must use the ws: or wss: protocol.');
  }
  return url.toString();
}

function normalizeSignalPath(endpoint: unknown): string {
  if (typeof endpoint !== 'string') {
    throw new TypeError('endpoint must be a non-empty signaling path.');
  }
  const text = endpoint.trim();
  if (text.length === 0 || text.length > MAX_ENDPOINT_LENGTH || CONTROL_CHARACTER.test(text)) {
    throw new TypeError('endpoint must be a non-empty signaling path without control characters.');
  }
  return text;
}

function normalizeReconnect(
  input: boolean | DuplexReconnectOptions | undefined,
): ReconnectPlan | undefined {
  if (input === undefined || input === false) return undefined;
  if (input === true) {
    return { delayMs: 1000, maxDelayMs: 30_000, attempts: Number.POSITIVE_INFINITY };
  }
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('reconnect must be a boolean or an options object.');
  }
  const delayMs = nonNegativeInteger(input.delayMs, 'reconnect.delayMs', 1000);
  const maxDelayMs = nonNegativeInteger(input.maxDelayMs, 'reconnect.maxDelayMs', 30_000);
  if (maxDelayMs < delayMs) {
    throw new TypeError('reconnect.maxDelayMs must not be smaller than reconnect.delayMs.');
  }
  const attempts = nonNegativeInteger(input.attempts, 'reconnect.attempts', Number.POSITIVE_INFINITY);
  if (attempts < 1) throw new TypeError('reconnect.attempts must be at least 1.');
  return { delayMs, maxDelayMs, attempts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireOptions(value: unknown, name: string): void {
  if (!isRecord(value)) throw new TypeError(`${name} requires an options object.`);
}

function normalizeInbound(value: unknown): DuplexInbound | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'ack' && typeof value.requestId === 'string') {
    return { type: 'ack', requestId: value.requestId };
  }
  if (value.type === 'reject' && typeof value.requestId === 'string') {
    return {
      type: 'reject',
      requestId: value.requestId,
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  }
  if (value.type === 'data' && 'value' in value) {
    return { type: 'data', value: value.value };
  }
  return undefined;
}

function decodeJsonPayload(raw: unknown): unknown {
  if (typeof raw === 'string') return raw.length === 0 ? undefined : JSON.parse(raw);
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    return JSON.parse(new TextDecoder().decode(raw));
  }
  return undefined;
}

/** Default JSON wire protocol; see the module comment for the message shapes. */
export const jsonDuplexCodec: DuplexCodec = Object.freeze({
  encodeSubmit(message: DuplexSubmit): string {
    return JSON.stringify(message);
  },
  decode(raw: unknown): DuplexInbound | undefined {
    return normalizeInbound(decodeJsonPayload(raw));
  },
});

function safeReason(message: unknown): string {
  if (typeof message !== 'string') return 'The channel rejected the submission.';
  const text = message.replace(CONTROL_CHARACTERS, ' ').trim().slice(0, MAX_REASON_LENGTH);
  return text.length > 0 ? text : 'The channel rejected the submission.';
}

function eventData(event: unknown): unknown {
  if (typeof event === 'object' && event !== null && 'data' in event) {
    return (event as { readonly data: unknown }).data;
  }
  return undefined;
}

const textEncoder = new TextEncoder();

function exceedsMessageBudget(raw: unknown, maxBytes: number): boolean {
  if (typeof raw === 'string') {
    return raw.length > maxBytes || textEncoder.encode(raw).byteLength > maxBytes;
  }
  return (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) && raw.byteLength > maxBytes;
}

function releasePeer(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const release = (value as { readonly release?: unknown }).release;
  if (typeof release !== 'function') return;
  try {
    (release as () => void).call(value);
  } catch {
    // The host release is best effort.
  }
}

interface ConnectionHandle {
  send(data: unknown): void;
  dispose(): void;
}

interface ConnectionEvents {
  message(raw: unknown): void;
  close(): void;
}

type ConnectionFactory = (
  events: ConnectionEvents,
  signal: AbortSignal,
) => ConnectionHandle | Promise<ConnectionHandle>;

interface Waiter {
  ready(): void;
  fail(error: ChannelError): void;
}

interface PendingEntry {
  finish(result: SubmitResult): void;
}

interface SessionState {
  readonly signal: AbortSignal;
  abortListener: () => void;
  readonly subscribers: Set<SubscribeAdapterContext>;
  readonly pending: Map<string, PendingEntry>;
  waiters: Waiter[];
  handle: ConnectionHandle | undefined;
  connecting: AbortController | undefined;
  connectTimer: unknown;
  reconnectTimer: unknown;
  reconnectAttempts: number;
}

function safeDispose(connection: ConnectionHandle): void {
  try {
    connection.dispose();
  } catch {
    // Disposal is best effort; the session is already gone.
  }
}

function createDuplexChannel(
  options: DuplexChannelOptions,
  factory: ConnectionFactory,
): NetworkChannel {
  const { validateSubmit, validateSubscribe } = options;
  if (validateSubmit === undefined && validateSubscribe === undefined) {
    throw new TypeError('A duplex channel needs validateSubmit, validateSubscribe, or both.');
  }
  if (validateSubmit !== undefined && typeof validateSubmit !== 'function') {
    throw new TypeError('validateSubmit must be a function.');
  }
  if (validateSubscribe !== undefined && typeof validateSubscribe !== 'function') {
    throw new TypeError('validateSubscribe must be a function.');
  }

  const codec = options.codec ?? jsonDuplexCodec;
  if (typeof codec !== 'object' || codec === null
    || typeof codec.encodeSubmit !== 'function' || typeof codec.decode !== 'function') {
    throw new TypeError('codec must provide encodeSubmit and decode functions.');
  }
  const timers = options.timers ?? DEFAULT_TIMERS;
  if (typeof timers !== 'object' || timers === null
    || typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') {
    throw new TypeError('timers must provide setTimeout and clearTimeout functions.');
  }

  const ackTimeoutMs = positiveInteger(options.ackTimeoutMs, 'ackTimeoutMs', DEFAULT_DUPLEX_ACK_TIMEOUT_MS);
  const connectTimeoutMs = positiveInteger(
    options.connectTimeoutMs,
    'connectTimeoutMs',
    DEFAULT_DUPLEX_ACK_TIMEOUT_MS,
  );
  const maxMessageBytes = positiveInteger(
    options.maxMessageBytes,
    'maxMessageBytes',
    DEFAULT_DUPLEX_MESSAGE_BYTES,
  );
  const maxBytes = options.maxBytes === undefined
    ? undefined
    : positiveInteger(options.maxBytes, 'maxBytes', 1);
  const reconnect = normalizeReconnect(options.reconnect);

  const sessions = new Map<AbortSignal, SessionState>();

  function clearReconnect(state: SessionState): void {
    if (state.reconnectTimer === undefined) return;
    timers.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = undefined;
  }

  function stopConnection(state: SessionState): void {
    clearReconnect(state);
    if (state.connectTimer !== undefined) {
      timers.clearTimeout(state.connectTimer);
      state.connectTimer = undefined;
    }
    const controller = state.connecting;
    state.connecting = undefined;
    if (controller !== undefined) controller.abort();
    const current = state.handle;
    state.handle = undefined;
    if (current !== undefined) safeDispose(current);
  }

  function maybeClose(state: SessionState): void {
    if (state.subscribers.size > 0 || state.pending.size > 0 || state.waiters.length > 0) return;
    if (state.reconnectTimer !== undefined) clearReconnect(state);
    if (state.handle !== undefined || state.connecting !== undefined) stopConnection(state);
  }

  function teardown(state: SessionState): void {
    state.signal.removeEventListener('abort', state.abortListener);
    sessions.delete(state.signal);
    state.subscribers.clear();
    for (const entry of [...state.pending.values()]) entry.finish(failure(CANCELLED));
    state.pending.clear();
    const ready = state.waiters;
    state.waiters = [];
    for (const waiter of ready) waiter.fail(CANCELLED);
    stopConnection(state);
  }

  function sessionFor(signal: AbortSignal): SessionState | undefined {
    const existing = sessions.get(signal);
    if (existing !== undefined) return existing;
    if (signal.aborted) return undefined;
    const state: SessionState = {
      signal,
      abortListener: () => {},
      subscribers: new Set(),
      pending: new Map(),
      waiters: [],
      handle: undefined,
      connecting: undefined,
      connectTimer: undefined,
      reconnectTimer: undefined,
      reconnectAttempts: 0,
    };
    const abortListener = (): void => {
      teardown(state);
    };
    state.abortListener = abortListener;
    signal.addEventListener('abort', abortListener, { once: true });
    sessions.set(signal, state);
    return state;
  }

  function scheduleReconnect(state: SessionState): boolean {
    if (reconnect === undefined || state.subscribers.size === 0) return false;
    state.reconnectAttempts += 1;
    if (state.reconnectAttempts > reconnect.attempts) {
      state.reconnectAttempts = 0;
      return false;
    }
    const delayMs = Math.min(
      reconnect.delayMs * 2 ** (state.reconnectAttempts - 1),
      reconnect.maxDelayMs,
    );
    for (const subscriber of [...state.subscribers]) subscriber.status('connecting');
    state.reconnectTimer = timers.setTimeout(() => {
      state.reconnectTimer = undefined;
      if (state.subscribers.size > 0 && state.handle === undefined && state.connecting === undefined) {
        startConnect(state);
      }
    }, delayMs);
    return true;
  }

  function clearConnectTimer(state: SessionState): void {
    if (state.connectTimer === undefined) return;
    timers.clearTimeout(state.connectTimer);
    state.connectTimer = undefined;
  }

  function adopt(state: SessionState, controller: AbortController, connection: ConnectionHandle): void {
    if (state.connecting !== controller) {
      safeDispose(connection);
      return;
    }
    state.connecting = undefined;
    clearConnectTimer(state);
    state.handle = connection;
    state.reconnectAttempts = 0;
    for (const subscriber of [...state.subscribers]) subscriber.status('open');
    const ready = state.waiters;
    state.waiters = [];
    for (const waiter of ready) waiter.ready();
  }

  function connectFailed(state: SessionState, controller: AbortController): void {
    if (state.connecting !== controller) return;
    state.connecting = undefined;
    clearConnectTimer(state);
    const ready = state.waiters;
    state.waiters = [];
    for (const waiter of ready) waiter.fail(TRANSPORT);
    if (state.subscribers.size === 0) {
      maybeClose(state);
      return;
    }
    if (scheduleReconnect(state)) return;
    for (const subscriber of [...state.subscribers]) {
      subscriber.error(TRANSPORT);
      subscriber.status('closed');
    }
  }

  function startConnect(state: SessionState): void {
    if (state.handle !== undefined || state.connecting !== undefined) return;
    clearReconnect(state);
    const controller = new AbortController();
    state.connecting = controller;
    const events: ConnectionEvents = {
      message(raw) {
        receive(state, raw);
      },
      close() {
        transportClosed(state);
      },
    };
    state.connectTimer = timers.setTimeout(() => {
      state.connectTimer = undefined;
      if (state.connecting !== controller) return;
      controller.abort();
      connectFailed(state, controller);
    }, connectTimeoutMs);
    let result: ConnectionHandle | Promise<ConnectionHandle>;
    try {
      result = factory(events, controller.signal);
    } catch {
      connectFailed(state, controller);
      return;
    }
    Promise.resolve(result).then(
      (connection) => {
        adopt(state, controller, connection);
      },
      () => {
        connectFailed(state, controller);
      },
    );
  }

  function ensureConnect(state: SessionState): void {
    clearReconnect(state);
    startConnect(state);
  }

  function reportInvalid(state: SessionState): void {
    for (const subscriber of [...state.subscribers]) subscriber.error(INVALID);
  }

  function receive(state: SessionState, raw: unknown): void {
    if (exceedsMessageBudget(raw, maxMessageBytes)) {
      reportInvalid(state);
      return;
    }
    let message: DuplexInbound | undefined;
    try {
      message = codec.decode(raw);
    } catch {
      reportInvalid(state);
      return;
    }
    if (message === undefined) return;
    if (message.type === 'data') {
      for (const subscriber of [...state.subscribers]) subscriber.data(message.value);
      return;
    }
    const entry = state.pending.get(message.requestId);
    if (entry === undefined) return;
    if (message.type === 'ack') {
      entry.finish({ ok: true });
    } else {
      entry.finish({
        ok: false,
        error: Object.freeze({ code: 'rejected', message: safeReason(message.message) }),
      });
    }
  }

  function transportClosed(state: SessionState): void {
    if (state.handle === undefined) return;
    state.handle = undefined;
    for (const entry of [...state.pending.values()]) entry.finish(failure(UNCONFIRMED));
    const ready = state.waiters;
    state.waiters = [];
    for (const waiter of ready) waiter.fail(TRANSPORT);
    if (state.subscribers.size === 0) {
      maybeClose(state);
      return;
    }
    if (scheduleReconnect(state)) return;
    for (const subscriber of [...state.subscribers]) {
      subscriber.error(TRANSPORT);
      subscriber.status('closed');
    }
  }

  function openSubscription(context: SubscribeAdapterContext): () => void {
    const state = sessionFor(context.sessionSignal);
    if (state === undefined || context.signal.aborted) {
      context.status('closed');
      return () => {};
    }
    let active = true;
    const release = (): void => {
      if (!active) return;
      active = false;
      context.signal.removeEventListener('abort', release);
      state.subscribers.delete(context);
      maybeClose(state);
    };
    if (state.handle !== undefined) {
      state.subscribers.add(context);
      context.status('open');
    } else {
      state.subscribers.add(context);
      context.status('connecting');
      ensureConnect(state);
    }
    context.signal.addEventListener('abort', release, { once: true });
    return release;
  }

  function send(payload: JsonPayload, context: SubmitAdapterContext): Promise<SubmitResult> {
    const requestId = context.requestId;
    const state = sessionFor(context.sessionSignal);
    if (state === undefined) return Promise.resolve(failure(CANCELLED));
    return new Promise<SubmitResult>((resolve) => {
      let settled = false;
      let timer: unknown;
      let waiter: Waiter | undefined;

      const finish = (result: SubmitResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) {
          timers.clearTimeout(timer);
          timer = undefined;
        }
        context.signal.removeEventListener('abort', cancel);
        if (waiter !== undefined) {
          const index = state.waiters.indexOf(waiter);
          if (index >= 0) state.waiters.splice(index, 1);
          waiter = undefined;
        }
        const entry = state.pending.get(requestId);
        if (entry !== undefined && entry.finish === finish) state.pending.delete(requestId);
        maybeClose(state);
        resolve(result);
      };
      const cancel = (): void => {
        finish(failure(CANCELLED));
      };

      if (context.signal.aborted) {
        finish(failure(CANCELLED));
        return;
      }
      context.signal.addEventListener('abort', cancel, { once: true });

      const start = (connection: ConnectionHandle): void => {
        if (settled) return;
        let encoded: unknown;
        try {
          encoded = codec.encodeSubmit({
            type: 'submit',
            requestId,
            payload,
            ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
          });
        } catch {
          finish(failure(TRANSPORT));
          return;
        }
        state.pending.set(requestId, { finish });
        timer = timers.setTimeout(() => {
          timer = undefined;
          const entry = state.pending.get(requestId);
          if (entry !== undefined && entry.finish === finish) finish(failure(UNCONFIRMED));
        }, ackTimeoutMs);
        try {
          connection.send(encoded);
        } catch {
          finish(failure(TRANSPORT));
        }
      };

      if (state.handle !== undefined) {
        start(state.handle);
        return;
      }
      waiter = {
        ready() {
          waiter = undefined;
          if (state.handle === undefined) finish(failure(TRANSPORT));
          else start(state.handle);
        },
        fail(error) {
          finish(failure(error));
        },
      };
      state.waiters.push(waiter);
      ensureConnect(state);
    });
  }

  return Object.freeze({
    ...(validateSubmit === undefined ? {} : {
      submit: Object.freeze({
        validate: validateSubmit,
        ...(maxBytes === undefined ? {} : { maxBytes }),
        send,
      }),
    }),
    ...(validateSubscribe === undefined ? {} : {
      subscribe: Object.freeze({
        validate: validateSubscribe,
        ...(maxBytes === undefined ? {} : { maxBytes }),
        open: openSubscription,
      }),
    }),
  });
}

interface WebSocketConnectionConfig {
  readonly endpoint: string;
  readonly protocols: readonly string[];
  readonly prepare?: (
    context: { readonly signal: AbortSignal },
  ) => WebSocketEndpoint | Promise<WebSocketEndpoint>;
  readonly createSocket: DuplexSocketFactory;
}

function createWebSocketConnection(config: WebSocketConnectionConfig): ConnectionFactory {
  return (events, signal) => new Promise<ConnectionHandle>((resolve, reject) => {
    let settled = false;
    let live = false;
    let socket: DuplexSocketLike | undefined;
    const listeners: [string, (event: unknown) => void][] = [];

    const detach = (): void => {
      if (socket === undefined) return;
      for (const [type, listener] of listeners) socket.removeEventListener(type, listener);
      listeners.length = 0;
    };
    const closeSocket = (): void => {
      const current = socket;
      socket = undefined;
      if (current === undefined) return;
      try {
        current.close();
      } catch {
        // The socket is already closed.
      }
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      detach();
      closeSocket();
      reject(new Error('The WebSocket connection failed.'));
    };
    const abort = (): void => {
      fail();
    };
    signal.addEventListener('abort', abort, { once: true });

    const on = (type: string, listener: (event: unknown) => void): void => {
      socket!.addEventListener(type, listener);
      listeners.push([type, listener]);
    };
    const opened = (): void => {
      if (settled) return;
      settled = true;
      live = true;
      signal.removeEventListener('abort', abort);
      resolve({
        send(data: unknown): void {
          socket!.send(data);
        },
        dispose(): void {
          detach();
          closeSocket();
        },
      });
    };
    const begin = (endpoint: WebSocketEndpoint | undefined): void => {
      if (settled) return;
      let url: string;
      let protocols: readonly string[];
      try {
        url = normalizeWebSocketEndpoint(endpoint?.url ?? config.endpoint);
        protocols = normalizeProtocols(endpoint?.protocols ?? config.protocols);
      } catch {
        settled = true;
        signal.removeEventListener('abort', abort);
        reject(new Error('The WebSocket endpoint is invalid.'));
        return;
      }
      try {
        socket = config.createSocket(url, protocols);
      } catch {
        fail();
        return;
      }
      try {
        on('open', opened);
        on('message', (event) => {
          if (live) events.message(eventData(event));
        });
        on('close', () => {
          if (!live) {
            fail();
            return;
          }
          detach();
          socket = undefined;
          events.close();
        });
        on('error', () => {
          if (!live) fail();
        });
      } catch {
        fail();
      }
    };

    if (config.prepare === undefined) {
      begin(undefined);
      return;
    }
    let prepared: WebSocketEndpoint | Promise<WebSocketEndpoint>;
    try {
      prepared = config.prepare({ signal });
    } catch {
      fail();
      return;
    }
    Promise.resolve(prepared).then(
      (endpoint) => {
        begin(endpoint);
      },
      () => {
        fail();
      },
    );
  });
}

function browserSocket(url: string, protocols: readonly string[]): DuplexSocketLike {
  const Constructor = (globalThis as unknown as {
    readonly WebSocket?: new (url: string, protocols?: string | string[]) => DuplexSocketLike;
  }).WebSocket;
  if (typeof Constructor !== 'function') {
    throw new TypeError('WebSocket is unavailable in this context; pass options.webSocket.');
  }
  return new Constructor(url, protocols.length > 0 ? [...protocols] : undefined);
}

/** WebSocket channel factory; supports protocols, prepared URLs and auth. */
export function webSocketChannel(options: WebSocketChannelOptions): NetworkChannel {
  requireOptions(options, 'webSocketChannel');
  const endpoint = normalizeWebSocketEndpoint(options.endpoint);
  const protocols = normalizeProtocols(options.protocols);
  if (options.prepare !== undefined && typeof options.prepare !== 'function') {
    throw new TypeError('prepare must be a function.');
  }
  const createSocket = options.webSocket ?? browserSocket;
  if (typeof createSocket !== 'function') throw new TypeError('webSocket must be a function.');
  return createDuplexChannel(options, createWebSocketConnection({
    endpoint,
    protocols,
    ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
    createSocket,
  }));
}

function isPeer(value: unknown): value is WebRtcPeer {
  if (typeof value !== 'object' || value === null) return false;
  const channel = (value as { readonly channel?: unknown }).channel;
  if (typeof channel !== 'object' || channel === null) return false;
  const candidate = channel as Partial<DuplexDataChannelLike>;
  return typeof candidate.send === 'function'
    && typeof candidate.addEventListener === 'function'
    && typeof candidate.removeEventListener === 'function';
}

interface WebRtcConnectionConfig {
  readonly endpoint: string;
  readonly connect: WebRtcConnect;
}

function createWebRtcConnection(config: WebRtcConnectionConfig): ConnectionFactory {
  return (events, signal) => new Promise<ConnectionHandle>((resolve, reject) => {
    let opened = false;
    let disposed = false;
    let channel: DuplexDataChannelLike | undefined;
    let hostRelease: (() => void) | undefined;
    const listeners: [string, (event: unknown) => void][] = [];

    const detach = (): void => {
      if (channel === undefined) return;
      for (const [type, listener] of listeners) channel.removeEventListener(type, listener);
      listeners.length = 0;
    };
    const release = (): void => {
      detach();
      const callback = hostRelease;
      hostRelease = undefined;
      if (callback === undefined) return;
      try {
        callback();
      } catch {
        // The host release is best effort.
      }
    };
    const fail = (): void => {
      if (opened || disposed) return;
      disposed = true;
      signal.removeEventListener('abort', abort);
      release();
      reject(new Error('The WebRTC data channel failed.'));
    };
    const abort = (): void => {
      fail();
    };
    signal.addEventListener('abort', abort, { once: true });

    const on = (type: string, listener: (event: unknown) => void): void => {
      channel!.addEventListener(type, listener);
      listeners.push([type, listener]);
    };
    const onOpen = (): void => {
      if (opened || disposed) return;
      opened = true;
      signal.removeEventListener('abort', abort);
      resolve({
        send(data: unknown): void {
          channel!.send(data);
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          release();
        },
      });
    };
    const onMessage = (event: unknown): void => {
      if (!opened || disposed) return;
      events.message(eventData(event));
    };
    const onError = (): void => {
      if (!opened) fail();
    };
    const onClose = (): void => {
      if (disposed) return;
      if (!opened) {
        fail();
        return;
      }
      disposed = true;
      release();
      events.close();
    };
    const start = (peer: unknown): void => {
      if (disposed) {
        releasePeer(peer);
        return;
      }
      if (!isPeer(peer)) {
        releasePeer(peer);
        fail();
        return;
      }
      channel = peer.channel;
      hostRelease = typeof peer.release === 'function' ? peer.release.bind(peer) : undefined;
      if (signal.aborted) {
        fail();
        return;
      }
      try {
        on('message', onMessage);
        on('close', onClose);
        on('error', onError);
        on('open', onOpen);
        const state = channel.readyState;
        if (state === 'open') onOpen();
        else if (state === 'closed') onClose();
      } catch {
        fail();
        return;
      }
    };

    let result: WebRtcPeer | Promise<WebRtcPeer>;
    try {
      result = config.connect(config.endpoint, signal);
    } catch {
      fail();
      return;
    }
    Promise.resolve(result).then(start, () => {
      fail();
    });
  });
}

/**
 * WebRTC data-channel factory. The host selects the trusted peer in `connect`
 * and owns everything it hands over; the adapter only detaches listeners and
 * calls `release` on teardown.
 */
export function webRtcChannel(options: WebRtcChannelOptions): NetworkChannel {
  requireOptions(options, 'webRtcChannel');
  const endpoint = normalizeSignalPath(options.endpoint);
  if (typeof options.connect !== 'function') {
    throw new TypeError('connect must be a function that selects a peer.');
  }
  return createDuplexChannel(options, createWebRtcConnection({ endpoint, connect: options.connect }));
}
