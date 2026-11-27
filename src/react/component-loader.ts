import { createLocalTraceId, emitLocalTrace, type LocalObserver } from '../local/observability-core';
import { localComponentDigest } from '../sdk/manifest';
import type { LocalComponentDefinition } from '../sdk/types';
import type { LocalSourcePhase } from '../local/types';
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
  readonly sourcePhase?: LocalSourcePhase;
}

const loading = Object.freeze({ status: 'loading' } as const);
const failed = Object.freeze({ status: 'failed' } as const);
type LoadState<Component> = typeof loading | typeof failed | { status: 'ready'; component: Component };
type Subscriber = () => void;

interface LoadEntry<Component> {
  state: LoadState<Component>;
  subscribers: Set<Subscriber>;
  abort?: AbortController;
  finishTrace?: (status: 'ok' | 'failed' | 'cancelled') => void;
  peakSubscribers?: number;
}

export class SharedComponentLoader<Definition extends { name: string; version?: string }, Component> {
  private readonly entries = new Map<string, LoadEntry<Component>>();
  private readonly identities = new WeakMap<Definition, string>();

  constructor(
    private readonly resolver: (input: { name: string; definition: Definition; signal: AbortSignal }) => Component | null | PromiseLike<Component | null>,
    private readonly identityFor: (definition: Definition) => string,
    private readonly validate: (definition: Definition, component: Component) => Component | null,
  ) {}

  private identity(definition: Definition): string {
    let identity = this.identities.get(definition);
    if (!identity) {
      identity = this.identityFor(definition);
      this.identities.set(definition, identity);
    }
    return identity;
  }

  snapshot(definition: Definition): LoadState<Component> {
    return this.entries.get(this.identity(definition))?.state ?? loading;
  }

  serverSnapshot(): LoadState<Component> { return loading; }

  subscribe(definition: Definition, subscriber: Subscriber, trace?: LocalReactTraceContext): () => void {
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
      if (subscribed.subscribers.size || subscribed.state.status === 'ready') return;
      queueMicrotask(() => {
        if (subscribed.subscribers.size || subscribed.state.status === 'ready' || this.entries.get(key) !== subscribed) return;
        this.entries.delete(key);
        subscribed.abort?.abort();
        subscribed.abort = undefined;
        subscribed.finishTrace?.('cancelled');
        subscribed.finishTrace = undefined;
      });
    };
  }

  retry(definition: Definition, trace?: LocalReactTraceContext): void {
    const key = this.identity(definition);
    const entry = this.entries.get(key);
    if (entry?.state.status !== 'failed') return;
    this.start(key, definition, entry, trace);
    for (const notify of entry.subscribers) notify();
  }

  private start(key: string, definition: Definition, entry: LoadEntry<Component>, trace?: LocalReactTraceContext): void {
    const abort = new AbortController();
    entry.abort = abort;
    entry.state = loading;
    if (trace?.observer?.onTrace) {
      const { observer, documentId, sourceRevision, sourcePhase } = trace;
      const traceId = trace.traceId ?? createLocalTraceId();
      const started = globalThis.performance?.now() ?? Date.now();
      entry.peakSubscribers = entry.subscribers.size;
      entry.finishTrace = status => emitLocalTrace(observer, { type: 'component-load-end', traceId, documentId,
        sourceRevision, sourcePhase, timestamp: Date.now(), status, componentName: definition.name, componentVersion: definition.version,
        subscribers: entry.peakSubscribers, durationMs: Math.max(0, Math.round((globalThis.performance?.now() ?? Date.now()) - started)) });
      emitLocalTrace(observer, { type: 'component-load-start', traceId, documentId, sourceRevision, sourcePhase,
        timestamp: Date.now(), componentName: definition.name, componentVersion: definition.version });
    }
    const finish = (state: LoadState<Component>) => {
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
      const validated = this.validate(definition, component);
      finish(validated === null ? failed : { status: 'ready', component: validated });
    }).catch(() => finish(failed));
  }
}

export class LocalComponentLoader extends SharedComponentLoader<LocalComponentDefinition, LocalReactComponent> {
  constructor(resolver: LocalReactComponentResolver) {
    super(resolver, definition => `${definition.id}\0${definition.version}\0${localComponentDigest(definition)}`, (definition, component) => {
      const digest = localComponentDigest(definition);
      return component.digest === digest && localComponentDigest(component.definition) === digest
        ? defineReactComponent(definition, component) : null;
    });
  }
}
