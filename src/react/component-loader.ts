import { createLocalTraceId, emitLocalTrace, type LocalObserver } from '../local/observability-core';
import { localComponentDigest } from '../sdk/manifest';
import type { LocalComponentDefinition } from '../sdk/types';
import { defineReactComponent, type LocalReactComponent } from './component-api';

export type LocalReactComponentResolver = (input: {
  readonly name: string;
  readonly definition: LocalComponentDefinition;
  readonly signal: AbortSignal;
}) => LocalReactComponent | null | PromiseLike<LocalReactComponent | null>;

export interface LocalReactTraceContext {
  readonly observer?: LocalObserver;
  readonly traceId?: string;
  readonly documentId?: string;
  readonly sourceRevision?: number;
}

const loading = Object.freeze({ status: 'loading' } as const);
const failed = Object.freeze({ status: 'failed' } as const);
type LoadState = typeof loading | typeof failed | { status: 'ready'; component: LocalReactComponent };
type Subscriber = () => void;

interface LoadEntry {
  state: LoadState;
  subscribers: Set<Subscriber>;
  abort?: AbortController;
  finishTrace?: (status: 'ok' | 'failed' | 'cancelled') => void;
  peakSubscribers?: number;
}

export class LocalComponentLoader {
  private readonly entries = new Map<string, LoadEntry>();
  private readonly identities = new WeakMap<LocalComponentDefinition, string>();

  constructor(private readonly resolver: LocalReactComponentResolver) {}

  private identity(definition: LocalComponentDefinition): string {
    let identity = this.identities.get(definition);
    if (!identity) {
      identity = `${definition.id}\0${definition.version}\0${localComponentDigest(definition)}`;
      this.identities.set(definition, identity);
    }
    return identity;
  }

  snapshot(definition: LocalComponentDefinition): LoadState {
    return this.entries.get(this.identity(definition))?.state ?? loading;
  }

  serverSnapshot(): LoadState { return loading; }

  subscribe(definition: LocalComponentDefinition, subscriber: Subscriber, trace?: LocalReactTraceContext): () => void {
    const key = this.identity(definition);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { state: loading, subscribers: new Set([subscriber]) };
      this.entries.set(key, entry);
      this.start(key, definition, entry, trace);
    } else {
      entry.subscribers.add(subscriber);
      if (entry.peakSubscribers !== undefined) entry.peakSubscribers = Math.max(entry.peakSubscribers, entry.subscribers.size);
    }
    const subscribed = entry;
    return () => {
      subscribed.subscribers.delete(subscriber);
      if (subscribed.subscribers.size || !subscribed.abort) return;
      queueMicrotask(() => {
        if (subscribed.subscribers.size || !subscribed.abort || this.entries.get(key) !== subscribed) return;
        this.entries.delete(key);
        subscribed.abort.abort();
        subscribed.abort = undefined;
        subscribed.finishTrace?.('cancelled');
        subscribed.finishTrace = undefined;
      });
    };
  }

  retry(definition: LocalComponentDefinition, trace?: LocalReactTraceContext): void {
    const key = this.identity(definition);
    const entry = this.entries.get(key);
    if (entry?.state.status !== 'failed') return;
    this.start(key, definition, entry, trace);
    for (const notify of entry.subscribers) notify();
  }

  private start(key: string, definition: LocalComponentDefinition, entry: LoadEntry, trace?: LocalReactTraceContext): void {
    const abort = new AbortController();
    entry.abort = abort;
    entry.state = loading;
    if (trace?.observer?.onTrace) {
      const { observer, documentId, sourceRevision } = trace;
      const traceId = trace.traceId ?? createLocalTraceId();
      const started = globalThis.performance?.now() ?? Date.now();
      entry.peakSubscribers = entry.subscribers.size;
      entry.finishTrace = status => emitLocalTrace(observer, { type: 'component-load-end', traceId, documentId,
        sourceRevision, timestamp: Date.now(), status, componentName: definition.name, componentVersion: definition.version,
        subscribers: entry.peakSubscribers, durationMs: Math.max(0, Math.round((globalThis.performance?.now() ?? Date.now()) - started)) });
      emitLocalTrace(observer, { type: 'component-load-start', traceId, documentId, sourceRevision,
        timestamp: Date.now(), componentName: definition.name, componentVersion: definition.version });
    }
    const finish = (state: LoadState) => {
      if (this.entries.get(key) !== entry || entry.abort !== abort) return;
      entry.abort = undefined;
      entry.state = state;
      entry.finishTrace?.(state.status === 'ready' ? 'ok' : 'failed');
      entry.finishTrace = undefined;
      entry.peakSubscribers = undefined;
      for (const notify of entry.subscribers) notify();
    };
    void Promise.resolve().then(() => {
      if (abort.signal.aborted) return null;
      return this.resolver({ name: definition.name, definition, signal: abort.signal });
    }).then(component => {
      if (!component || abort.signal.aborted) { finish(failed); return; }
      const digest = localComponentDigest(definition);
      if (component.digest !== digest || localComponentDigest(component.definition) !== digest) { finish(failed); return; }
      finish({ status: 'ready', component: defineReactComponent(definition, component) });
    }).catch(() => finish(failed));
  }
}
