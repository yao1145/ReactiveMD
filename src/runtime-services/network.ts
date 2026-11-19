import type { LocalValue } from '../local/types';

/** JSON values accepted by a named network channel. */
export type Json = null | boolean | number | string | readonly Json[]
  | { readonly [key: string]: Json };
export type JsonPayload = Readonly<Record<string, Json>>;

export interface ChannelError {
  readonly code: 'unavailable' | 'invalid-data' | 'rejected' | 'transport' | 'unconfirmed' | 'cancelled';
  readonly message: string;
}
export type SubmitResult = { ok: true; readonly data?: Json } | { ok: false; error: ChannelError };
export type StreamStatus = 'connecting' | 'open' | 'closed';
export type StreamEvent =
  | { type: 'status'; state: StreamStatus }
  | { type: 'data'; value: Json }
  | { type: 'error'; error: ChannelError };

export interface ComponentNetwork {
  supports(channel: string, operation: 'submit' | 'subscribe'): boolean;
  submit(channel: string, payload: JsonPayload, options?: SubmitOptions): Promise<SubmitResult>;
  subscribe(channel: string, listener: (event: StreamEvent) => void): () => void;
}
export interface SubmitOptions {
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

/** Return true to accept the data or a safe, user-facing string to reject it. */
export type ChannelValidator<T> = (value: T) => boolean | string;

export interface SubmitAdapterContext {
  readonly signal: AbortSignal;
  /** Shared by both directions of this named channel until the runtime disposes it. */
  readonly sessionSignal: AbortSignal;
  readonly requestId: string;
  readonly idempotencyKey?: string;
}
export interface SubmitAdapter {
  readonly validate: ChannelValidator<JsonPayload>;
  /** Maximum encoded JSON bytes. Defaults to 64 KiB. */
  readonly maxBytes?: number;
  send(payload: JsonPayload, context: SubmitAdapterContext): SubmitResult | Promise<SubmitResult>;
}
export interface SubscribeAdapterContext {
  readonly signal: AbortSignal;
  /** Shared by both directions of this named channel until the runtime disposes it. */
  readonly sessionSignal: AbortSignal;
  status(state: StreamStatus): void;
  data(value: unknown): void;
  error(error: ChannelError): void;
}
export interface SubscribeAdapter {
  readonly validate: ChannelValidator<Json>;
  /** Maximum decoded message size measured in encoded JSON bytes. Defaults to 64 KiB. */
  readonly maxBytes?: number;
  open(context: SubscribeAdapterContext): (() => void) | Promise<() => void>;
}
export type NetworkExternalValuesMapper = (value: Json) => Readonly<Record<string, LocalValue>> | undefined;
export interface NetworkChannel {
  readonly submit?: SubmitAdapter;
  readonly subscribe?: SubscribeAdapter;
  /** Opt in to a document subscription that maps validated messages to declared externals. */
  readonly mapExternalValues?: NetworkExternalValuesMapper;
}
export interface NetworkConfig {
  readonly channels: Readonly<Record<string, NetworkChannel>>;
  /** Thrown listener errors are isolated. The host receives a safe summary. */
  readonly onListenerError?: (error: ChannelError) => void;
}
export interface NetworkSession {
  readonly network: ComponentNetwork;
  bindExternalValues(write: (values: Readonly<Record<string, LocalValue>>) => void): (() => void) | undefined;
  dispose(): void;
}

export const DEFAULT_NETWORK_MAX_BYTES = 64 * 1024;
const UNAVAILABLE: ChannelError = Object.freeze({ code: 'unavailable', message: 'This channel operation is unavailable.' });
const CANCELLED: ChannelError = Object.freeze({ code: 'cancelled', message: 'The operation was cancelled.' });
const INVALID: ChannelError = Object.freeze({ code: 'invalid-data', message: 'The channel data is invalid.' });
const TRANSPORT: ChannelError = Object.freeze({ code: 'transport', message: 'The channel could not communicate with its endpoint.' });
const LISTENER_ERROR: ChannelError = Object.freeze({ code: 'rejected', message: 'A channel listener failed.' });
let nextRequestId = 0;

function failure(error: ChannelError): SubmitResult {
  return { ok: false, error };
}

export const unavailableNetwork: ComponentNetwork = Object.freeze({
  supports: () => false,
  submit: async () => failure(UNAVAILABLE),
  subscribe(_channel: string, listener: (event: StreamEvent) => void) {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try { listener({ type: 'error', error: UNAVAILABLE }); } catch { /* Detached listener. */ }
    });
    return () => { active = false; };
  },
});

function budget(maxBytes = DEFAULT_NETWORK_MAX_BYTES): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('A channel byte budget must be a positive integer.');
  }
  return maxBytes;
}

/** Snapshot plain JSON before validation so each listener and adapter sees the same data. */
function checkedJson(input: unknown, maxBytes: number): Json {
  let remaining = maxBytes;
  function charge(size: number): void {
    remaining -= size;
    if (remaining < 0) throw new RangeError();
  }
  function copy(value: unknown, depth: number): Json {
    charge(1);
    if (depth > 64) throw new RangeError();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      charge(value.length);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
      if (value.length > remaining) throw new RangeError();
      const result: Json[] = [];
      for (let i = 0; i < value.length; i += 1) {
        const entry = Object.getOwnPropertyDescriptor(value, String(i));
        if (!entry || !('value' in entry)) throw new TypeError();
        result.push(copy(entry.value, depth + 1));
      }
      return Object.freeze(result);
    }
    if (typeof value !== 'object' || value === null) throw new TypeError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const result: Record<string, Json> = Object.create(null);
    for (const key of Object.keys(value)) {
      charge(key.length);
      const entry = Object.getOwnPropertyDescriptor(value, key);
      if (!entry || !('value' in entry)) throw new TypeError();
      result[key] = copy(entry.value, depth + 1);
    }
    return Object.freeze(result);
  }
  const result = copy(input, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) throw new RangeError();
  return result;
}

function snapshotSubmitResult(result: SubmitResult): SubmitResult {
  if (!result.ok) return result;
  try {
    const entry = Object.getOwnPropertyDescriptor(result, 'data');
    if (entry && 'value' in entry && entry.value !== undefined) {
      return { ok: true, data: checkedJson(entry.value, DEFAULT_NETWORK_MAX_BYTES) };
    }
  } catch { /* Unusable receipt data does not change an acknowledged write. */ }
  return { ok: true };
}

function validate<T>(value: T, validator: ChannelValidator<T>): ChannelError | undefined {
  const result = validator(value);
  if (result === true) return undefined;
  return typeof result === 'string' && result.trim()
    ? Object.freeze({ code: 'invalid-data', message: result })
    : INVALID;
}

interface Listener {
  readonly notify: (event: StreamEvent) => void;
  initial: boolean;
}
interface StreamNotification {
  readonly event: StreamEvent;
  readonly recipients: Listener[];
  readonly status: StreamStatus;
}
interface ChannelStream {
  readonly controller: AbortController;
  readonly listeners: Set<Listener>;
  readonly events: StreamNotification[];
  status: StreamStatus;
  release?: () => void;
  dispatching: boolean;
}

export function createNetworkSession(config?: NetworkConfig): NetworkSession {
  if (!config) return { network: unavailableNetwork, bindExternalValues: () => undefined, dispose() {} };
  const channels = new Map<string, NetworkChannel>();
  const mappings = new Map<string, NetworkExternalValuesMapper>();
  for (const [name, channel] of Object.entries(config.channels)) {
    const { submit, subscribe, mapExternalValues } = channel;
    if (submit && (typeof submit.validate !== 'function' || typeof submit.send !== 'function')) {
      throw new TypeError('A submit channel requires a validator and a send function.');
    }
    if (subscribe && (typeof subscribe.validate !== 'function' || typeof subscribe.open !== 'function')) {
      throw new TypeError('A subscription channel requires a validator and an open function.');
    }
    if (mapExternalValues !== undefined) {
      if (!subscribe || typeof mapExternalValues !== 'function') {
        throw new TypeError('Mapping external values requires a subscription and a mapper function.');
      }
      mappings.set(name, mapExternalValues.bind(channel));
    }
    channels.set(name, {
      ...(submit && { submit: { maxBytes: budget(submit.maxBytes), validate: submit.validate.bind(submit), send: submit.send.bind(submit) } }),
      ...(subscribe && { subscribe: { maxBytes: budget(subscribe.maxBytes), validate: subscribe.validate.bind(subscribe), open: subscribe.open.bind(subscribe) } }),
    });
  }

  const lifetimes = new Map<string, AbortController>();
  const pending = new Set<() => void>();
  const streams = new Map<string, ChannelStream>();
  let disposed = false;

  function sessionSignal(channel: string): AbortSignal {
    let lifetime = lifetimes.get(channel);
    if (!lifetime) lifetimes.set(channel, lifetime = new AbortController());
    return lifetime.signal;
  }

  function notify(listener: Listener, event: StreamEvent): void {
    try {
      listener.notify(Object.freeze(event));
    } catch {
      try { config?.onListenerError?.(LISTENER_ERROR); } catch { /* The host reporter is also isolated. */ }
    }
  }

  function runRelease(release?: () => void): void {
    try { release?.(); } catch { /* Continue releasing other resources. */ }
  }

  function stopStream(channel: string, stream: ChannelStream): void {
    streams.delete(channel);
    stream.listeners.clear();
    stream.events.length = 0;
    stream.controller.abort();
    runRelease(stream.release);
  }

  function emit(stream: ChannelStream, event: StreamEvent): void {
    if (disposed || stream.controller.signal.aborted) return;
    stream.events.push({ event, recipients: [...stream.listeners], status: stream.status });
    if (stream.dispatching) return;
    stream.dispatching = true;
    try {
      for (let i = 0; i < stream.events.length; i += 1) {
        const { event: current, recipients, status } = stream.events[i];
        for (const listener of recipients) {
          if (!stream.listeners.has(listener)) continue;
          if (!listener.initial) {
            listener.initial = true;
            if (current.type !== 'status') notify(listener, { type: 'status', state: status });
          }
          if (stream.listeners.has(listener)) notify(listener, current);
        }
      }
    } finally {
      stream.events.length = 0;
      stream.dispatching = false;
    }
  }

  function openStream(channel: string, stream: ChannelStream, adapter: SubscribeAdapter): void {
    const signal = stream.controller.signal;
    if (signal.aborted) return;
    const status = (state: StreamStatus): void => {
      if (signal.aborted || stream.status === state) return;
      stream.status = state;
      emit(stream, { type: 'status', state });
    };
    const error = (problem: ChannelError): void => {
      emit(stream, { type: 'error', error: Object.freeze({ ...problem }) });
    };
    const data = (input: unknown): void => {
      if (signal.aborted) return;
      let value: Json;
      let problem: ChannelError | undefined;
      try {
        value = checkedJson(input, adapter.maxBytes ?? DEFAULT_NETWORK_MAX_BYTES);
        problem = validate(value, adapter.validate);
      } catch {
        error(INVALID);
        return;
      }
      if (problem) error(problem);
      else emit(stream, { type: 'data', value });
    };
    const failed = (): void => {
      if (signal.aborted) return;
      error(TRANSPORT);
      status('closed');
    };
    const opened = (release: () => void): void => {
      if (signal.aborted) runRelease(release);
      else stream.release = release;
    };
    try {
      const release = adapter.open({ signal, sessionSignal: sessionSignal(channel), status, error, data });
      if (typeof release === 'function') opened(release);
      else void Promise.resolve(release).then(opened, failed);
    } catch {
      failed();
    }
  }

  const network: ComponentNetwork = {
    supports(channel, operation) {
      return !disposed && (operation === 'submit' || operation === 'subscribe')
        && channels.get(channel)?.[operation] !== undefined;
    },
    async submit(channel, input, options) {
      const adapter = disposed ? undefined : channels.get(channel)?.submit;
      if (!adapter) return failure(UNAVAILABLE);
      if (options?.signal?.aborted) return failure(CANCELLED);
      let payload: JsonPayload;
      try {
        const data = checkedJson(input, adapter.maxBytes ?? DEFAULT_NETWORK_MAX_BYTES);
        if (data === null || typeof data !== 'object' || Array.isArray(data)) return failure(INVALID);
        payload = data as JsonPayload;
        const problem = validate(payload, adapter.validate);
        if (problem) return failure(problem);
      } catch {
        return failure(INVALID);
      }
      const caller = options?.signal;
      if (disposed || caller?.aborted) return failure(CANCELLED);
      const controller = new AbortController();
      return new Promise<SubmitResult>((resolve) => {
        let settled = false;
        const finish = (result: SubmitResult): void => {
          if (settled) return;
          settled = true;
          caller?.removeEventListener('abort', cancel);
          pending.delete(cancel);
          resolve(snapshotSubmitResult(result));
        };
        const cancel = (): void => {
          finish(failure(CANCELLED));
          controller.abort();
        };
        pending.add(cancel);
        caller?.addEventListener('abort', cancel, { once: true });
        try {
          const result = adapter.send(payload, {
            signal: controller.signal,
            sessionSignal: sessionSignal(channel),
            requestId: String(++nextRequestId),
            ...(options?.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
          });
          void Promise.resolve(result).then(finish, () => finish(failure(TRANSPORT)));
        } catch {
          finish(failure(TRANSPORT));
        }
      });
    },
    subscribe(channel, callback) {
      if (disposed) return unavailableNetwork.subscribe(channel, callback);
      const listener: Listener = { notify: callback, initial: false };
      const adapter = channels.get(channel)?.subscribe;
      if (!adapter) {
        let active = true;
        queueMicrotask(() => {
          if (active && !disposed) notify(listener, { type: 'error', error: UNAVAILABLE });
        });
        return () => { active = false; };
      }
      const existing = streams.get(channel);
      const stream: ChannelStream = existing ?? {
        controller: new AbortController(),
        listeners: new Set(),
        events: [],
        status: 'connecting',
        dispatching: false,
      };
      stream.listeners.add(listener);
      if (!existing) streams.set(channel, stream);
      queueMicrotask(() => {
        if (stream.listeners.has(listener) && !listener.initial) {
          listener.initial = true;
          notify(listener, { type: 'status', state: stream.status });
        }
        if (!existing) openStream(channel, stream, adapter);
      });
      return () => {
        if (stream.listeners.delete(listener) && stream.listeners.size === 0) stopStream(channel, stream);
      };
    },
  };

  return {
    network: Object.freeze(network),
    bindExternalValues(write) {
      if (disposed || mappings.size === 0) return undefined;
      const releases = [...mappings].map(([channel, map]) => network.subscribe(channel, event => {
        if (event.type !== 'data') return;
        const values = map(event.value);
        if (values !== undefined) write(values);
      }));
      return () => { for (const release of releases) release(); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of pending) cancel();
      for (const [channel, stream] of streams) stopStream(channel, stream);
      for (const lifetime of lifetimes.values()) lifetime.abort();
      lifetimes.clear();
      channels.clear();
      mappings.clear();
    },
  };
}
