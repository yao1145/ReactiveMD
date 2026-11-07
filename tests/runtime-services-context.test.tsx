import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { LocalDocumentView } from '../src/local/rendering/LocalDocumentView';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import {
  createReactConfig,
  defineReactComponent,
  type LocalComponentContext,
} from '../src/react/sdk';

const PROTOCOL = 'reactive-md-component/v1';

function probeDefinition() {
  return defineLocalComponent({
    id: 'example/probe',
    name: 'probe',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      'state-key': { kind: 'string' },
      seed: { kind: 'number', dynamic: true },
    },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

let captured: LocalComponentContext | null = null;

const Probe = defineReactComponent(probeDefinition(), {
  render: (context: LocalComponentContext) => {
    captured = context;
    return (
      <span
        data-seed={String(context.services.random.seed)}
        data-state-key={context.services.state.key}
      >
        probe
      </span>
    );
  },
});

function mount(
  source: string,
  options?: { documentId?: string; randomSeed?: number; componentState?: unknown },
): { html: string; runtime: ReturnType<typeof createLocalRuntime>; context: LocalComponentContext } {
  const config = createLocalConfig({ components: [probeDefinition()] });
  const reactConfig = createReactConfig(config, { components: [Probe] });
  const result = compileLocal(source, { config });
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  const runtime = createLocalRuntime(result.document, options);
  captured = null;
  try {
    const html = renderToStaticMarkup(
      <LocalDocumentView document={result.document} runtime={runtime} reactConfig={reactConfig} mode="static" />,
    );
    if (captured === null) throw new Error('probe did not render');
    return { html, runtime, context: captured };
  } finally {
    runtime.dispose();
  }
}

describe('component runtime services in the public context', () => {
  it('resolves explicit seeds and stable state keys', () => {
    const { context } = mount('<probe state-key="demo" seed="123">');
    expect(context.services.random.seed).toBe(123);
    expect(context.services.state.key).toContain('state:demo');
    expect(context.services.state.component).toBe('example/probe');
    expect(typeof context.services.scheduler.every).toBe('function');
  });

  it('derives a distinct seed per component instance without explicit seeds', () => {
    const config = createLocalConfig({ components: [probeDefinition()] });
    const source = '<probe state-key="one">\n<probe state-key="two">';
    const result = compileLocal(source, { config });
    if (!result.ok) throw new Error('compile failed');
    const runtime = createLocalRuntime(result.document, { documentId: 'doc', randomSeed: 5 });
    const seeds: number[] = [];
    const probe = defineReactComponent(probeDefinition(), {
      render: (context: LocalComponentContext) => {
        seeds.push(context.services.random.seed);
        return <span>{context.services.state.key}</span>;
      },
    });
    const reactConfig = createReactConfig(config, { components: [probe] });
    try {
      renderToStaticMarkup(
        <LocalDocumentView document={result.document} runtime={runtime} reactConfig={reactConfig} mode="static" />,
      );
    } finally {
      runtime.dispose();
    }
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it('exposes explicit save and restore through the runtime registry', () => {
    const first = mount('<probe state-key="demo">', { documentId: 'doc', randomSeed: 1 });
    const key = first.context.services.state.key;
    expect(first.context.services.state.load()).toBeNull();
    const saved = first.context.services.state.save({ score: 5 });
    expect(saved.ok).toBe(true);
    const snapshot = first.runtime.services?.state.snapshot();
    expect(snapshot?.records[key]?.data).toEqual({ score: 5 });

    const second = mount('<probe state-key="demo">', {
      documentId: 'doc',
      randomSeed: 1,
      componentState: snapshot,
    });
    expect(second.context.services.state.load()?.data).toEqual({ score: 5 });
  });
});
