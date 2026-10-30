import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  startLocalCompileWorker,
  type LocalCompileRequest,
  type LocalCompileResponse,
  type LocalCompileWorker,
  type LocalCompileWorkerScope,
} from '../src/local/worker';
import { localCompileOptionsKey } from '../src/local/options';
import { createLocalRuntime } from '../src/local/runtime';
import type { LocalCompileOptions, LocalNode } from '../src/local/types';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent, localComponentDigest } from '../src/sdk/manifest';
import type { LocalConfig } from '../src/sdk/types';

const PROTOCOL = 'reactive-md-component/v1' as const;

function ratingDefinition(version = '1.0.0') {
  return defineLocalComponent({
    id: 'example/rating',
    name: 'rating',
    version,
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      label: { kind: 'string', required: true },
      max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
    },
    bindings: {
      value: {
        kind: 'number',
        family: 'number',
        bind: 'bind',
        initial: 'initial',
        initialRule: 'nearest-zero',
        constraints: { min: { literal: 0 }, max: { prop: 'max' }, step: { literal: 1 } },
      },
    },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function hintDefinition() {
  return defineLocalComponent({
    id: 'example/hint',
    name: 'hint',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'container',
    props: { title: { kind: 'string' } },
    children: { kind: 'markdown', required: true },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function stepperDefinition() {
  return defineLocalComponent({
    id: 'example/stepper',
    name: 'stepper',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      label: { kind: 'string', required: true },
      max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
      step: { kind: 'number', dynamic: true, default: 1, min: 1, max: 10, integer: true },
    },
    bindings: {
      value: {
        kind: 'number',
        family: 'number',
        bind: 'bind',
        initial: 'initial',
        initialRule: 'nearest-zero',
        constraints: { min: { literal: 0 }, max: { prop: 'max' }, step: { prop: 'step' } },
      },
    },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function configFor(...definitions: ReturnType<typeof ratingDefinition>[]): LocalConfig {
  return createLocalConfig({ components: definitions });
}

function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe('SDK compile integration', () => {
  it('compiles a configured component and records the used requirement', () => {
    const definition = ratingDefinition();
    const config = configFor(definition);
    const result = compileLocal('<rating bind="score" label="Rate" initial="3">', { config });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = flatten(result.document.nodes).find((item) => item.type === 'hostComponent');
    expect(node?.name).toBe('rating');
    expect(node?.hostForm).toBe('leaf');
    expect(result.document.bindings.score).toMatchObject({ type: 'number', initial: 3, min: 0, max: 5, step: 1 });
    expect(result.document.extensions).toEqual({
      protocol: 'reactive-md-extensions/v1',
      components: [{
        id: 'example/rating',
        name: 'rating',
        version: '1.0.0',
        digest: localComponentDigest(definition),
      }],
    });
  });

  it('does not list configured components the document never uses', () => {
    const result = compileLocal('plain text', { config: configFor(ratingDefinition()) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.extensions).toBeUndefined();
  });

  it('never attaches requirements for legacy host components', () => {
    const result = compileLocal('<host-widget kind="a"/>', {
      hostComponents: [{ name: 'host-widget', form: 'leaf', props: { kind: { kind: 'string' } } }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.extensions).toBeUndefined();
  });

  it('rejects config combined with hostComponents', () => {
    const result = compileLocal('x', {
      config: configFor(ratingDefinition()),
      hostComponents: [{ name: 'host-widget', form: 'leaf', props: {} }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe('local.options.invalid');
    expect(result.diagnostics[0].message).toMatch(/cannot be combined/);
  });

  it('rejects a tampered config with a descriptive option diagnostic', () => {
    const config = { ...configFor(ratingDefinition()), protocol: 'reactive-md-config/v2' } as unknown as LocalConfig;
    const result = compileLocal('x', { config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe('local.options.invalid');
    expect(result.diagnostics[0].message).toMatch(/config/);
  });

  it('enforces typed number widths for literal attributes', () => {
    const config = configFor(ratingDefinition());
    const tooLarge = compileLocal('<rating bind="score" label="Rate" max="11">', { config });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect(tooLarge.diagnostics.some((item) => item.code === 'local.host.attribute')).toBe(true);
    }
    const fractional = compileLocal('<rating bind="score" label="Rate" max="2.5">', { config });
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) {
      expect(fractional.diagnostics.some((item) => item.code === 'local.host.attribute')).toBe(true);
    }
  });

  it('enforces required body content for SDK containers', () => {
    const config = configFor(ratingDefinition(), hintDefinition());
    const empty = compileLocal('<hint title="Tips"></hint>', { config });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.diagnostics.some((item) => item.code === 'local.host.structure')).toBe(true);
    }
    const filled = compileLocal('<hint title="Tips">**Body**</hint>', { config });
    expect(filled.ok).toBe(true);
    if (filled.ok) {
      expect(filled.document.extensions?.components.map((item) => item.name)).toEqual(['hint']);
    }
  });

  it('shares a scalar binding with a built-in control using prop-referenced bounds', () => {
    const config = configFor(ratingDefinition());
    const shared = compileLocal(
      '<number bind="score" label="Score" min="0" max="5" initial="3">\n\n<rating bind="score" label="Rate" max="5">',
      { config },
    );
    expect(shared.ok).toBe(true);
    if (shared.ok) {
      expect(shared.document.bindings.score).toMatchObject({ min: 0, max: 5, step: 1, initial: 3 });
    }
    const mismatch = compileLocal(
      '<number bind="score" label="Score" min="0" max="5" initial="3">\n\n<rating bind="score" label="Rate" max="4">',
      { config },
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.diagnostics.some((item) => item.code === 'local.binding.constraint')).toBe(true);
    }
  });

  it('registers dynamic prop bounds so runtime writes follow the current expression', () => {
    const config = configFor(ratingDefinition());
    const result = compileLocal(
      '<number bind="limit" label="Limit" min="1" max="10" initial="5">\n\n<rating bind="score" label="Rate" max="{{ limit }}">',
      { config },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rating = flatten(result.document.nodes).find((node) => node.name === 'rating');
    expect(rating).toBeDefined();
    expect(result.document.dynamicConstraints?.[rating!.id]?.max?.source).toBe('limit');

    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.setParameter('score', 5)).toEqual([]);
      expect(runtime.setParameter('score', 6).length).toBeGreaterThan(0);
      expect(runtime.setParameter('score', 5)).toEqual([]);
      expect(runtime.setParameter('limit', 8)).toEqual([]);
      expect(runtime.setParameter('score', 8)).toEqual([]);
      expect(runtime.setParameter('score', 9).length).toBeGreaterThan(0);
      expect(runtime.getParameter('score')).toBe(8);
    } finally {
      runtime.dispose();
    }
  });

  it('shares identical dynamic bounds with a built-in and rejects divergent ones', () => {
    const config = configFor(ratingDefinition());
    const identical = compileLocal(
      '<number bind="limit" label="Limit" min="1" max="10" initial="5">\n\n<number bind="score" label="Score" min="0" max="{{ limit }}" initial="5">\n\n<rating bind="score" label="Rate" max="{{ limit }}">',
      { config },
    );
    expect(identical.ok).toBe(true);
    if (identical.ok) {
      const runtime = createLocalRuntime(identical.document);
      try {
        expect(runtime.setParameter('score', 5)).toEqual([]);
        expect(runtime.setParameter('score', 6).length).toBeGreaterThan(0);
      } finally {
        runtime.dispose();
      }
    }
    const divergent = compileLocal(
      '<number bind="limit" label="Limit" min="1" max="10" initial="5">\n\n<number bind="score" label="Score" min="0" max="{{ limit }}" initial="5">\n\n<rating bind="score" label="Rate" max="{{ limit + 1 }}">',
      { config },
    );
    expect(divergent.ok).toBe(false);
    if (!divergent.ok) {
      expect(divergent.diagnostics.some((item) => item.code === 'local.binding.constraint')).toBe(true);
    }
  });

  it('accepts a static step prop and rejects a dynamic one', () => {
    const config = createLocalConfig({ components: [stepperDefinition()] });
    const staticStep = compileLocal('<stepper bind="score" label="Step" step="2">', { config });
    expect(staticStep.ok).toBe(true);
    if (staticStep.ok) {
      expect(staticStep.document.bindings.score.step).toBe(2);
    }
    const dynamicStep = compileLocal('<stepper bind="score" label="Step" step="{{ 2 }}">', { config });
    expect(dynamicStep.ok).toBe(false);
    if (!dynamicStep.ok) {
      expect(dynamicStep.diagnostics.some((item) => item.code === 'local.host.attribute')).toBe(true);
    }
  });

  it('keys compile options by the semantic config digest', () => {
    const first: LocalCompileOptions = { config: configFor(ratingDefinition()) };
    const second: LocalCompileOptions = { config: configFor(ratingDefinition('1.0.1')) };
    expect(localCompileOptionsKey(first)).not.toBe(localCompileOptionsKey(second));
    expect(localCompileOptionsKey(first)).toContain((first.config as LocalConfig).key);
  });
});

interface FakeScope extends LocalCompileWorkerScope {
  messages: LocalCompileResponse[];
}

function createScope(): FakeScope {
  const scope: FakeScope = {
    onmessage: null,
    messages: [],
    postMessage(message: LocalCompileResponse): void {
      scope.messages.push(message);
    },
  };
  return scope;
}

function requestEvent(data: unknown): MessageEvent<LocalCompileRequest> {
  return { data } as unknown as MessageEvent<LocalCompileRequest>;
}

describe('SDK compile worker', () => {
  it('compiles a config request and returns extension requirements', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    const config = configFor(ratingDefinition());
    scope.onmessage!(requestEvent({
      id: 1,
      source: '<rating bind="score" label="Rate">',
      options: { config },
    }));
    expect(scope.messages).toHaveLength(1);
    const response = scope.messages[0];
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.ok).toBe(true);
    if (!response.result.ok) return;
    expect(response.result.document.extensions?.components[0].id).toBe('example/rating');
  });
});

class FakeWorker implements LocalCompileWorker {
  onmessage: ((event: MessageEvent<LocalCompileResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  readonly messages: LocalCompileRequest[] = [];
  terminate(): void {}
  postMessage(message: LocalCompileRequest): void {
    this.messages.push(message);
  }
}

describe('SDK compile scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts a structured-clone-safe config snapshot with the same key', () => {
    const worker = new FakeWorker();
    const scheduler = new LocalCompileScheduler({ createWorker: () => worker, onResult: () => {} });
    const config = configFor(ratingDefinition());
    try {
      scheduler.schedule('<rating bind="score" label="Rate">', { config });
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(worker.messages).toHaveLength(1);
      const sent = worker.messages[0].options?.config;
      expect(sent?.key).toBe(config.key);
      expect(structuredClone(sent)).toEqual(sent);
    } finally {
      scheduler.dispose();
    }
  });

  it('invalidates an in-flight result when only the config changes', () => {
    const worker = new FakeWorker();
    const first = configFor(ratingDefinition());
    const second = configFor(ratingDefinition('1.0.1'));
    const scheduler = new LocalCompileScheduler({
      createWorker: () => worker,
      onResult: () => {},
    });
    try {
      scheduler.schedule('plain', { config: first });
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(worker.messages).toHaveLength(1);
      scheduler.schedule('plain', { config: second });
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(worker.messages).toHaveLength(1);
    } finally {
      scheduler.dispose();
    }
  });
});
