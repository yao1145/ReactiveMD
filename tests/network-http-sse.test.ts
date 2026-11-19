import { describe, expect, it, vi } from 'vitest';
import {
  httpSubmit,
  sseStream,
  type HttpSubmitResponse,
  type SseEventSourceLike,
} from '../src/runtime-services/browser/http-sse';
import { DEFAULT_NETWORK_MAX_BYTES } from '../src/runtime-services/network';
import type {
  JsonPayload,
  SubmitAdapterContext,
  SubscribeAdapterContext,
} from '../src/runtime-services/network';

function submitContext(overrides: Partial<SubmitAdapterContext> = {}): SubmitAdapterContext {
  return {
    signal: new AbortController().signal,
    sessionSignal: new AbortController().signal,
    requestId: 'req-1',
    ...overrides,
  };
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function fetchReturning(response: Response | (() => Promise<Response>)): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return typeof response === 'function' ? response() : response;
    },
  };
}

const payload: JsonPayload = { choice: 'yes', comment: '' };

describe('httpSubmit configuration', () => {
  it('accepts HTTP(S) and same-origin relative endpoints only', () => {
    const validate = (): boolean => true;
    expect(() => httpSubmit({ endpoint: '/api/answers', validate })).not.toThrow();
    expect(() => httpSubmit({ endpoint: 'https://example.test/a', validate })).not.toThrow();
    for (const endpoint of ['', '   ', 'ftp://example.test/a', 'http://', 'https://[::', 'javascript:alert(1)', '//example.test/a', '#anchor', '/a?b c', 'x\\y', 7]) {
      expect(() => httpSubmit({ endpoint: endpoint as unknown as string, validate }))
        .toThrow(/endpoint/);
    }
  });

  it('rejects malformed options at creation without issuing requests', () => {
    const fetch = vi.fn();
    expect(() => httpSubmit({ endpoint: '/a', validate: undefined as never })).toThrow(/validate/);
    expect(() => httpSubmit({ endpoint: '/a', validate: () => true, maxBytes: 0 })).toThrow(/maxBytes/);
    expect(() => httpSubmit({ endpoint: '/a', validate: () => true, maxResponseBytes: 0 })).toThrow(/maxResponseBytes/);
    expect(() => httpSubmit({ endpoint: '/a', validate: () => true, timeoutMs: 2 ** 31 })).toThrow(/timeoutMs/);
    expect(() => httpSubmit({ endpoint: '/a', validate: () => true, headers: { 'bad header': 'x' } })).toThrow(/header/);
    expect(() => httpSubmit({ endpoint: '/a', validate: () => true, credentials: 'yes' as never })).toThrow(/credentials/);
    expect(() => httpSubmit({ endpoint: '/a', validate: () => true, method: 'BAD METHOD' })).toThrow(/method/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('httpSubmit sending', () => {
  it('POSTs JSON with a JSON content type and the idempotency key', async () => {
    const fake = fetchReturning(new Response('', { status: 201 }));
    const adapter = httpSubmit({ endpoint: '/api/answers', validate: () => true, fetch: fake.fetch });

    const result = await adapter.send(payload, submitContext({ idempotencyKey: 'key-7' }));

    expect(result).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(1);
    const [request] = fake.calls;
    expect(request.url).toBe('/api/answers');
    expect(request.init.method).toBe('POST');
    expect(request.init.body).toBe('{"choice":"yes","comment":""}');
    expect(request.init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'key-7',
    });
  });

  it('merges static and computed headers and keeps a host content type', async () => {
    const fake = fetchReturning(new Response('', { status: 200 }));
    const adapter = httpSubmit({
      endpoint: '/a',
      validate: () => true,
      headers: (context) => ({ 'X-Request': context.requestId }),
      encode: () => ({ body: 'a=1', contentType: 'application/x-www-form-urlencoded' }),
      fetch: fake.fetch,
    });
    await adapter.send(payload, submitContext({ idempotencyKey: 'k' }));
    expect(fake.calls[0].init.headers).toEqual({
      'X-Request': 'req-1',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': 'k',
    });
  });

  it('can disable the idempotency header', async () => {
    const fake = fetchReturning(new Response('', { status: 200 }));
    const adapter = httpSubmit({
      endpoint: '/a',
      validate: () => true,
      idempotencyHeader: null,
      fetch: fake.fetch,
    });
    await adapter.send(payload, submitContext({ idempotencyKey: 'k' }));
    expect(fake.calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('distinguishes confirmation, explicit rejection and unknown outcomes', async () => {
    const confirm = httpSubmit({ endpoint: '/a', validate: () => true, fetch: fetchReturning(new Response(null, { status: 204 })).fetch });
    expect(await confirm.send(payload, submitContext())).toEqual({ ok: true });

    const reject = httpSubmit({ endpoint: '/a', validate: () => true, fetch: fetchReturning(new Response('nope', { status: 409 })).fetch });
    expect(await reject.send(payload, submitContext())).toEqual({
      ok: false,
      error: { code: 'rejected', message: expect.stringContaining('409') },
    });

    const unknown = httpSubmit({ endpoint: '/a', validate: () => true, fetch: fetchReturning(new Response('', { status: 503 })).fetch });
    expect(await unknown.send(payload, submitContext())).toEqual({
      ok: false,
      error: { code: 'unconfirmed', message: expect.stringContaining('503') },
    });
  });

  it('reports a lost confirmation as unconfirmed, not rejected', async () => {
    const adapter = httpSubmit({
      endpoint: '/a',
      validate: () => true,
      fetch: async () => {
        throw new TypeError('network down');
      },
    });
    const result = await adapter.send(payload, submitContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unconfirmed');
      expect(result.error.message).not.toContain('network down');
    }
  });

  it('reports cancellation without calling fetch', async () => {
    const fake = fetchReturning(new Response('', { status: 200 }));
    const adapter = httpSubmit({ endpoint: '/a', validate: () => true, fetch: fake.fetch });
    const controller = new AbortController();
    controller.abort();
    const result = await adapter.send(payload, submitContext({ signal: controller.signal }));
    expect(result).toEqual({ ok: false, error: { code: 'cancelled', message: expect.any(String) } });
    expect(fake.calls).toHaveLength(0);

    const duringEncoding = new AbortController();
    const reentrant = httpSubmit({ endpoint: '/a', validate: () => true, fetch: fake.fetch, headers: () => {
      duringEncoding.abort();
      return {};
    } });
    await expect(reentrant.send(payload, submitContext({ signal: duringEncoding.signal }))).resolves.toMatchObject({
      ok: false, error: { code: 'cancelled' },
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('enforces the encoded byte budget', async () => {
    const fake = fetchReturning(new Response('', { status: 200 }));
    const adapter = httpSubmit({ endpoint: '/a', validate: () => true, maxBytes: 4, fetch: fake.fetch });
    const result = await adapter.send({ value: 'long' }, submitContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-data');
    expect(fake.calls).toHaveLength(0);
  });

  it('lets the host interpret the response body', async () => {
    const fake = fetchReturning(new Response('{"accepted":false}', { status: 202 }));
    const adapter = httpSubmit({
      endpoint: '/a',
      validate: () => true,
      fetch: fake.fetch,
      interpret: (response: HttpSubmitResponse) => {
        const body = JSON.parse(response.text) as { accepted: boolean };
        return body.accepted ? undefined : { ok: false, error: { code: 'rejected', message: '业务拒绝' } };
      },
    });
    const result = await adapter.send(payload, submitContext());
    expect(result).toEqual({ ok: false, error: { code: 'rejected', message: '业务拒绝' } });
  });

  it.each([4, undefined])('cancels an oversized interpretation stream (budget option %s)', async (maxResponseBytes) => {
    const cancel = vi.fn();
    const interpret = vi.fn();
    const limit = maxResponseBytes ?? DEFAULT_NETWORK_MAX_BYTES;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        if (limit > 4) stream.enqueue(new Uint8Array(limit - 4));
        stream.enqueue(new TextEncoder().encode('😀'));
        stream.enqueue(new TextEncoder().encode('x'));
      },
      cancel,
    });
    const adapter = httpSubmit({
      endpoint: '/a', validate: () => true, maxResponseBytes,
      fetch: async () => new Response(body, { status: 200 }),
      interpret,
    });
    try {
      await expect(adapter.send(payload, submitContext())).resolves.toMatchObject({
        ok: false, error: { code: 'unconfirmed', message: expect.stringContaining(String(limit)) },
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(interpret).not.toHaveBeenCalled();
    } finally {
      if (!body.locked) await body.cancel();
    }
  });

  it('reads a multibyte character split across chunks at the response limit', async () => {
    const bytes = new TextEncoder().encode('😀');
    const interpret = vi.fn(() => ({ ok: true } as const));
    const adapter = httpSubmit({
      endpoint: '/a', validate: () => true, maxResponseBytes: 4, interpret,
      fetch: async () => new Response(new ReadableStream({
        start(stream) {
          stream.enqueue(bytes.subarray(0, 2));
          stream.enqueue(bytes.subarray(2));
          stream.close();
        },
      })),
    });
    await expect(adapter.send(payload, submitContext())).resolves.toEqual({ ok: true });
    expect(interpret).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: '😀' }));
  });

  it('aborts a stalled fetch by default and reports an unconfirmed outcome', async () => {
    vi.useFakeTimers();
    try {
      const fake = fetchReturning(() => new Promise<Response>(() => {}));
      const adapter = httpSubmit({ endpoint: '/a', validate: () => true, fetch: fake.fetch });
      const result = adapter.send(payload, submitContext());
      await vi.advanceTimersByTimeAsync(14_999);
      expect(fake.calls[0].init.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.calls[0].init.signal?.aborted).toBe(true);
      await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'unconfirmed' } });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes body reading in the deadline and keeps caller cancellation distinct', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const interpret = vi.fn();
      const adapter = httpSubmit({
        endpoint: '/a', validate: () => true, timeoutMs: 20, interpret,
        fetch: async () => new Response(new ReadableStream({ cancel })),
      });
      const timedOut = adapter.send(payload, submitContext());
      await vi.advanceTimersByTimeAsync(20);
      expect(cancel).toHaveBeenCalledOnce();
      await expect(timedOut).resolves.toMatchObject({ ok: false, error: { code: 'unconfirmed' } });

      const caller = new AbortController();
      const cancelled = adapter.send(payload, submitContext({ signal: caller.signal }));
      await vi.advanceTimersByTimeAsync(0);
      caller.abort();
      expect(cancel).toHaveBeenCalledTimes(2);
      await expect(cancelled).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
      expect(interpret).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a missing fetch implementation when nothing is injected', async () => {
    const scope = globalThis as { fetch?: unknown };
    const original = scope.fetch;
    scope.fetch = undefined;
    try {
      const adapter = httpSubmit({ endpoint: '/a', validate: () => true });
      const result = await adapter.send(payload, submitContext());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('transport');
    } finally {
      scope.fetch = original;
    }
  });
});

class FakeEventSource implements SseEventSourceLike {
  readyState = 0;
  readonly closed = vi.fn();
  readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2;
    this.closed();
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    if (type === 'open') this.readyState = 1;
    for (const listener of [...this.listeners.get(type) ?? []]) listener(event as unknown as Event);
  }
}

function subscribeContext(overrides: Partial<SubscribeAdapterContext> = {}): SubscribeAdapterContext {
  return {
    signal: new AbortController().signal,
    sessionSignal: new AbortController().signal,
    status: vi.fn(),
    data: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
}

function sseHarness(options: { maxBytes?: number; events?: readonly string[] } = {}) {
  const sources: FakeEventSource[] = [];
  const adapter = sseStream({
    endpoint: '/api/events',
    validate: () => true,
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    ...options,
  });
  return { adapter, sources };
}

describe('sseStream configuration', () => {
  it('rejects invalid endpoints and event names at creation', () => {
    const validate = (): boolean => true;
    expect(() => sseStream({ endpoint: 'wss://example.test/events', validate })).toThrow(/endpoint/);
    expect(() => sseStream({ endpoint: '/events', validate, events: [] })).toThrow(/event/);
    expect(() => sseStream({ endpoint: '/events', validate, events: ['error'] })).toThrow(/event/);
    expect(() => sseStream({ endpoint: '/events', validate, maxBytes: -1 })).toThrow(/maxBytes/);
  });
});

describe('sseStream opening', () => {
  it('reports status, decodes JSON data and closes on disposal', async () => {
    const { adapter, sources } = sseHarness();
    const context = subscribeContext();
    const dispose = await adapter.open(context);

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('/api/events');
    sources[0].emit('open');
    expect(context.status).toHaveBeenCalledWith('open');

    sources[0].emit('message', { data: '{"yes":18}' });
    expect(context.data).toHaveBeenCalledWith({ yes: 18 });

    dispose();
    expect(sources[0].closed).toHaveBeenCalledTimes(1);
    expect(sources[0].listenerCount()).toBe(0);
    dispose();
    expect(sources[0].closed).toHaveBeenCalledTimes(1);
  });

  it('reports undecodable and oversized messages without dispatching them', () => {
    const { adapter, sources } = sseHarness({ maxBytes: 8 });
    const context = subscribeContext();
    adapter.open(context);

    sources[0].emit('message', { data: 'not json' });
    sources[0].emit('message', { data: '{"long":"value"}' });

    expect(context.data).not.toHaveBeenCalled();
    expect(context.error).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(context.error).mock.calls) {
      expect(call[0].code).toBe('invalid-data');
    }
  });

  it('applies the default raw event budget before decoding', async () => {
    const { adapter, sources } = sseHarness();
    const context = subscribeContext();
    const dispose = await adapter.open(context);
    sources[0].emit('message', { data: ' '.repeat(DEFAULT_NETWORK_MAX_BYTES) + '1' });
    expect(context.data).not.toHaveBeenCalled();
    expect(context.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid-data' }));
    dispose();
  });

  it('reports a terminal client error as closed', () => {
    const { adapter, sources } = sseHarness();
    const context = subscribeContext();
    adapter.open(context);

    sources[0].readyState = 2;
    sources[0].emit('error');

    expect(context.error).toHaveBeenCalledWith({ code: 'transport', message: expect.any(String) });
    expect(context.status).toHaveBeenCalledWith('closed');
    expect(sources[0].listenerCount()).toBe(0);
  });

  it('reports a retrying client as connecting again', () => {
    const { adapter, sources } = sseHarness();
    const context = subscribeContext();
    adapter.open(context);
    sources[0].emit('open');

    sources[0].readyState = 0;
    sources[0].emit('error');

    expect(context.status).toHaveBeenLastCalledWith('connecting');
    expect(sources[0].listenerCount()).toBeGreaterThan(0);
  });

  it('closes when the operation or the session is cancelled', () => {
    const { adapter, sources } = sseHarness();
    const operation = new AbortController();
    const session = new AbortController();
    adapter.open(subscribeContext({ signal: operation.signal, sessionSignal: session.signal }));
    operation.abort();
    expect(sources[0].closed).toHaveBeenCalledTimes(1);

    const second = sseHarness();
    second.adapter.open(subscribeContext({ sessionSignal: session.signal }));
    session.abort();
    expect(second.sources[0].closed).toHaveBeenCalledTimes(1);
  });

  it('does not open a stream for an already-cancelled operation', async () => {
    const { adapter, sources } = sseHarness();
    const controller = new AbortController();
    controller.abort();
    const dispose = await adapter.open(subscribeContext({ signal: controller.signal }));
    expect(sources).toHaveLength(0);
    dispose();
  });

  it('surfaces a missing EventSource client', () => {
    const scope = globalThis as { EventSource?: unknown };
    const original = scope.EventSource;
    scope.EventSource = undefined;
    try {
      const adapter = sseStream({ endpoint: '/events', validate: () => true });
      const context = subscribeContext();
      adapter.open(context);
      expect(context.error).toHaveBeenCalledWith({ code: 'unavailable', message: expect.any(String) });
      expect(context.status).toHaveBeenCalledWith('closed');
    } finally {
      scope.EventSource = original;
    }
  });
});
