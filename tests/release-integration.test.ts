import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  analyzeLocalSource,
  applyLocalStateRetention,
  compileLocal,
  createLocalRuntime,
  createLocalStateFile,
  exportLocalState,
  formatLocalSource,
  importLocalState,
  planLocalStateRetention,
  renameLocalBinding,
  serializeLocalState,
  type LocalDocument,
  type LocalNode,
  type LocalValue,
} from '../src/local';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { createShareableHtml, resolveLocalStateBaseline } from '../src/shareable';
import source from './browser/release-document.reactive.md?raw';
import baselineParameters from './browser/release-baseline.json';

const generator = { name: 'release-integration', version: '1' };

function compile(input: string): LocalDocument {
  const result = compileLocal(input);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
  }
  return result.document;
}

function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function component(document: LocalDocument, name: string): LocalNode {
  const match = flatten(document.nodes).find((node) => node.type === 'component' && node.name === name);
  if (!match) throw new Error(`Missing <${name}>`);
  return match;
}

function baselineDocument(): LocalDocument {
  const document = compile(source);
  const state = createLocalStateFile(document, baselineParameters as Record<string, LocalValue>, generator);
  const resolved = resolveLocalStateBaseline(document, state);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
  return resolved.baseline.document;
}

function visibleText(markup: string): string {
  return markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('release integration document', () => {
  it('computes declarations, applies a state baseline and raises validation from the same document', () => {
    const document = compile(source);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.evaluate('total')).toBe(25);
      expect(runtime.evaluate('mode')).toEqual(['standard', 'Ada']);
      expect(runtime.evaluate('subjectCount')).toBe(0);
      expect(runtime.setParameters(baselineParameters as Record<string, LocalValue>)).toEqual([]);
      expect(runtime.evaluate('total')).toBe(75);
      expect(runtime.evaluate('mode')).toEqual(['priority', 'Grace']);
      expect(runtime.evaluate('subjectCount')).toBe(2);
      expect(runtime.validate()).toEqual([]);
      expect(runtime.getParameters()).toEqual(baselineParameters);

      expect(runtime.setParameter('quantity', 10)).toEqual([]);
      expect(runtime.evaluate('total')).toBe(125);
      expect(runtime.validate().map((item) => item.message))
        .toEqual(['Total $125.00 exceeds the limit.']);

      runtime.reset(component(document, 'panel'));
      expect(runtime.getParameters()).toEqual({ quantity: 2, owner: 'Ada', subjects: [] });
      expect(runtime.evaluate('total')).toBe(25);
      expect(runtime.validate()).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('renders computed prose, the collection table and the Markdown table together', () => {
    const document = baselineDocument();
    const runtime = createLocalRuntime(document);
    try {
      const interactive = renderToStaticMarkup(createElement(LocalDocumentView, { document, runtime }));
      const interactiveText = visibleText(interactive);
      expect(interactiveText).toContain('Total: $75.00 for Grace.');
      expect(interactiveText).toContain('Mode: priority/Grace. Selected subjects: 2.');
      expect(interactive).toContain('aria-label="Release subjects"');
      expect(interactive).toContain('>physics<');
      expect(interactive).toContain('>chemistry<');
      expect(interactive).toMatch(/<caption[^>]*>Release table<\/caption>/);
      expect(interactive).toMatch(/>\s*75\s*</);
      expect(interactive).not.toContain('exceeds the limit');
      expect(interactive).not.toContain('local-fallback');

      const staticMarkup = renderToStaticMarkup(
        createElement(LocalDocumentView, { document, runtime, mode: 'static' }),
      );
      expect(staticMarkup).not.toContain('<input');
      expect(staticMarkup).not.toContain('<fieldset');
      expect(staticMarkup).toContain('Grace');
      expect(staticMarkup).toContain('$75.00');
      expect(staticMarkup).toContain('>physics<');
    } finally {
      runtime.dispose();
    }
  });

  it('renames the declaration across expressions, validation fields and computed values without touching code', () => {
    const renamed = renameLocalBinding(source, 'quantity', 'seats');
    expect(renamed.edits.length).toBeGreaterThan(0);
    expect(renamed.source).toContain('<number bind="seats"');
    expect(renamed.source).toContain('{{ seats * unitPrice }}');
    expect(renamed.source).toContain('fields="seats"');
    expect(renamed.source).toContain('quantity stays literal here');
    expect(renamed.source).not.toContain('bind="quantity"');
    expect(analyzeLocalSource(renamed.source).bindings.find((item) => item.name === 'seats')?.references.length)
      .toBeGreaterThan(1);

    const document = compile(renamed.source);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.setParameters({
        owner: baselineParameters.owner,
        subjects: baselineParameters.subjects,
        seats: 10,
      } as Record<string, LocalValue>)).toEqual([]);
      expect(runtime.evaluate('total')).toBe(125);
      expect(runtime.validate().map((item) => item.message))
        .toEqual(['Total $125.00 exceeds the limit.']);
    } finally {
      runtime.dispose();
    }
    expect(formatLocalSource(renamed.source)).toBe(renamed.source);
  });

  it('round trips exported state, retains values across prose edits and drops changed definitions', () => {
    const document = compile(source);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.setParameters(baselineParameters as Record<string, LocalValue>)).toEqual([]);
      const exported = exportLocalState(runtime, generator);
      expect(exported.parameters).toEqual(baselineParameters);
      expect(JSON.parse(serializeLocalState(exported)).parameters).toEqual(baselineParameters);

      runtime.setParameters({ quantity: 2, owner: 'Ada', subjects: [] });
      expect(importLocalState(runtime, serializeLocalState(exported))).toEqual([]);
      expect(runtime.getParameters()).toEqual(baselineParameters);

      const revised = compile(`${source}\n\nRevised prose keeps the shared session.`);
      const retention = planLocalStateRetention({
        previous: document,
        state: runtime.snapshot().state,
        next: revised,
      });
      expect(retention.retained).toEqual(['owner', 'quantity', 'subjects']);
      const nextRuntime = createLocalRuntime(revised);
      try {
        const applied = applyLocalStateRetention(nextRuntime, retention);
        expect(applied.diagnostics).toEqual([]);
        expect(nextRuntime.getParameters()).toEqual(baselineParameters);
      } finally {
        nextRuntime.dispose();
      }

      const changed = compile(source.replace('initial="2"', 'initial="3"'));
      const changedRetention = planLocalStateRetention({
        previous: document,
        state: runtime.snapshot().state,
        next: changed,
      });
      expect(changedRetention.retained).toEqual(['owner', 'subjects']);
      expect(changedRetention.dropped).toContainEqual({ name: 'quantity', reason: 'initial' });
    } finally {
      runtime.dispose();
    }
  });

  it('assembles interactive and static shells from the same baseline state', () => {
    const document = baselineDocument();
    const runtime = createLocalRuntime(document);
    try {
      const staticMarkup = renderToStaticMarkup(createElement(LocalDocumentView, { document, runtime }));
      const state = createLocalStateFile(document, runtime.getParameters(), generator);
      const interactive = createShareableHtml({
        title: 'Release integration',
        source: document.source,
        state,
        staticMarkup,
        css: '.md-document{}',
        mode: 'interactive',
        runtimeScript: 'globalThis.releaseShellMounted = true;',
        generator,
      });
      expect(interactive).toContain('application/reactive-md+json');
      expect(interactive).toContain('"quantity":6');
      expect(interactive).toContain('"owner":"Grace"');
      expect(interactive).toContain('"subjects":["physics","chemistry"]');
      expect(interactive).not.toContain('"@');
      expect(interactive).toContain('$75.00');
      expect(interactive).toContain('physics');

      const staticShell = createShareableHtml({
        title: 'Release integration',
        source: document.source,
        state,
        staticMarkup,
        css: '.md-document{}',
        mode: 'static',
        generator,
      });
      expect(staticShell).not.toContain('<script');
      expect(staticShell).not.toContain('application/reactive-md+json');
      expect(staticShell).toContain('$75.00');
      expect(staticShell).toContain('chemistry');
    } finally {
      runtime.dispose();
    }
  });
});
