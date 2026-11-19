import { describe, expect, it, vi } from 'vitest';
import {
  webRtcChannel,
  webSocketChannel,
  type DuplexDataChannelLike,
  type DuplexSocketLike,
  type DuplexTimers,
  type WebRtcPeer,
} from '../src/runtime-services/browser/duplex';
import type {
  JsonPayload,
  NetworkChannel,
  SubmitResult,
  SubscribeAdapterContext,
} from '../src/runtime-services/network';

const payload: JsonPayload = { choice: 'yes', comment: '' };

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

function decode(raw: unknown): Record<string, unknown> {
  return JSON.parse(String(raw)) as Record<string, unknown>;
}

/** Timers the adapter cannot run until a test advances them. */
class ControlledTimers implements DuplexTimers {
  private nextHandle = 1;
  private now = 0;
  private readonly tasks = new Map<number, { due: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.tasks.set(handle, { due: this.now + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.tasks.delete(handle);
  }

  advance(delayMs: number): void {
    const target = this.now + delayMs;
    for (;;) {
      let next: { handle: number; due: number; callback: () => void } | undefined;
      for (const [handle, task] of this.tasks) {
        if (task.due <= target && (next === undefined || task.due < next.due)) {
          next = { handle, due: task.due, callback: task.callback };
        }
      }
      if (next === undefined) break;
      this.tasks.delete(next.handle);
      this.now = next.due;
      next.callback();
    }
    this.now = target;
  }

  get pending(): number {
    return this.tasks.size;
  }
}

type FakeListener = (event: unknown) => void;

function countListeners(listeners: Map<string, Set<FakeListener>>): number {
  let count = 0;
  for (const set of listeners.values()) count += set.size;
  return count;
}

class FakeSocket implements DuplexSocketLike {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<FakeListener>>();
  closed = false;

  constructor(readonly url: string, readonly protocols: readonly string[]) {}

  send(data: unknown): void {
    if (this.closed) throw new Error('The fake socket is closed.');
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, listener: FakeListener): void {
    const set = this.listeners.get(type) ?? new Set<FakeListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  open(): void {
    this.emit('open');
  }

  push(data: unknown): void {
    this.emit('message', { data });
  }

  /** Simulates the endpoint closing the connection. */
  serverClose(): void {
    this.closed = true;
    this.emit('close');
  }

  listenerCount(): number {
    return countListeners(this.listeners);
  }
}

function webSocketHarness(maxMessageBytes?: number) {
  const sockets: FakeSocket[] = [];
  const timers = new ControlledTimers();
  const channel = webSocketChannel({
    endpoint: 'wss://example.test/survey',
    validateSubmit: () => true,
    validateSubscribe: () => true,
    ackTimeoutMs: 1_000,
    connectTimeoutMs: 200,
    maxMessageBytes,
    timers,
    webSocket: (url, protocols) => {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket;
    },
  });
  return { channel, sockets, timers };
}

class FakeDataChannel implements DuplexDataChannelLike {
  readyState = 'connecting';
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<FakeListener>>();

  send(data: unknown): void {
    if (this.readyState !== 'open') throw new Error('The fake data channel is not open.');
    this.sent.push(data);
  }

  addEventListener(type: string, listener: FakeListener): void {
    const set = this.listeners.get(type) ?? new Set<FakeListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  open(): void {
    this.readyState = 'open';
    this.emit('open');
  }

  push(data: unknown): void {
    this.emit('message', { data });
  }

  /** Simulates the remote peer closing the borrowed channel. */
  remoteClose(): void {
    this.readyState = 'closed';
    this.emit('close');
  }

  listenerCount(): number {
    return countListeners(this.listeners);
  }
}

interface WebRtcHarnessOptions {
  readonly connect?: (endpoint: string, signal: AbortSignal) => WebRtcPeer | Promise<WebRtcPeer>;
}

function webRtcHarness(options: WebRtcHarnessOptions = {}) {
  const dataChannels: FakeDataChannel[] = [];
  const releases: ReturnType<typeof vi.fn>[] = [];
  const endpoints: string[] = [];
  const timers = new ControlledTimers();
  const channel = webRtcChannel({
    endpoint: 'survey-peer',
    validateSubmit: () => true,
    validateSubscribe: () => true,
    ackTimeoutMs: 1_000,
    connectTimeoutMs: 200,
    timers,
    connect(endpoint, signal) {
      endpoints.push(endpoint);
      if (options.connect !== undefined) return options.connect(endpoint, signal);
      const dataChannel = new FakeDataChannel();
      const release = vi.fn();
      dataChannels.push(dataChannel);
      releases.push(release);
      return { channel: dataChannel, release };
    },
  });
  return { channel, dataChannels, releases, endpoints, timers };
}

interface SubmitHandles {
  readonly result: Promise<SubmitResult>;
  readonly controller: AbortController;
}

function submit(
  channel: NetworkChannel,
  sessionSignal: AbortSignal,
  requestId: string,
  options: { readonly payload?: JsonPayload; readonly idempotencyKey?: string } = {},
): SubmitHandles {
  const adapter = channel.submit;
  if (adapter === undefined) throw new TypeError('Expected a submit adapter.');
  const controller = new AbortController();
  const outcome = adapter.send(options.payload ?? payload, {
    signal: controller.signal,
    sessionSignal,
    requestId,
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  });
  return { controller, result: Promise.resolve(outcome) };
}

interface SubscriptionHandles {
  readonly status: ReturnType<typeof vi.fn>;
  readonly data: ReturnType<typeof vi.fn>;
  readonly error: ReturnType<typeof vi.fn>;
  release(): void;
}

function subscribe(channel: NetworkChannel, sessionSignal: AbortSignal): SubscriptionHandles {
  const adapter = channel.subscribe;
  if (adapter === undefined) throw new TypeError('Expected a subscribe adapter.');
  const status = vi.fn();
  const data = vi.fn();
  const error = vi.fn();
  const context: SubscribeAdapterContext = {
    signal: new AbortController().signal,
    sessionSignal,
    status,
    data,
    error,
  };
  const release = adapter.open(context);
  if (typeof release !== 'function') throw new TypeError('Expected a synchronous subscription release.');
  return { status, data, error, release };
}

describe('webSocketChannel', () => {
  it('counts UTF-8 bytes before decoding an acknowledgement', async () => {
    const ack = { type: 'ack', requestId: 'utf8', padding: '😀' };
    const atLimit = JSON.stringify(ack);
    const maxMessageBytes = new TextEncoder().encode(atLimit).length;
    const oversized = JSON.stringify({ ...ack, padding: '😀😀' });
    expect(oversized.length).toBeLessThanOrEqual(maxMessageBytes);

    const { channel, sockets } = webSocketHarness(maxMessageBytes);
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    const { result } = submit(channel, session.signal, ack.requestId);
    try {
      await settle();
      sockets[0].open();
      await settle();
      let confirmed = false;
      void result.then(() => { confirmed = true; });
      sockets[0].push(oversized);
      await settle();
      expect(confirmed).toBe(false);
      expect(subscription.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'invalid-data' }));
      sockets[0].push(atLimit);
      await expect(result).resolves.toEqual({ ok: true });
    } finally {
      session.abort();
    }
  });

  it('matches acknowledgements and rejections to their requestId', async () => {
    const { channel, sockets } = webSocketHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://example.test/survey');
    expect(sockets[0].protocols).toEqual([]);
    sockets[0].open();
    await settle();
    expect(subscription.status).toHaveBeenLastCalledWith('open');

    const first = submit(channel, session.signal, 'req-a', { idempotencyKey: 'key-a' });
    const second = submit(channel, session.signal, 'req-b');
    expect(sockets[0].sent).toHaveLength(2);
    expect(decode(sockets[0].sent[0])).toEqual({
      type: 'submit',
      requestId: 'req-a',
      payload,
      idempotencyKey: 'key-a',
    });
    expect(decode(sockets[0].sent[1])).toEqual({ type: 'submit', requestId: 'req-b', payload });
    expect(sockets).toHaveLength(1);

    sockets[0].push(JSON.stringify({ type: 'ack', requestId: 'req-b' }));
    await expect(second.result).resolves.toEqual({ ok: true });

    let firstSettled = false;
    void first.result.then(() => { firstSettled = true; });
    await settle();
    expect(firstSettled).toBe(false);

    sockets[0].push(JSON.stringify({ type: 'reject', requestId: 'req-a', message: '\n invalid  choice \t' }));
    await expect(first.result).resolves.toEqual({
      ok: false,
      error: { code: 'rejected', message: 'invalid  choice' },
    });
    expect(sockets[0].closed).toBe(false);

    sockets[0].push(JSON.stringify({ type: 'data', value: 7 }));
    expect(subscription.data).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('reports a sent submission as unconfirmed when its acknowledgement times out', async () => {
    const { channel, sockets, timers } = webSocketHarness();
    const session = new AbortController();
    const { result } = submit(channel, session.signal, 'req-timeout');
    await settle();

    // The submit waits for the connection instead of failing or sending early.
    expect(sockets[0].sent).toHaveLength(0);
    sockets[0].open();
    await settle();
    expect(sockets[0].sent).toHaveLength(1);

    const observed: SubmitResult[] = [];
    void result.then((value) => { observed.push(value); });
    timers.advance(1_000);
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'unconfirmed' } });
    expect(observed).toHaveLength(1);
    expect(timers.pending).toBe(0);

    // No subscribers and nothing pending: the connection is released.
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].listenerCount()).toBe(0);

    // A late acknowledgement cannot revive the finished submission.
    sockets[0].push(JSON.stringify({ type: 'ack', requestId: 'req-timeout' }));
    await settle();
    expect(observed).toHaveLength(1);
  });

  it('reports a submission as transport when its connection attempt fails', async () => {
    const { channel, sockets, timers } = webSocketHarness();
    const session = new AbortController();
    const { result } = submit(channel, session.signal, 'req-connect');
    await settle();
    expect(sockets[0].sent).toHaveLength(0);

    sockets[0].emit('error');
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'transport' } });
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].listenerCount()).toBe(0);
    expect(timers.pending).toBe(0);
  });

  it('reports a sent submission as unconfirmed when the transport closes', async () => {
    const { channel, sockets } = webSocketHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();
    sockets[0].open();
    await settle();

    const { result } = submit(channel, session.signal, 'req-close');
    expect(sockets[0].sent).toHaveLength(1);

    sockets[0].serverClose();
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'unconfirmed' } });
    expect(subscription.error).toHaveBeenLastCalledWith({ code: 'transport', message: expect.any(String) });
    expect(subscription.status).toHaveBeenLastCalledWith('closed');
    expect(sockets[0].listenerCount()).toBe(0);
  });

  it('keeps the shared connection while an unconfirmed submission outlives its last subscriber', async () => {
    const { channel, sockets } = webSocketHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();
    sockets[0].open();
    await settle();

    const { result } = submit(channel, session.signal, 'req-keep');
    expect(sockets[0].sent).toHaveLength(1);

    subscription.release();
    await settle();
    expect(sockets[0].closed).toBe(false);
    expect(sockets[0].listenerCount()).toBeGreaterThan(0);

    sockets[0].push(JSON.stringify({ type: 'ack', requestId: 'req-keep' }));
    await expect(result).resolves.toEqual({ ok: true });
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].listenerCount()).toBe(0);
  });

  it('shares one socket between subscriptions in the same session and keeps the others alive', async () => {
    const { channel, sockets } = webSocketHarness();
    const session = new AbortController();
    const first = subscribe(channel, session.signal);
    const second = subscribe(channel, session.signal);
    await settle();
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    await settle();
    expect(first.status).toHaveBeenLastCalledWith('open');
    expect(second.status).toHaveBeenLastCalledWith('open');

    sockets[0].push(JSON.stringify({ type: 'data', value: 'shared' }));
    expect(first.data).toHaveBeenCalledWith('shared');
    expect(second.data).toHaveBeenCalledWith('shared');

    first.release();
    expect(sockets[0].closed).toBe(false);
    sockets[0].push(JSON.stringify({ type: 'data', value: 'still' }));
    expect(second.data).toHaveBeenLastCalledWith('still');

    second.release();
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].listenerCount()).toBe(0);
  });

  it('drops a late acknowledgement after cancellation and closes an unshared connection', async () => {
    const { channel, sockets } = webSocketHarness();
    const session = new AbortController();
    const { result, controller } = submit(channel, session.signal, 'req-cancel');
    await settle();
    sockets[0].open();
    await settle();
    expect(sockets[0].sent).toHaveLength(1);

    controller.abort();
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(sockets[0].closed).toBe(true);

    sockets[0].push(JSON.stringify({ type: 'ack', requestId: 'req-cancel' }));
    await settle();
    expect(sockets[0].listenerCount()).toBe(0);
  });

  it('aborts a pending connect when the only subscriber leaves and reconnects later', async () => {
    const { channel, sockets, timers } = webSocketHarness();
    const session = new AbortController();
    const first = subscribe(channel, session.signal);
    await settle();
    expect(sockets).toHaveLength(1);
    expect(first.status).toHaveBeenCalledExactlyOnceWith('connecting');

    first.release();
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].listenerCount()).toBe(0);
    expect(timers.pending).toBe(0);

    // The abandoned socket can no longer report status or data.
    sockets[0].open();
    sockets[0].push(JSON.stringify({ type: 'data', value: 1 }));
    await settle();
    expect(first.status).toHaveBeenCalledTimes(1);
    expect(first.data).not.toHaveBeenCalled();

    // A later operation on the same session opens a new connection.
    const second = subscribe(channel, session.signal);
    await settle();
    expect(sockets).toHaveLength(2);
    second.release();
    expect(sockets[1].closed).toBe(true);
    expect(sockets[1].listenerCount()).toBe(0);
  });

  it('cancels pending work and closes the shared socket when the session ends', async () => {
    const { channel, sockets, timers } = webSocketHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();
    sockets[0].open();
    await settle();

    const { result } = submit(channel, session.signal, 'req-session');
    expect(sockets[0].sent).toHaveLength(1);

    session.abort();
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].listenerCount()).toBe(0);
    expect(timers.pending).toBe(0);

    sockets[0].push(JSON.stringify({ type: 'ack', requestId: 'req-session' }));
    subscription.release();
    expect(subscription.status).not.toHaveBeenCalledWith('closed');
  });
});

describe('webRtcChannel', () => {
  it('fails immediately when the host hands over a closed data channel', async () => {
    const dataChannel = new FakeDataChannel();
    dataChannel.readyState = 'closed';
    const release = vi.fn();
    const { channel, timers } = webRtcHarness({ connect: () => ({ channel: dataChannel, release }) });
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    const { result } = submit(channel, session.signal, 'already-closed');
    try {
      await settle();
      expect(timers.pending).toBe(0);
      expect(subscription.status).toHaveBeenLastCalledWith('closed');
      expect(subscription.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'transport' }));
      await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'transport' } });
      expect(dataChannel.sent).toEqual([]);
      expect(dataChannel.listenerCount()).toBe(0);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      session.abort();
    }
  });

  it('matches acknowledgements and rejections to their requestId', async () => {
    const { channel, dataChannels, releases, endpoints } = webRtcHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();

    expect(endpoints).toEqual(['survey-peer']);
    expect(dataChannels).toHaveLength(1);
    dataChannels[0].open();
    await settle();
    expect(subscription.status).toHaveBeenLastCalledWith('open');

    const first = submit(channel, session.signal, 'rtc-a');
    const second = submit(channel, session.signal, 'rtc-b');
    expect(dataChannels[0].sent).toHaveLength(2);
    expect(decode(dataChannels[0].sent[0])).toEqual({ type: 'submit', requestId: 'rtc-a', payload });

    dataChannels[0].push(JSON.stringify({ type: 'reject', requestId: 'rtc-b', message: 'blocked' }));
    await expect(second.result).resolves.toEqual({
      ok: false,
      error: { code: 'rejected', message: 'blocked' },
    });

    let firstSettled = false;
    void first.result.then(() => { firstSettled = true; });
    await settle();
    expect(firstSettled).toBe(false);

    dataChannels[0].push(JSON.stringify({ type: 'ack', requestId: 'rtc-a' }));
    await expect(first.result).resolves.toEqual({ ok: true });
    expect(releases[0]).not.toHaveBeenCalled();

    dataChannels[0].push(JSON.stringify({ type: 'data', value: { total: 4 } }));
    expect(subscription.data).toHaveBeenCalledExactlyOnceWith({ total: 4 });
  });

  it('reports an acknowledgement timeout as unconfirmed and releases the borrowed channel', async () => {
    const { channel, dataChannels, releases, timers } = webRtcHarness();
    const session = new AbortController();
    const { result } = submit(channel, session.signal, 'rtc-timeout');
    await settle();

    // The submit waits for the borrowed channel to open.
    expect(dataChannels[0].sent).toHaveLength(0);
    dataChannels[0].open();
    await settle();
    expect(dataChannels[0].sent).toHaveLength(1);

    const observed: SubmitResult[] = [];
    void result.then((value) => { observed.push(value); });
    timers.advance(1_000);
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'unconfirmed' } });
    expect(observed).toHaveLength(1);
    expect(timers.pending).toBe(0);
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(dataChannels[0].listenerCount()).toBe(0);

    dataChannels[0].push(JSON.stringify({ type: 'ack', requestId: 'rtc-timeout' }));
    await settle();
    expect(observed).toHaveLength(1);
  });

  it('reports a sent submission as unconfirmed when the peer closes the channel', async () => {
    const { channel, dataChannels, releases } = webRtcHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();
    dataChannels[0].open();
    await settle();

    const { result } = submit(channel, session.signal, 'rtc-close');
    expect(dataChannels[0].sent).toHaveLength(1);

    dataChannels[0].remoteClose();
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'unconfirmed' } });
    expect(subscription.error).toHaveBeenLastCalledWith({ code: 'transport', message: expect.any(String) });
    expect(subscription.status).toHaveBeenLastCalledWith('closed');
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(dataChannels[0].listenerCount()).toBe(0);
  });

  it('keeps the borrowed channel while an unconfirmed submission outlives its last subscriber', async () => {
    const { channel, dataChannels, releases } = webRtcHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();
    dataChannels[0].open();
    await settle();

    const { result } = submit(channel, session.signal, 'rtc-keep');
    subscription.release();
    await settle();
    expect(releases[0]).not.toHaveBeenCalled();
    expect(dataChannels[0].listenerCount()).toBeGreaterThan(0);

    dataChannels[0].push(JSON.stringify({ type: 'ack', requestId: 'rtc-keep' }));
    await expect(result).resolves.toEqual({ ok: true });
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(dataChannels[0].listenerCount()).toBe(0);
  });

  it('releases a borrowed peer that connects after the submission was cancelled', async () => {
    let resolvePeer: (peer: WebRtcPeer) => void = () => {};
    const peer = new Promise<WebRtcPeer>((resolve) => { resolvePeer = resolve; });
    const dataChannel = new FakeDataChannel();
    const release = vi.fn();
    let connectSignal: AbortSignal | undefined;
    const { channel } = webRtcHarness({
      connect: (_endpoint, signal) => {
        connectSignal = signal;
        return peer;
      },
    });
    const session = new AbortController();
    const { result, controller } = submit(channel, session.signal, 'rtc-late');
    await settle();

    controller.abort();
    expect(connectSignal?.aborted).toBe(true);
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });

    resolvePeer({ channel: dataChannel, release });
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(dataChannel.listenerCount()).toBe(0);
  });

  it('drops a late acknowledgement after cancellation and releases on last leave', async () => {
    const { channel, dataChannels, releases } = webRtcHarness();
    const session = new AbortController();
    const subscription = subscribe(channel, session.signal);
    await settle();
    dataChannels[0].open();
    await settle();

    const { result, controller } = submit(channel, session.signal, 'rtc-cancel');
    expect(dataChannels[0].sent).toHaveLength(1);
    controller.abort();
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });

    dataChannels[0].push(JSON.stringify({ type: 'ack', requestId: 'rtc-cancel' }));
    await settle();
    expect(releases[0]).not.toHaveBeenCalled();
    expect(dataChannels[0].listenerCount()).toBeGreaterThan(0);

    subscription.release();
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(dataChannels[0].listenerCount()).toBe(0);
  });

  it('reports a submission as transport when peer selection fails', async () => {
    const { channel, timers } = webRtcHarness({ connect: () => Promise.reject(new Error('no peer')) });
    const { result } = submit(channel, new AbortController().signal, 'rtc-no-peer');
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'transport' } });
    expect(timers.pending).toBe(0);

    const throwing = webRtcHarness({
      connect: () => {
        throw new Error('signaling down');
      },
    });
    const second = submit(throwing.channel, new AbortController().signal, 'rtc-throw');
    await expect(second.result).resolves.toMatchObject({ ok: false, error: { code: 'transport' } });
    expect(throwing.timers.pending).toBe(0);
  });

  it('reports failed peer selection as transport', async () => {
    const rejected = webRtcHarness({ connect: () => Promise.reject(new Error('no peer')) });
    const first = subscribe(rejected.channel, new AbortController().signal);
    await settle();
    expect(first.error).toHaveBeenCalledWith({ code: 'transport', message: expect.any(String) });
    expect(first.status).toHaveBeenLastCalledWith('closed');

    const throwing = webRtcHarness({
      connect: () => {
        throw new Error('signaling down');
      },
    });
    const second = subscribe(throwing.channel, new AbortController().signal);
    await settle();
    expect(second.error).toHaveBeenCalledWith({ code: 'transport', message: expect.any(String) });
    expect(second.status).toHaveBeenLastCalledWith('closed');
  });
});
