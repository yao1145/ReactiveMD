import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/index';
import type { LocalHostComponentContext } from '../src/local/render-types';
import type { LocalDocument, LocalNode, LocalRuntime } from '../src/local/types';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { LocalReactiveDocument } from '../src/react/index';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import {
  LocalReactExtensionMissingError,
  createReactConfig,
  defineReactComponent,
  type LocalComponentContext,
  type LocalReactConfig,
} from '../src/react/sdk';

const PROTOCOL = 'reactive-md-component/v1';

function ratingDefinition() {
  return defineLocalComponent({
    id: 'example/rating',
    name: 'rating',
    version: '1.0.0',
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
        constraints: {
          min: { literal: 0 },
          max: { prop: 'max' },
          step: { literal: 1 },
        },
      },
    },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function stampDefinition() {
  return defineLocalComponent({
    id: 'example/stamp',
    name: 'stamp',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: { text: { kind: 'string', required: true } },
    capabilities: { interactive: true, static: true, ssr: true, offline: false },
  });
}

const Rating = defineReactComponent(ratingDefinition(), {
  render: (context: LocalComponentContext) => (
    <span className="rating" data-max={String(context.props.max)}>
      {`${String(context.props.label)}:${String(context.bindings.value.get())}`}
    </span>
  ),
  renderStatic: (context: LocalComponentContext) => (
    <span className="rating-static">
      {`${String(context.props.label)}:${String(context.bindings.value.get())}`}
    </span>
  ),
});

function compileWith(
  source: string,
  definition = ratingDefinition(),
  implementation = Rating,
): { document: LocalDocument; reactConfig: LocalReactConfig } {
  const config = createLocalConfig({ components: [definition] });
  const reactConfig = createReactConfig(config, { components: [implementation] });
  const result = compileLocal(source, { config });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  }
  return { document: result.document, reactConfig };
}

function renderDocument(
  source: string,
  options: { mode?: 'interactive' | 'static'; definition?: ReturnType<typeof ratingDefinition>; implementation?: typeof Rating } = {},
): { html: string; document: LocalDocument; runtime: LocalRuntime; reactConfig: LocalReactConfig } {
  const { document, reactConfig } = compileWith(source, options.definition, options.implementation);
  const runtime = createLocalRuntime(document);
  try {
    const html = renderToStaticMarkup(
      <LocalDocumentView
        document={document}
        runtime={runtime}
        reactConfig={reactConfig}
        {...(options.mode ? { mode: options.mode } : {})}
      />,
    );
    return { html, document, runtime, reactConfig };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe('defineReactComponent', () => {
  it('binds a manifest digest and freezes the implementation record', () => {
    const implementation = defineReactComponent(ratingDefinition(), {
      render: () => null,
    });
    expect(Object.isFrozen(implementation)).toBe(true);
    expect(implementation.digest.length).toBeGreaterThan(0);
    expect(implementation.definition.id).toBe('example/rating');
  });

  it('rejects an implementation with no render function', () => {
    expect(() => defineReactComponent(ratingDefinition(), {} as never)).toThrow(/render/);
  });

  it('rejects capabilities that the React adapter cannot honour', () => {
    const definition = ratingDefinition();
    const inconsistent = {
      ...definition,
      capabilities: { interactive: false, static: false, ssr: true, offline: false },
    } as typeof definition;
    expect(() => defineReactComponent(inconsistent, { render: () => null })).toThrow(/SSR/);
  });
});

describe('createReactConfig', () => {
  it('exposes the config, derived themes and the legacy host renderer bridge', () => {
    const config = createLocalConfig({ components: [ratingDefinition()] });
    const reactConfig = createReactConfig(config, { components: [Rating] });
    expect(reactConfig.config.key).toBe(config.key);
    expect(reactConfig.components).toHaveLength(1);
    expect(reactConfig.themes).toEqual([]);
    expect(typeof reactConfig.hostRenderer).toBe('function');
  });

  it('rejects missing, duplicate and mismatched implementations', () => {
    const definition = ratingDefinition();
    const config = createLocalConfig({ components: [definition] });

    expect(() => createReactConfig(config, { components: [] })).toThrow(/missing implementations/);
    expect(() => createReactConfig(config, { components: [Rating, Rating] })).toThrow(/more than one/);

    const changed = defineLocalComponent({
      ...definition,
      props: {
        ...definition.props,
        max: { ...definition.props.max, default: 4 },
      },
    });
    const changedImplementation = defineReactComponent(changed, { render: () => null });
    expect(() => createReactConfig(config, { components: [changedImplementation] }))
      .toThrow(/does not match/);
  });

  it('rejects an implementation that belongs to a different config', () => {
    const config = createLocalConfig({ components: [ratingDefinition()] });
    const stamp = defineReactComponent(stampDefinition(), { render: () => null });
    expect(() => createReactConfig(config, { components: [stamp] })).toThrow(/not declared/);
  });
});

describe('SDK component rendering', () => {
  it('normalizes literal and full-interpolation props and reads the shared binding', () => {
    const { html, runtime } = renderDocument(
      '<rating bind="score" label="Rate" max="{{ 2 + 3 }}" initial="3">',
    );
    try {
      expect(html).toContain('class="rating"');
      expect(html).toContain('data-max="5"');
      expect(html).toContain('Rate:3');
    } finally {
      runtime.dispose();
    }
  });

  it('renders a stateless leaf without host data', () => {
    const definition = stampDefinition();
    const Stamp = defineReactComponent(definition, {
      render: (context: LocalComponentContext) => (
        <span className="stamp">{String(context.props.text)}</span>
      ),
    });
    const config = createLocalConfig({ components: [definition] });
    const reactConfig = createReactConfig(config, { components: [Stamp] });
    const result = compileLocal('<stamp text="Hi"/>', { config });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={result.document} runtime={runtime} reactConfig={reactConfig} />,
      );
      expect(html).toContain('class="stamp"');
      expect(html).toContain('Hi');
      expect(html).not.toContain('local-host-unavailable');
    } finally {
      runtime.dispose();
    }
  });

  it('writes through the kernel and shares the binding with a built-in control', () => {
    const definition = ratingDefinition();
    const Setter = defineReactComponent(definition, {
      render: (context: LocalComponentContext) => {
        const result = context.bindings.value.set(4);
        return (
          <span className="rating-set" data-ok={String(result.ok)}>
            {String(context.bindings.value.get())}
          </span>
        );
      },
    });
    const config = createLocalConfig({ components: [definition] });
    const reactConfig = createReactConfig(config, { components: [Setter] });
    const result = compileLocal(
      '<number bind="score" label="Score" min="0" max="5" initial="3">\n\n<rating bind="score" label="Rate" max="5">',
      { config },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={result.document} runtime={runtime} reactConfig={reactConfig} />,
      );
      expect(html).toContain('class="rating-set" data-ok="true"');
      expect(runtime.getParameter('score')).toBe(4);
    } finally {
      runtime.dispose();
    }
  });

  it('uses renderStatic with a read-only binding setter', () => {
    const definition = ratingDefinition();
    const ReadOnly = defineReactComponent(definition, {
      render: (context: LocalComponentContext) => (
        <span className="rating">{String(context.bindings.value.get())}</span>
      ),
      renderStatic: (context: LocalComponentContext) => {
        const result = context.bindings.value.set(9);
        return (
          <span className="rating-static" data-ok={String(result.ok)}>
            {String(context.bindings.value.get())}
          </span>
        );
      },
    });
    const { html, runtime } = renderDocument(
      '<rating bind="score" label="Rate" initial="3">',
      { mode: 'static', definition, implementation: ReadOnly },
    );
    try {
      expect(html).toContain('class="rating-static" data-ok="false"');
      expect(html).toContain('>3</span>');
      expect(runtime.getParameter('score')).toBe(3);
    } finally {
      runtime.dispose();
    }
  });
});

describe('legacy host renderer bridge', () => {
  function bridgeEnvironment() {
    let seen: { nodes: LocalNode[] | undefined; visible: boolean } | null = null;
    const runtime = {
      evaluate: (value: string) => value,
      text: (value: string) => value,
      document: { source: '<stamp text="Hi">' },
      snapshot: () => ({ revision: 0, state: {} }),
      get: () => null,
    } as unknown as LocalRuntime;
    const context = {
      runtime,
      mode: 'interactive',
      visible: false,
      value: null,
      setValue: () => true,
      disabled: false,
      resetToken: 7,
      props: {},
      report: () => {},
      render: (nodes: LocalNode[] | undefined, visible: boolean) => {
        seen = { nodes, visible };
        return <b>child</b>;
      },
    } as unknown as LocalHostComponentContext;
    return { context, seen: () => seen };
  }

  it('renders children at the inherited visibility', () => {
    const definition = stampDefinition();
    const Container = defineReactComponent(definition, {
      render: (context: LocalComponentContext) => <div>{context.children.render()}</div>,
    });
    const config = createLocalConfig({ components: [definition] });
    const reactConfig = createReactConfig(config, { components: [Container] });
    const children: LocalNode[] = [
      { type: 'text', id: 'child', range: { start: 0, end: 3 }, value: 'Hi' },
    ];
    const node: LocalNode = {
      type: 'hostComponent',
      id: 'stamp-1',
      range: { start: 0, end: 18 },
      name: 'stamp',
      hostForm: 'leaf',
      attrs: { text: 'Hi' },
      children,
    };
    const environment = bridgeEnvironment();
    const html = renderToStaticMarkup(
      <>{reactConfig.hostRenderer(node, undefined, environment.context)}</>,
    );
    expect(html).toContain('<b>child</b>');
    expect(environment.seen()).toEqual({ nodes: children, visible: false });
  });

  it('throws a typed error for an unregistered component tag', () => {
    const definition = stampDefinition();
    const ReactStamp = defineReactComponent(definition, { render: () => null });
    const config = createLocalConfig({ components: [definition] });
    const reactConfig = createReactConfig(config, { components: [ReactStamp] });
    const node: LocalNode = {
      type: 'hostComponent',
      id: 'missing-1',
      range: { start: 0, end: 8 },
      name: 'missing',
      hostForm: 'leaf',
    };
    const environment = bridgeEnvironment();
    expect(() => reactConfig.hostRenderer(node, undefined, environment.context))
      .toThrow(LocalReactExtensionMissingError);
  });
});

describe('document view integration', () => {
  it('rejects legacy host props alongside reactConfig', () => {
    const { document, reactConfig } = compileWith('<rating bind="score" label="Rate" initial="3">');
    const runtime = createLocalRuntime(document);
    try {
      expect(() => renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          reactConfig={reactConfig}
          hostRenderer={() => null}
        />,
      )).toThrow(/hostRenderer/);
      expect(() => renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          reactConfig={reactConfig}
          themes={[]}
        />,
      )).toThrow(/themes/);
    } finally {
      runtime.dispose();
    }
  });

  it('validates document extensions against the installed config before rendering', () => {
    const original = ratingDefinition();
    const compiled = compileWith(
      '<rating bind="score" label="Rate" initial="3">',
      original,
      Rating,
    );
    const changed = defineLocalComponent({
      ...original,
      props: { ...original.props, max: { ...original.props.max, default: 4 } },
    });
    const changedConfig = createLocalConfig({ components: [changed] });
    const changedReact = createReactConfig(changedConfig, {
      components: [defineReactComponent(changed, { render: () => null })],
    });
    const runtime = createLocalRuntime(compiled.document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={compiled.document}
          runtime={runtime}
          reactConfig={changedReact}
        />,
      );
      expect(html).toContain('data-local-extension-error');
      expect(html).toContain('local-host-unavailable');
    } finally {
      runtime.dispose();
    }
  });
});

describe('LocalReactiveDocument config integration', () => {
  it('lowers the config into compile options and renders the component', () => {
    const config = createLocalConfig({ components: [ratingDefinition()] });
    const reactConfig = createReactConfig(config, { components: [Rating] });
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={'<rating bind="score" label="Rate" max="5" initial="3">'}
        reactConfig={reactConfig}
      />,
    );
    expect(html).toContain('class="rating"');
    expect(html).toContain('Rate:3');
  });

  it('rejects a different compileOptions config and hostComponents', () => {
    const config = createLocalConfig({ components: [ratingDefinition()] });
    const reactConfig = createReactConfig(config, { components: [Rating] });
    const other = createLocalConfig({ components: [] });
    expect(() => renderToStaticMarkup(
      <LocalReactiveDocument
        source="plain"
        reactConfig={reactConfig}
        compileOptions={{ config: other }}
      />,
    )).toThrow(/same local config/);
    expect(() => renderToStaticMarkup(
      <LocalReactiveDocument
        source="plain"
        reactConfig={reactConfig}
        compileOptions={{ hostComponents: [] }}
      />,
    )).toThrow(/hostComponents/);
  });
});
