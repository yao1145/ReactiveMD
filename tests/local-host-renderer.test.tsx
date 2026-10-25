import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type { LocalDocument, LocalHostComponentSchema, LocalNode } from '../src/local/types';

const HOST_SOURCE = '<host-widget kind="weather" ref="berlin"/>';
const DATA_KEY = 'weather:berlin';

const SCHEMA: LocalHostComponentSchema = {
  name: 'host-widget',
  form: 'leaf',
  props: {
    kind: { kind: 'string' },
    ref: { kind: 'string' },
  },
};

function compile(source = HOST_SOURCE): { document: LocalDocument; host: LocalNode } {
  const result = compileLocal(source, { hostComponents: [SCHEMA] });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  }
  const visit = (nodes: LocalNode[]): LocalNode | undefined => {
    for (const node of nodes) {
      if (node.type === 'hostComponent') return node;
      const child = visit(node.children ?? []);
      if (child) return child;
    }
    return undefined;
  };
  const host = visit(result.document.nodes);
  if (!host) throw new Error('Missing hostComponent node');
  return { document: result.document, host };
}

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectPlaceholder(html: string): void {
  expect(html).toContain('local-host-component');
  expect(html).toContain('local-host-unavailable');
  expect(plain(html)).toContain('host-widget');
}

describe('host component rendering', () => {
  it('passes the node, its host data and an interactive context to the renderer', () => {
    const { document, host } = compile();
    const runtime = createLocalRuntime(document);
    const data = { temperature: 21 };
    const calls: Array<{ node: LocalNode; data: unknown; mode: string }> = [];
    const hostRenderer = vi.fn((node: LocalNode, value: unknown, ctx: { mode: string }) => {
      calls.push({ node, data: value, mode: ctx.mode });
      return <span className="host-output">{(value as { temperature: number }).temperature}</span>;
    });

    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          hostData={{ [DATA_KEY]: data }}
          hostRenderer={hostRenderer}
        />,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].node).toBe(host);
      expect(calls[0].data).toBe(data);
      expect(calls[0].mode).toBe('interactive');
      expect(hostRenderer).toHaveBeenCalledTimes(1);
      expect(html).toContain('host-output');
      expect(html).toContain('21');
    } finally {
      runtime.dispose();
    }
  });

  it('passes static mode to the renderer while still calling it', () => {
    const { document } = compile();
    const runtime = createLocalRuntime(document);
    const modes: string[] = [];
    const hostRenderer = (node: LocalNode, value: unknown, ctx: { mode: string }) => {
      modes.push(ctx.mode);
      return <span className="host-static">{(value as { label: string }).label}</span>;
    };

    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          mode="static"
          hostData={{ [DATA_KEY]: { label: 'Berlin' } }}
          hostRenderer={hostRenderer}
        />,
      );

      expect(modes).toEqual(['static']);
      expect(html).toContain('host-static');
      expect(html).toContain('Berlin');
    } finally {
      runtime.dispose();
    }
  });

  it('renders the unavailable placeholder when no renderer is supplied', () => {
    const { document } = compile();
    const runtime = createLocalRuntime(document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          hostData={{ [DATA_KEY]: { temperature: 21 } }}
        />,
      );
      expectPlaceholder(html);
    } finally {
      runtime.dispose();
    }
  });

  it('renders the unavailable placeholder when hostData has no entry', () => {
    const { document } = compile();
    const runtime = createLocalRuntime(document);
    const hostRenderer = vi.fn(() => <span className="host-output">unexpected</span>);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          hostRenderer={hostRenderer}
        />,
      );
      expectPlaceholder(html);
      expect(hostRenderer).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });

  it('renders the unavailable placeholder when hostData uses a different key', () => {
    const { document } = compile();
    const runtime = createLocalRuntime(document);
    const hostRenderer = vi.fn(() => <span className="host-output">unexpected</span>);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          hostData={{ 'weather:paris': { temperature: 21 } }}
          hostRenderer={hostRenderer}
        />,
      );
      expectPlaceholder(html);
      expect(hostRenderer).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });

  it('renders the unavailable placeholder when kind or ref is missing', () => {
    const { document } = compile('<host-widget ref="berlin"/>');
    const runtime = createLocalRuntime(document);
    const hostRenderer = vi.fn(() => <span className="host-output">unexpected</span>);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={document}
          runtime={runtime}
          hostData={{ [DATA_KEY]: { temperature: 21 } }}
          hostRenderer={hostRenderer}
        />,
      );
      expectPlaceholder(html);
      expect(hostRenderer).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });

  it('degrades a throwing renderer to the unavailable placeholder', () => {
    const { document } = compile();
    const runtime = createLocalRuntime(document);
    const hostRenderer = (): never => {
      throw new Error('renderer boom');
    };
    try {
      let html = '';
      expect(() => {
        html = renderToStaticMarkup(
          <LocalDocumentView
            document={document}
            runtime={runtime}
            hostData={{ [DATA_KEY]: { temperature: 21 } }}
            hostRenderer={hostRenderer}
          />,
        );
      }).not.toThrow();
      expectPlaceholder(html);
    } finally {
      runtime.dispose();
    }
  });
});
