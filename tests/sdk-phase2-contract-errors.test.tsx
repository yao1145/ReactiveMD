import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { compileLocal as compileResult } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type {
  Diagnostic,
  LocalDocument,
  LocalHostComponentSchema,
  LocalRuntime,
} from '../src/local/types';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import { getLocalComponentRegistry } from '../src/sdk/registry';
import {
  createReactConfig,
  defineReactComponent,
  type LocalComponentContext,
  type LocalReactConfig,
} from '../src/react/sdk';
import { renderLocalStaticDocument } from '../src/react/server';
import { createLocalExportPlan } from '../src/export';

const PROTOCOL = 'reactive-md-component/v1';

function compileLocal(...args: Parameters<typeof compileResult>) {
  const result = compileResult(...args);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

function capabilities() {
  return { interactive: true, static: true, ssr: true, offline: true };
}

function capture(): { diagnostics: Diagnostic[]; onDiagnostics: (items: Diagnostic[]) => void } {
  const diagnostics: Diagnostic[] = [];
  return { diagnostics, onDiagnostics: (items) => diagnostics.push(...items) };
}

function renderStatic(
  document: LocalDocument,
  runtime: LocalRuntime,
  options: {
    onDiagnostics?: (items: Diagnostic[]) => void;
    mode?: 'static' | 'interactive';
    reactConfig?: LocalReactConfig;
  } = {},
): string {
  return renderToStaticMarkup(createElement(LocalDocumentView, {
    document,
    runtime,
    mode: options.mode ?? 'static',
    reactConfig: options.reactConfig,
    onDiagnostics: options.onDiagnostics,
  }));
}

function pingDefinition(version = '1.0.0') {
  return defineLocalComponent({
    id: 'example/ping',
    name: 'ping',
    version,
    protocol: PROTOCOL,
    form: 'leaf',
    props: {
      code: { kind: 'string', dynamic: true, pattern: '^[a-z]+$' },
      ratio: { kind: 'number', dynamic: true, positive: true },
    },
    capabilities: capabilities(),
  });
}

const PingView = (context: LocalComponentContext) => (
  <span className="ping-output">{`${String(context.props.code)}:${String(context.props.ratio)}`}</span>
);

function withPing(source: string) {
  const definition = pingDefinition();
  const config = createLocalConfig({ components: [definition] });
  const result = compileLocal(source, { config });
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  const reactConfig = createReactConfig(config, {
    components: [defineReactComponent(definition, { render: PingView })],
  });
  return { document: result.document, reactConfig, definition, config };
}

describe('render-time prop diagnostics', () => {
  it('reports a dynamic enum failure with component, attribute and range', () => {
    const result = compileLocal(
      '<input bind="tone" label="Tone" initial="bogus">\n<alert tone="{{ tone }}">Body</alert>',
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    const runtime = createLocalRuntime(result.document);
    try {
      const captured = capture();
      renderStatic(result.document, runtime, { onDiagnostics: captured.onDiagnostics });
      const errors = captured.diagnostics.filter(item => item.code === 'local.component.prop');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('tone');
      expect(errors[0].message).toContain('must be one of');
      const alert = findNode(result.document.nodes, 'alert');
      expect(errors[0].range).toEqual(alert!.range);
    } finally {
      runtime.dispose();
    }
  });

  it('reports dynamic pattern and positive-number failures on external components', () => {
    const { document, reactConfig } = withPing(
      '<input bind="c" label="Code" initial="BAD">\n<number bind="r" label="Ratio" initial="0">\n<ping code="{{ c }}" ratio="{{ r }}"/>',
    );
    const runtime = createLocalRuntime(document);
    try {
      const captured = capture();
      renderStatic(document, runtime, {
        onDiagnostics: captured.onDiagnostics,
        reactConfig,
      });
      const messages = captured.diagnostics
        .filter(item => item.code === 'local.component.prop')
        .map(item => item.message);
      expect(messages.some(item => item.includes('pattern'))).toBe(true);
      expect(messages.some(item => item.includes('greater than zero'))).toBe(true);
    } finally {
      runtime.dispose();
    }
    expect(reactConfig.components).toHaveLength(1);
  });

  it('deduplicates repeated failures and reports again after recovery', () => {
    const result = compileLocal(
      '<input bind="tone" label="Tone" initial="bogus">\n<alert tone="{{ tone }}">Body</alert>',
    );
    expect(result.ok).toBe(true);
    const runtime = createLocalRuntime(result.document);
    try {
      const captured = capture();
      const view = () => renderStatic(result.document, runtime, {
        mode: 'interactive',
        onDiagnostics: captured.onDiagnostics,
      });
      const propErrors = () => captured.diagnostics.filter(item => item.code === 'local.component.prop').length;
      view();
      expect(propErrors()).toBe(1);
      view();
      expect(propErrors()).toBe(1);

      expect(runtime.setParameter('tone', 'info').map(item => item.code)).toEqual([]);
      view();
      expect(propErrors()).toBe(1);

      expect(runtime.setParameter('tone', 'bogus').map(item => item.code)).toEqual([]);
      view();
      expect(propErrors()).toBe(2);
    } finally {
      runtime.dispose();
    }
  });

  it('fails strict server rendering on a prop failure', () => {
    const result = compileLocal(
      '<input bind="tone" label="Tone" initial="bogus">\n<alert tone="{{ tone }}">Body</alert>',
    );
    expect(result.ok).toBe(true);
    const runtime = createLocalRuntime(result.document);
    try {
      const server = renderLocalStaticDocument({ document: result.document, runtime });
      expect(server.ok).toBe(false);
      expect(server.diagnostics.some(item => item.code === 'local.component.prop')).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('deduplicates browser static rerenders and reports again after recovery', async () => {
    const result = compileLocal('<input bind="tone" label="Tone" initial="bogus">\n<alert tone="{{ tone }}">Body</alert>');
    const runtime = createLocalRuntime(result.document);
    const captured = capture();
    vi.stubGlobal('window', {});
    try {
      const view = () => renderStatic(result.document, runtime, { onDiagnostics: captured.onDiagnostics });
      const count = () => captured.diagnostics.filter(item => item.code === 'local.component.prop').length;
      view(); await Promise.resolve();
      expect(count()).toBe(1);
      view(); await Promise.resolve();
      expect(count()).toBe(1);
      runtime.setParameter('tone', 'info');
      view(); await Promise.resolve();
      runtime.setParameter('tone', 'bogus');
      view(); await Promise.resolve();
      expect(count()).toBe(2);
    } finally { vi.unstubAllGlobals(); runtime.dispose(); }
  });
});

describe('carried contract preflight', () => {
  it('rejects a forged carried default definition and keeps installed semantics', () => {
    const result = compileLocal('<number bind="n" label="N">');
    expect(result.ok).toBe(true);
    const installedNumber = getLocalComponentRegistry().find(item => item.name === 'number');
    expect(installedNumber).toBeDefined();
    const forged = defineLocalComponent({
      ...installedNumber!,
      props: { ...installedNumber!.props, evil: { kind: 'string' } },
    });
    const tampered = {
      ...result.document,
      componentDefinitions: [forged],
    } as unknown as LocalDocument;
    const runtime = createLocalRuntime(result.document);
    try {
      const captured = capture();
      const markup = renderStatic(tampered, runtime, { onDiagnostics: captured.onDiagnostics });
      expect(markup).toContain('local-number');
      expect(markup).toContain('does not match the installed component contract');

      const server = renderLocalStaticDocument({ document: tampered, runtime });
      expect(server.ok).toBe(false);
      expect(server.diagnostics.some(item => item.code === 'local.extension.contract')).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('diagnoses malformed carried metadata instead of throwing', () => {
    const result = compileLocal('<number bind="n" label="N">');
    expect(result.ok).toBe(true);
    const tampered = {
      ...result.document,
      componentDefinitions: 'not-a-list',
    } as unknown as LocalDocument;
    const runtime = createLocalRuntime(result.document);
    try {
      const captured = capture();
      const markup = renderStatic(tampered, runtime, { onDiagnostics: captured.onDiagnostics });
      expect(markup).toContain('local-number');
      expect(markup).toContain('Carried component definitions must be an array');
    } finally {
      runtime.dispose();
    }
  });

  it('diagnoses a missing external requirement for a used external component', () => {
    const { document, reactConfig } = withPing('<ping code="abc" ratio="2"/>');
    const stripped = { ...document, extensions: undefined } as unknown as LocalDocument;
    const runtime = createLocalRuntime(document);
    try {
      const server = renderLocalStaticDocument({
        document: stripped,
        runtime,
        reactConfig,
      });
      expect(server.ok).toBe(false);
      expect(server.diagnostics.some(item =>
        item.code === 'local.extension.contract' && item.message.includes('ping'),
      )).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('blocks an external implementation when its requirement is missing, including a forged node kind', () => {
    const { document, definition, config } = withPing('<ping code="abc" ratio="2"/>');
    let calls = 0;
    const reactConfig = createReactConfig(config, { components: [defineReactComponent(definition, {
      render: () => { calls += 1; return <span>executed-ping</span>; },
    })] });
    for (const type of ['hostComponent', 'component'] as const) {
      const tampered = { ...document, extensions: undefined,
        nodes: document.nodes.map(node => node.name === 'ping' ? { ...node, type } : node) };
      const runtime = createLocalRuntime(document);
      try {
        const markup = renderStatic(tampered, runtime, { reactConfig });
        expect(markup).not.toContain('executed-ping');
        expect(calls).toBe(0);
        expect(createLocalExportPlan({ document: tampered, config, target: 'static' }).ok).toBe(false);
      } finally { runtime.dispose(); }
    }
  });

  it('rejects an A-compiled external document under installed contract B', () => {
    const { document } = withPing('<ping code="abc" ratio="2"/>');
    const definitionB = pingDefinition('1.0.1');
    const configB = createLocalConfig({ components: [definitionB] });
    const reactConfigB = createReactConfig(configB, {
      components: [defineReactComponent(definitionB, { render: PingView })],
    });
    const runtime = createLocalRuntime(document);
    try {
      const server = renderLocalStaticDocument({ document, runtime, reactConfig: reactConfigB });
      expect(server.ok).toBe(false);
      expect(server.diagnostics.some(item => item.code === 'local.extension.requirements')).toBe(true);
      expect(server.diagnostics.some(item => item.code === 'local.extension.contract')).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps normal default documents and componentDefinitions-less documents usable', () => {
    const result = compileLocal('<number bind="n" label="N">');
    expect(result.ok).toBe(true);
    const runtime = createLocalRuntime(result.document);
    try {
      const captured = capture();
      const markup = renderStatic(result.document, runtime, { onDiagnostics: captured.onDiagnostics });
      expect(markup).toContain('local-number');
      expect(captured.diagnostics).toEqual([]);

      const stripped = { ...result.document } as LocalDocument;
      delete (stripped as { componentDefinitions?: unknown }).componentDefinitions;
      const capturedStripped = capture();
      expect(renderStatic(stripped, runtime, { onDiagnostics: capturedStripped.onDiagnostics }))
        .toContain('local-number');
      expect(capturedStripped.diagnostics).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps legacy hostRenderer-only fixtures working', () => {
    const schema: LocalHostComponentSchema = {
      name: 'host-widget',
      form: 'leaf',
      props: { kind: { kind: 'string' }, ref: { kind: 'string' } },
    };
    const result = compileLocal('<host-widget kind="weather" ref="berlin"/>', {
      hostComponents: [schema],
    });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    const runtime = createLocalRuntime(result.document);
    try {
      const captured = capture();
      const markup = renderToStaticMarkup(createElement(LocalDocumentView, {
        document: result.document,
        runtime,
        hostData: { 'weather:berlin': { temperature: 21 } },
        hostRenderer: (_node, data) => createElement(
          'span',
          { className: 'legacy-host-output' },
          String((data as { temperature: number }).temperature),
        ),
        onDiagnostics: captured.onDiagnostics,
      }));
      expect(markup).toContain('legacy-host-output');
      expect(captured.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
});

function findNode(nodes: LocalDocument['nodes'], name: string): { range: { start: number; end: number } } | null {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === 'component' && node.name === name) return node;
    if (node.children) stack.push(...node.children);
  }
  return null;
}
