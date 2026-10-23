import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import {
  LocalDocumentView,
  LocalReactiveDocument,
  type LocalUrlPolicy,
} from '../src/local/LocalDocumentView';
import { compileLatex, LatexError, samplePlot } from '../src/local/math';
import { LatexView } from '../src/local/math-view';
import { LocalVisual } from '../src/local/visuals';
import { MAX_LOCAL_PLOT_POINTS } from '../src/local/limits';
import type { LocalDocument, LocalNode, LocalRuntime, LocalValue } from '../src/local/types';

/* --------------------------------------------------------------- helpers */

function renderReactive(source: string, urlPolicy?: LocalUrlPolicy): string {
  return renderToStaticMarkup(
    urlPolicy
      ? createElement(LocalReactiveDocument, { source, urlPolicy })
      : createElement(LocalReactiveDocument, { source }),
  );
}

let serial = 0;
const range = { start: 0, end: 0 };

function node(type: string, extra: Partial<LocalNode> = {}): LocalNode {
  return { type, id: `security-${serial++}`, range, ...extra };
}

function component(name: string, attrs: Record<string, string>, children: LocalNode[] = []): LocalNode {
  return node('component', { name, attrs, children });
}

function createRuntime(initial: Record<string, LocalValue> = {}): LocalRuntime {
  return {
    document: {
      syntax: 'local',
      source: '',
      nodes: [],
      initialState: { ...initial },
      bindings: {},
    } as LocalDocument,
    snapshot: () => ({ revision: 0, state: initial }),
    get: () => null,
    set: () => [],
    setMany: () => [],
    evaluate: () => null,
    text: (template) => template,
    reset: () => {},
    resetToken: () => 0,
    subscribe: () => () => {},
    dispose: () => {},
  };
}

function plotNode(id: string, curves: number, samples: number): LocalNode {
  return node('component', {
    id,
    name: 'plot',
    attrs: { min: '0', max: '2', samples: String(samples) },
    children: Array.from({ length: curves }, (_value, index) =>
      node('math', { id: `${id}-math-${index}`, value: `y = x + ${index}` }),
    ),
  });
}

function mountVisual(visual: LocalNode, runtime: LocalRuntime): string {
  return renderToStaticMarkup(
    createElement(LocalVisual, {
      node: visual,
      runtime,
      render: () => null,
      visible: true,
    }),
  );
}

/* ---------------------------------------------------------- URL policies */

describe('host URL policy', () => {
  it('blocks relative and remote images by default but keeps safe links', () => {
    for (const url of ['/local.png', 'https://images.example.com/a.png', '//cdn.example.com/a.png']) {
      const html = renderReactive(`![x](${url})`);
      expect(html).not.toContain('<img');
    }
    expect(renderReactive('[docs](/docs)')).toContain('href="/docs"');
  });

  it('allows an image only when the host policy opts in', () => {
    const html = renderReactive(
      '![x](https://images.example.com/a.png)',
      (url, kind) => kind === 'image' && url.includes('images.example.com'),
    );
    expect(html).toContain('<img');
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
  });

  it('applies the policy through LocalDocumentView as well', () => {
    const result = compileLocal('![x](/local.png)');
    if (!result.ok) throw new Error('fixture did not compile');
    const runtime = createLocalRuntime(result.document);
    try {
      const denied = renderToStaticMarkup(
        createElement(LocalDocumentView, { document: result.document, runtime }),
      );
      expect(denied).not.toContain('<img');
      const allowed = renderToStaticMarkup(
        createElement(LocalDocumentView, {
          document: result.document,
          runtime,
          urlPolicy: () => true,
        }),
      );
      expect(allowed).toContain('<img');
    } finally {
      runtime.dispose();
    }
  });

  it('still rejects javascript and data URLs when the policy allows everything', () => {
    const allowAll: LocalUrlPolicy = () => true;
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAAA']) {
      expect(renderReactive(`![x](${url})`, allowAll)).not.toContain('<img');
    }
    expect(renderReactive('[x](javascript:alert(1))', allowAll)).not.toContain('href="javascript');
    expect(renderReactive('[x](data:text/html;base64,AAAA)', allowAll)).not.toContain('href="data');
  });

  it('fails closed when the policy throws or denies a link', () => {
    const throwing: LocalUrlPolicy = () => {
      throw new Error('policy unavailable');
    };
    const image = renderReactive('![x](/a.png)', throwing);
    expect(image).not.toContain('<img');
    const link = renderReactive('[x](https://example.com/a)', throwing);
    expect(link).not.toContain('href="https://example.com/a"');
    const denied = renderReactive('[x](https://example.com/a)', () => false);
    expect(denied).not.toContain('href="https://example.com/a"');
  });
});

/* ------------------------------------------------------------ math budgets */

describe('MathML budgets', () => {
  it('falls back to bounded literal text for oversized sources', () => {
    const html = renderToStaticMarkup(
      createElement(LatexView, { source: 'x'.repeat(50_001) }),
    );
    expect(html.length).toBeLessThan(50_000);
  });

  it('falls back when the token count exceeds the limit', () => {
    const source = Array.from({ length: 20_001 }, () => 'x').join(' ');
    const html = renderToStaticMarkup(createElement(LatexView, { source }));
    expect(html.length).toBeLessThan(20_000);
  });

  it('falls back instead of recursing without a depth limit', () => {
    const source = `${'\\sqrt{'.repeat(200)}x${'}'.repeat(200)}`;
    expect(() => renderToStaticMarkup(createElement(LatexView, { source }))).not.toThrow();
    const html = renderToStaticMarkup(createElement(LatexView, { source }));
    expect(html.length).toBeLessThan(20_000);
  });

  it('never treats inherited object keys as symbols', () => {
    const html = renderToStaticMarkup(
      createElement(LatexView, { source: '\\constructor + \\toString' }),
    );
    expect(html).toContain('constructor');
    expect(html).toContain('toString');
    expect(html).not.toContain('[object');
  });
});

/* ------------------------------------------------------------ plot budgets */

describe('plot work budgets', () => {
  it('fails closed when a plot supplies more than sixteen curves', () => {
    const runtime = createRuntime();
    const html = mountVisual(plotNode('too-many-curves', 17, 10), runtime);
    expect(html).toContain('plot supports at most 16 curves');
    expect(html).not.toContain('<svg');
  });

  it('counts requested samples across the whole document', () => {
    const runtime = createRuntime();
    const first = plotNode('first-plot', 11, 1000);
    const second = plotNode('second-plot', 11, 1000);

    const firstHtml = mountVisual(first, runtime);
    expect(firstHtml).toContain('<svg');

    const secondHtml = mountVisual(second, runtime);
    expect(secondHtml).toContain(String(MAX_LOCAL_PLOT_POINTS));
    expect(secondHtml).not.toContain('<svg');
  });

  it('keeps the five-argument samplePlot contract and consumes a shared budget', () => {
    const expression = compileLatex('y = x');
    const shared = { steps: 0, limit: 2_000_000 };
    const sample = samplePlot(expression, {}, 0, 2, 20, shared);
    expect(sample.points).toHaveLength(20);
    expect(shared.steps).toBeGreaterThan(0);

    const heavy = compileLatex(`y = ${Array.from({ length: 600 }, () => 'x').join(' + ')}`);
    const exhausted = { steps: 0, limit: 500 };
    let error: unknown = null;
    try {
      samplePlot(heavy, {}, 0, 1, 100, exhausted);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(LatexError);
    expect((error as LatexError).code).toBe('latex-budget');
  });
});
