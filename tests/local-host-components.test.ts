import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { MAX_LOCAL_HOST_COMPONENTS } from '../src/local/limits';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  startLocalCompileWorker,
  type LocalCompileRequest,
  type LocalCompileResponse,
  type LocalCompileWorker,
  type LocalCompileWorkerScope,
} from '../src/local/worker';
import type {
  LocalHostComponentSchema,
  LocalHostPropSchema,
  LocalNode,
} from '../src/local/types';

type HostProps = LocalHostComponentSchema['props'];

function hostSchema(name: string, props: HostProps = {}): LocalHostComponentSchema {
  return { name, form: 'leaf', props };
}

/** kind/ref are the attributes the renderer keys host data by. */
function widgetSchema(extra: Readonly<Record<string, LocalHostPropSchema>> = {}): LocalHostComponentSchema {
  return hostSchema('host-widget', {
    kind: { kind: 'string', required: true },
    ref: { kind: 'string', required: true },
    ...extra,
  });
}

function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function expectFailureCode(
  result: ReturnType<typeof compileLocal>,
  code: string,
): Extract<ReturnType<typeof compileLocal>, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected compilation to fail');
  expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
  return result;
}

function widgetCompile(attrs: string, props: Readonly<Record<string, LocalHostPropSchema>> = {}) {
  return compileLocal(`<host-widget kind="a" ref="r" ${attrs}/>`, {
    hostComponents: [widgetSchema(props)],
  });
}

function minimumBudget(
  source: string,
  hostComponents: readonly LocalHostComponentSchema[],
): number {
  for (let budget = 1; budget <= 12; budget += 1) {
    if (compileLocal(source, { hostComponents, limits: { maxSyntaxNodes: budget } }).ok) {
      return budget;
    }
  }
  throw new Error('No syntax-node budget up to 12 compiled the source');
}

describe('host component compilation', () => {
  it('keeps unknown tags on the fallback path when no host schema is supplied', () => {
    const source = '<host-widget kind="a" ref="r"/>';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nodes = flatten(result.document.nodes);
    expect(nodes.map((node) => node.type)).toEqual(['fallback']);
    expect(nodes[0].value).toBe(source);
    expect(nodes[0].attrs).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'local.component.unknown',
        severity: 'warning',
      }),
    ]);
    expect(result.document.bindings).toEqual({});
  });

  it('recognizes a declared host component as one node with raw attributes', () => {
    const source = '<host-widget kind="weather" ref="berlin" title="Now"/>';
    const result = compileLocal(source, {
      hostComponents: [
        widgetSchema({ title: { kind: 'string' } }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nodes = flatten(result.document.nodes);
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.type).toBe('hostComponent');
    expect(node.name).toBe('host-widget');
    expect(node.attrs).toEqual({ kind: 'weather', ref: 'berlin', title: 'Now' });
    expect(node.children).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'local.component.unknown')).toBe(false);
  });

  it('rejects a property kind outside string/number/boolean/enum', () => {
    const result = compileLocal('x', {
      hostComponents: [
        hostSchema('host-widget', {
          when: { kind: 'date' as never },
        }),
      ],
    });
    const failure = expectFailureCode(result, 'local.options.invalid');
    expect(failure.diagnostics[0].message).toContain('date');
  });

  it('rejects a host name that collides with an author component', () => {
    const result = compileLocal('x', { hostComponents: [hostSchema('slider')] });
    expectFailureCode(result, 'local.options.invalid');
  });

  it('rejects duplicate host names', () => {
    const result = compileLocal('x', {
      hostComponents: [hostSchema('host-widget'), hostSchema('host-widget')],
    });
    expectFailureCode(result, 'local.options.invalid');
  });

  it('rejects more than the maximum number of host components', () => {
    const schemas = Array.from(
      { length: MAX_LOCAL_HOST_COMPONENTS + 1 },
      (_, index) => hostSchema(`host-${index}`),
    );
    const result = compileLocal('x', { hostComponents: schemas });
    expectFailureCode(result, 'local.options.invalid');
  });

  it.each(['Host_Widget', 'host_widget', 'Host', '-host', 'host-'])(
    'rejects a host name that is not lowercase kebab-case: %s',
    (name) => {
      const result = compileLocal('x', { hostComponents: [hostSchema(name)] });
      expectFailureCode(result, 'local.options.invalid');
    },
  );

  it('rejects a document attribute outside a declared enum', () => {
    const result = widgetCompile('mode="c"', {
      mode: { kind: 'enum', enum: ['a', 'b'] },
    });
    expectFailureCode(result, 'local.host.attribute');
  });

  it('rejects a missing required attribute', () => {
    const result = widgetCompile('', {
      label: { kind: 'string', required: true },
    });
    expectFailureCode(result, 'local.host.attribute');
  });

  it('rejects an interpolation in a static string attribute', () => {
    const result = widgetCompile('label="{{ 1 + 1 }}"', {
      label: { kind: 'string', static: true },
    });
    expectFailureCode(result, 'local.host.attribute');
  });

  it('rejects a string attribute that does not match its pattern', () => {
    const result = widgetCompile('code="ABC"', {
      code: { kind: 'string', pattern: '^[a-z]+$' },
    });
    expectFailureCode(result, 'local.host.attribute');
  });

  it('rejects a non-numeric value for a number attribute', () => {
    const result = widgetCompile('count="abc"', {
      count: { kind: 'number' },
    });
    expectFailureCode(result, 'local.host.attribute');
  });

  it('rejects a non-boolean value for a boolean attribute', () => {
    const result = widgetCompile('active="yes"', {
      active: { kind: 'boolean' },
    });
    expectFailureCode(result, 'local.host.attribute');
  });

  it('accepts interpolation in an attribute without the static flag', () => {
    const result = widgetCompile('nodata="{{ 1 + 1 }}"', {
      nodata: { kind: 'string' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.some((item) => item.code === 'local.host.attribute')).toBe(false);
    const node = flatten(result.document.nodes).find((item) => item.type === 'hostComponent');
    expect(node?.attrs?.nodata).toBe('{{ 1 + 1 }}');
  });

  it('charges exactly one syntax node for the host component', () => {
    const schemas = [widgetSchema()];
    const plainSource = 'text';
    const hostSource = 'text\n\n<host-widget kind="a" ref="r"/>';

    const plainBudget = minimumBudget(plainSource, schemas);
    const hostBudget = minimumBudget(hostSource, schemas);
    expect(hostBudget).toBe(plainBudget + 1);

    const below = compileLocal(hostSource, {
      hostComponents: schemas,
      limits: { maxSyntaxNodes: hostBudget - 1 },
    });
    expect(below.ok).toBe(false);
    if (below.ok) return;
    expect(below.diagnostics.some((item) => item.code === 'local.budget')).toBe(true);

    const result = compileLocal(hostSource, {
      hostComponents: schemas,
      limits: { maxSyntaxNodes: hostBudget },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(flatten(result.document.nodes).filter((node) => node.type === 'hostComponent')).toHaveLength(1);
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

describe('host components in the compile worker', () => {
  it('carries a structured-clone-safe schema request', () => {
    const request: LocalCompileRequest = {
      id: 1,
      source: '<host-widget kind="a" ref="r"/>',
      options: { hostComponents: [widgetSchema()] },
    };
    const cloned = structuredClone(request);
    expect(cloned.options?.hostComponents).toEqual(request.options?.hostComponents);
  });

  it('compiles a request carrying hostComponents and returns a hostComponent node', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);

    scope.onmessage!(requestEvent({
      id: 3,
      source: '<host-widget kind="a" ref="r"/>',
      options: { hostComponents: [widgetSchema()] },
    }));

    expect(scope.messages).toHaveLength(1);
    const response = scope.messages[0];
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.ok).toBe(true);
    if (!response.result.ok) return;
    expect(flatten(response.result.document.nodes).map((node) => node.type)).toEqual(['hostComponent']);
  });
});

class FakeWorker implements LocalCompileWorker {
  onmessage: ((event: MessageEvent<LocalCompileResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  readonly messages: LocalCompileRequest[] = [];
  terminated = false;

  postMessage(message: LocalCompileRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('host components in the compile scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts options.hostComponents in the compile request', () => {
    const worker = new FakeWorker();
    const scheduler = new LocalCompileScheduler({
      createWorker: () => worker,
      onResult: () => {},
    });
    try {
      const hostComponents = [widgetSchema()];
      scheduler.schedule('<host-widget kind="a" ref="r"/>', { hostComponents });
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);

      expect(worker.messages).toHaveLength(1);
      expect(worker.messages[0].options?.hostComponents).toEqual(hostComponents);
    } finally {
      scheduler.dispose();
    }
  });
});
