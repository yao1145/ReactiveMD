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

export type LocalReactSynchronousComponentResolver = (input: {
  readonly name: string;
  readonly definition: LocalComponentDefinition;
}) => LocalReactComponent | null;

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
type LoadOutcome = 'ok' | 'failed' | 'cancelled';

interface LoadWait {
  subscribers: Set<Subscriber>;
  finish: (status: LoadOutcome) => void;
}

interface LoadObservation {
  id: string;
  waits: Map<LocalObserver, Map<string, LoadWait>>;
  finishRequest?: (status: LoadOutcome) => void;
  peakSubscribers: number;
}

interface LoadEntry<Component> {
  state: LoadState<Component>;
  subscribers: Map<Subscriber, LocalReactTraceContext | undefined>;
  abort?: AbortController;
  observation?: LoadObservation;
}

const loadClock = () => globalThis.performance?.now() ?? Date.now();
const elapsed = (started: number) => Math.max(0, Math.round(loadClock() - started));

function waitKey(trace: LocalReactTraceContext, loadId: string): string {
  return JSON.stringify([trace.traceId ?? loadId, trace.documentId, trace.sourceRevision, trace.sourcePhase]);
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
    const observed = trace?.observer?.onTrace ? trace : undefined;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { state: loading, subscribers: new Map([[subscriber, observed]]) };
      this.entries.set(key, entry);
      this.start(key, definition, entry);
    } else {
      entry.subscribers.set(subscriber, observed);
      if (entry.abort && observed) this.observeWait(definition, entry, subscriber, observed);
      if (entry.observation) entry.observation.peakSubscribers = Math.max(entry.observation.peakSubscribers, entry.subscribers.size);
    }
    const subscribed = entry;
    return () => {
      const observation = subscribed.observation;
      const observer = observed?.observer;
      if (observation && observer) {
        const waits = observation.waits.get(observer);
        const scope = waitKey(observed, observation.id);
        const wait = waits?.get(scope);
        if (waits && wait?.subscribers.delete(subscriber) && !wait.subscribers.size) queueMicrotask(() => {
          if (subscribed.observation !== observation || wait.subscribers.size || waits.get(scope) !== wait) return;
          waits.delete(scope);
          if (!waits.size) observation.waits.delete(observer);
          wait.finish('cancelled');
        });
      }
      subscribed.subscribers.delete(subscriber);
      if (subscribed.subscribers.size || subscribed.state.status === 'ready') return;
      queueMicrotask(() => {
        if (subscribed.subscribers.size || subscribed.state.status === 'ready' || this.entries.get(key) !== subscribed) return;
        this.entries.delete(key);
        subscribed.abort?.abort();
        subscribed.abort = undefined;
        this.finishObservation(subscribed, 'cancelled');
      });
    };
  }

  retry(definition: Definition, trace?: LocalReactTraceContext): void {
    const key = this.identity(definition);
    const entry = this.entries.get(key);
    if (entry?.state.status !== 'failed') return;
    this.start(key, definition, entry, trace);
    for (const notify of entry.subscribers.keys()) notify();
  }

  private observeWait(definition: Definition, entry: LoadEntry<Component>, subscriber: Subscriber, trace: LocalReactTraceContext): void {
    const observer = trace.observer!;
    const observation = entry.observation ??= { id: createLocalTraceId(), peakSubscribers: entry.subscribers.size, waits: new Map() };
    let waits = observation.waits.get(observer);
    if (!waits) { waits = new Map(); observation.waits.set(observer, waits); }
    const scope = waitKey(trace, observation.id);
    let wait = waits.get(scope);
    if (!wait) {
      const { traceId = observation.id, documentId, sourceRevision, sourcePhase } = trace;
      const started = loadClock();
      wait = { subscribers: new Set(), finish: (status: LoadOutcome) => emitLocalTrace(observer, { type: 'component-load-wait-end',
        traceId, documentId, sourceRevision, sourcePhase, loadId: observation.id, timestamp: Date.now(), status,
        componentName: definition.name, componentVersion: definition.version, durationMs: elapsed(started) }) };
      waits.set(scope, wait);
    }
    wait.subscribers.add(subscriber);
  }

  private finishObservation(entry: LoadEntry<Component>, status: LoadOutcome): void {
    const observation = entry.observation;
    entry.observation = undefined;
    observation?.finishRequest?.(status);
    if (!observation) return;
    for (const waits of observation.waits.values()) {
      for (const wait of waits.values()) wait.finish(wait.subscribers.size ? status : 'cancelled');
    }
  }

  private start(key: string, definition: Definition, entry: LoadEntry<Component>, trace?: LocalReactTraceContext): void {
    const abort = new AbortController();
    entry.abort = abort;
    entry.state = loading;
    for (const [subscriber, context] of entry.subscribers) {
      if (context) this.observeWait(definition, entry, subscriber, context);
    }
    const finish = (state: LoadState<Component>) => {
      if (this.entries.get(key) !== entry || entry.abort !== abort) return;
      entry.abort = undefined;
      entry.state = state;
      this.finishObservation(entry, state.status === 'ready' ? 'ok' : 'failed');
      for (const notify of entry.subscribers.keys()) notify();
    };
    void Promise.resolve().then(() => {
      if (abort.signal.aborted || !entry.subscribers.size) return null;
      const observation = entry.observation;
      if (observation) {
        let context = trace?.observer?.onTrace ? trace : undefined;
        if (!context) for (const value of entry.subscribers.values()) {
          if (value?.observer?.onTrace) { context = value; break; }
        }
        if (context?.observer) {
          const { observer, traceId = observation.id, documentId, sourceRevision, sourcePhase } = context;
          const identity = { traceId, documentId, sourceRevision, sourcePhase, loadId: observation.id,
            componentName: definition.name, componentVersion: definition.version };
          const started = loadClock();
          observation.finishRequest = status => emitLocalTrace(observer, { ...identity, type: 'component-load-end',
            timestamp: Date.now(), status, subscribers: observation.peakSubscribers, durationMs: elapsed(started) });
          emitLocalTrace(observer, { ...identity, type: 'component-load-start', timestamp: Date.now() });
        }
      }
      return this.resolver({ name: definition.name, definition, signal: abort.signal });
    }).then(component => {
      if (!component || abort.signal.aborted) { finish(failed); return; }
      const validated = this.validate(definition, component);
      finish(validated === null ? failed : { status: 'ready', component: validated });
    }).catch(() => finish(failed));
  }
}

export class LocalComponentLoader extends SharedComponentLoader<LocalComponentDefinition, LocalReactComponent> {
  private readonly synchronous = new WeakMap<LocalComponentDefinition, LocalReactComponent | null>();

  constructor(resolver: LocalReactComponentResolver, private readonly resolveSync?: LocalReactSynchronousComponentResolver) {
    super(resolver, definition => `${definition.id}\0${definition.version}\0${localComponentDigest(definition)}`, validatedImplementation);
  }

  synchronousImplementation(definition: LocalComponentDefinition): LocalReactComponent | null {
    if (!this.resolveSync) return null;
    const cached = this.synchronous.get(definition);
    if (cached !== undefined) return cached;
    let resolved = null;
    try {
      const component = this.resolveSync({ name: definition.name, definition });
      if (component) resolved = validatedImplementation(definition, component);
    } catch { /* The async loader can still supply the implementation. */ }
    this.synchronous.set(definition, resolved);
    return resolved;
  }
}

function validatedImplementation(definition: LocalComponentDefinition, component: LocalReactComponent): LocalReactComponent | null {
  const digest = localComponentDigest(definition);
  return component.digest === digest && localComponentDigest(component.definition) === digest
    ? defineReactComponent(definition, component) : null;
}
