import { describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime, updateLocalRuntime } from '../src/local/runtime/runtime';
import { createDetachedRuntimeServices } from '../src/runtime-services/runtime';
import type {
  NetworkConfig,
  StreamEvent,
  SubmitResult,
  SubscribeAdapterContext,
} from '../src/runtime-services/network';

const flush = async (): Promise<void> => { await Promise.resolve(); };

function createDocument(source = '# Survey') {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
  return result.document;
}

describe('named runtime channels', () => {
  it('starts no I/O until an authorized operation passes validation', async () => {
    const send = vi.fn(() => ({ ok: true } as const));
    const open = vi.fn(() => () => {});
    const document = createDocument();
    const detached = createLocalRuntime(document);
    const configured = createLocalRuntime(document, {
      network: { channels: {
        answers: { submit: { validate: value => Object.keys(value).length === 1 && typeof value.answer === 'string', send } },
        results: { subscribe: { validate: () => true, open } },
      } },
    });
    try {
      const network = configured.network!;
      expect(network.supports('answers', 'submit')).toBe(true);
      expect(network.supports('Answers', 'submit')).toBe(false);
      expect(network.supports('results', 'submit')).toBe(false);
      expect(detached.network!.supports('answers', 'submit')).toBe(false);
      const listener = vi.fn();
      network.subscribe('answers', listener);
      expect(listener).not.toHaveBeenCalled();
      await flush();
      expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'error', error: expect.objectContaining({ code: 'unavailable' }) });
      await expect(network.submit('answers', { answer: 'yes', extra: false })).resolves.toMatchObject({ ok: false, error: { code: 'invalid-data' } });
      await expect(network.submit('results', {})).resolves.toMatchObject({ ok: false, error: { code: 'unavailable' } });
      expect(send).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      await expect(network.submit('answers', { answer: '' }, { idempotencyKey: 'retry-key' })).resolves.toEqual({ ok: true });
      expect(send).toHaveBeenCalledExactlyOnceWith({ answer: '' }, expect.objectContaining({
        requestId: expect.any(String),
        idempotencyKey: 'retry-key',
      }));
    } finally {
      detached.dispose();
      configured.dispose();
    }
  });

  it('shares ordered, validated messages within one runtime and isolates listeners and runtimes', async () => {
    const contexts: SubscribeAdapterContext[] = [];
    const report = vi.fn();
    const release = vi.fn();
    const configuration: NetworkConfig = {
      onListenerError: report,
      channels: { results: { subscribe: {
        maxBytes: 16,
        validate: value => typeof value === 'number' && value >= 0,
        open(context) {
          contexts.push(context);
          context.status('open');
          return release;
        },
      } } },
    };
    const document = createDocument();
    const services = createDetachedRuntimeServices();
    const first = createLocalRuntime(document, { documentId: 'survey', network: configuration, services });
    const second = createLocalRuntime(document, { documentId: 'survey', network: configuration, services });
    try {
      const a: StreamEvent[] = [], b: StreamEvent[] = [], c: StreamEvent[] = [];
      const offA = first.network!.subscribe('results', event => {
        a.push(event);
        if (event.type === 'data') throw new Error('listener failed');
      });
      const offB = first.network!.subscribe('results', event => b.push(event));
      second.network!.subscribe('results', event => c.push(event));
      await flush();
      expect(contexts).toHaveLength(2);
      expect(contexts[0].sessionSignal).not.toBe(contexts[1].sessionSignal);
      contexts[0].data(-1);
      contexts[0].data(1e-123);
      contexts[0].data(123456789012345600);
      contexts[0].data(2);
      offA();
      offA();
      contexts[0].data(3);
      expect(a.filter(event => event.type === 'data')).toEqual([{ type: 'data', value: 1e-123 }, { type: 'data', value: 2 }]);
      expect(b.filter(event => event.type === 'error')).toHaveLength(2);
      expect(b.at(-1)).toEqual({ type: 'data', value: 3 });
      expect(c.every(event => event.type === 'status')).toBe(true);
      expect(report).toHaveBeenCalledTimes(2);
      expect(release).not.toHaveBeenCalled();
      offB();
      expect(release).toHaveBeenCalledTimes(1);
      contexts[0].data(4);
      first.dispose();
      expect(contexts[1].sessionSignal.aborted).toBe(false);
      expect(b.at(-1)).toEqual({ type: 'data', value: 3 });
    } finally {
      first.dispose();
      second.dispose();
      services.scheduler.dispose();
    }
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('aborts pending work and releases a connection that arrives after unsubscribe', async () => {
    let adapterContext: SubscribeAdapterContext | undefined;
    let completeOpen: ((release: () => void) => void) | undefined;
    let confirm: ((result: SubmitResult) => void) | undefined;
    let submitSignal: AbortSignal | undefined;
    const runtime = createLocalRuntime(createDocument(), { network: { channels: {
      survey: {
        submit: { validate: () => true, send(_payload, { signal }) {
          submitSignal = signal;
          return new Promise(resolve => { confirm = resolve; });
        } },
        subscribe: { validate: () => true, open(context) {
          adapterContext = context;
          return new Promise(resolve => { completeOpen = resolve; });
        } },
      },
    } } });
    const listener = vi.fn();
    const off = runtime.network!.subscribe('survey', listener);
    const sending = runtime.network!.submit('survey', {});
    await flush();
    off();
    runtime.dispose();
    const release = vi.fn();
    completeOpen!(release);
    adapterContext!.data(1);
    confirm!({ ok: true });
    await flush();
    expect(adapterContext!.signal.aborted).toBe(true);
    expect(submitSignal!.aborted).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'status', state: 'connecting' });
    expect(release).toHaveBeenCalledOnce();
    await expect(sending).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });

  it('keeps subscriptions on source adoption and delivers reentrant status changes in order', async () => {
    let stream!: SubscribeAdapterContext;
    const release = vi.fn();
    const open = vi.fn((context: SubscribeAdapterContext) => {
      stream = context;
      context.status('open');
      return release;
    });
    const runtime = createLocalRuntime(createDocument(), {
      network: { channels: { results: { subscribe: { validate: () => true, open } } } },
    });
    const network = runtime.network!;
    try {
      network.subscribe('results', event => {
        if (event.type === 'data') stream.status('closed');
      });
      await flush();
      expect(updateLocalRuntime(runtime, createDocument('# Edited survey'))).toMatchObject({ ok: true, changed: true });
      expect(runtime.network).toBe(network);

      const listener = vi.fn();
      network.subscribe('results', listener);
      stream.data(1);
      await flush();
      expect(listener.mock.calls.map(([event]) => event)).toEqual([
        { type: 'status', state: 'open' },
        { type: 'data', value: 1 },
        { type: 'status', state: 'closed' },
      ]);
      expect(open).toHaveBeenCalledOnce();
    } finally {
      runtime.dispose();
    }
    expect(release).toHaveBeenCalledOnce();
  });

  it('projects only named writable fields and stops on required or invalid drafts', () => {
    const document = createDocument([
      '<external name="rate" type="number">',
      '<computed name="total" value="{{ quantity * rate }}">',
      '<input bind="answer" label="Answer" required>',
      '<textarea bind="comment" label="Comment">',
      '<number bind="quantity" label="Quantity" initial="2">',
      '<toggle bind="anonymousVote" label="Anonymous vote">',
      '<input label="Internal">',
    ].join('\n'));
    const runtime = createLocalRuntime(document, { externalValues: { rate: 3 } });
    try {
      const read = (fields: string[]) => runtime.readSubmissionFields!(fields);
      expect(read(['answer'])).toEqual({ ok: false, field: 'answer', reason: 'required' });
      expect(runtime.setParameter('answer', 'yes')).toEqual([]);
      const internal = Object.keys(document.bindings).find(name => name.startsWith('@'))!;
      for (const name of ['rate', 'total', 'missing', internal]) {
        expect(read([name])).toEqual({ ok: false, field: name, reason: 'unavailable' });
      }
      expect(read(['comment', 'comment'])).toEqual({ ok: false, field: 'comment', reason: 'unavailable' });
      const expected = { ok: true, payload: { answer: 'yes', comment: '', quantity: 2, anonymousVote: false } };
      const selected = ['answer', 'comment', 'quantity', 'anonymousVote'];
      expect(read(selected)).toEqual(expected);
      const node = document.nodes.find(node => node.attrs?.bind === 'answer')!;
      const unregister = runtime.registerSubmissionField!(node, () => 'invalid');
      expect(read(selected)).toEqual({ ok: false, field: 'answer', reason: 'invalid' });
      unregister();
      expect(read(selected)).toEqual(expected);
    } finally {
      runtime.dispose();
    }
  });
});
