import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import type { LocalDocument, LocalNode, LocalValue } from '../src/local/types';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function find(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = all(document.nodes).filter((node) => node.name === name);
  if (!matches[index]) throw new Error(`Missing <${name}> at index ${index}`);
  return matches[index];
}

describe('local runtime parameters', () => {
  it('lists sorted public parameter names and excludes anonymous bindings', () => {
    const document = compile([
      '<number label="Zeta" bind="zeta" initial="4" min="0" max="10">',
      '<counter label="Anonymous" initial="3">',
      '<number label="Alpha" bind="alpha" initial="1" min="0" max="10">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.parameterNames()).toEqual(['alpha', 'zeta']);
      expect(runtime.parameterNames().every((name) => !name.startsWith('@'))).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('reads parameters by name and detaches arrays from runtime state', () => {
    const document = compile([
      '<checklist bind="done" label="Done">',
      '- [x] First',
      '- [ ] Second',
      '</checklist>',
      '<number label="Amount" bind="amount" initial="2" min="0" max="10">',
      '<counter label="Anonymous" initial="3">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.getParameter('done')).toEqual(['item-1']);
      const detached = runtime.getParameter('done') as string[];
      detached.push('item-2');
      expect(runtime.getParameter('done')).toEqual(['item-1']);

      const internal = Object.keys(document.bindings).find((key) => key.startsWith('@'));
      expect(internal).toBeDefined();
      expect(runtime.getParameter(internal as string)).toBeUndefined();
      expect(runtime.getParameter('missing')).toBeUndefined();

      const parameters = runtime.getParameters();
      expect(Object.isFrozen(parameters)).toBe(true);
      expect(Object.keys(parameters)).toEqual(['amount', 'done']);
      expect(Object.keys(parameters).every((key) => !key.startsWith('@'))).toBe(true);
      expect(Object.isFrozen(parameters.done)).toBe(true);
      expect(parameters).toEqual({ amount: 2, done: ['item-1'] });
    } finally {
      runtime.dispose();
    }
  });

  it('validates bounds and shared string controls without changing the snapshot', () => {
    const document = compile([
      '<number label="Amount" bind="amount" initial="2" min="0" max="20">',
      '<input label="Name" bind="name" initial="Ann">',
      '<textarea label="Name again" bind="name" max-length="4">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      let calls = 0;
      runtime.subscribe(() => {
        calls += 1;
      });
      const before = runtime.snapshot();

      const bounds = runtime.setParameter('amount', 21);
      expect(bounds[0]?.code).toBe('local.runtime.value');
      expect(bounds[0]?.message).toContain('amount');

      const shared = runtime.setParameter('name', 'Long name');
      expect(shared[0]?.code).toBe('local.runtime.value');
      expect(shared[0]?.message).toBe('At most 4 characters.');

      expect(runtime.snapshot()).toBe(before);
      expect(runtime.getParameter('amount')).toBe(2);
      expect(runtime.getParameter('name')).toBe('Ann');
      expect(calls).toBe(0);
    } finally {
      runtime.dispose();
    }
  });

  it('writes multiple bindings atomically and notifies once', () => {
    const document = compile([
      '<number label="Amount" bind="amount" initial="2" min="0" max="20">',
      '<toggle label="Enabled" bind="enabled">',
      '<input label="Name" bind="name" initial="Ann">',
      '<textarea label="Name again" bind="name" max-length="4">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      let calls = 0;
      runtime.subscribe(() => {
        calls += 1;
      });
      const before = runtime.snapshot();

      const rejected = runtime.setParameters({ amount: 8, name: 'Too long', enabled: true });
      expect(rejected.map((entry) => entry.code)).toEqual(['local.runtime.value']);
      expect(runtime.snapshot()).toBe(before);
      expect(calls).toBe(0);
      expect(runtime.getParameter('amount')).toBe(2);
      expect(runtime.getParameter('enabled')).toBe(false);

      expect(runtime.setParameters({ amount: 8, enabled: true })).toEqual([]);
      expect(calls).toBe(1);
      expect(runtime.snapshot().revision).toBe(before.revision + 1);
      expect(runtime.getParameter('amount')).toBe(8);
      expect(runtime.getParameter('enabled')).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('updates public range-slider slots together and rejects reversed pairs atomically', () => {
    const document = compile(
      '<range-slider label="Range" bind-start="lo" bind-end="hi" initial-start="20" initial-end="60" min="0" max="100" step="1">',
    );
    const node = find(document, 'range-slider');
    const runtime = createLocalRuntime(document);
    try {
      let calls = 0;
      runtime.subscribe(() => {
        calls += 1;
      });
      expect(runtime.setParameters({ lo: 30, hi: 70 })).toEqual([]);
      expect(calls).toBe(1);
      expect(runtime.get(node, 'start')).toBe(30);
      expect(runtime.get(node, 'end')).toBe(70);

      const revision = runtime.snapshot().revision;
      const rejected = runtime.setParameters({ lo: 80, hi: 40 });
      expect(rejected[0]?.code).toBe('local.runtime.value');
      expect(runtime.snapshot().revision).toBe(revision);
      expect(runtime.get(node, 'start')).toBe(30);
      expect(runtime.get(node, 'end')).toBe(70);
    } finally {
      runtime.dispose();
    }
  });

  it('checks a public slot against an unchanged anonymous counterpart', () => {
    const document = compile(
      '<range-slider label="Range" bind-start="lo" initial-start="20" initial-end="60" min="0" max="100">',
    );
    const node = find(document, 'range-slider');
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.setParameters({ lo: 40 })).toEqual([]);
      expect(runtime.get(node, 'start')).toBe(40);
      expect(runtime.get(node, 'end')).toBe(60);

      const revision = runtime.snapshot().revision;
      const rejected = runtime.setParameters({ lo: 70 });
      expect(rejected[0]?.code).toBe('local.runtime.value');
      expect(runtime.snapshot().revision).toBe(revision);
      expect(runtime.get(node, 'start')).toBe(40);
      expect(runtime.get(node, 'end')).toBe(60);
      expect(runtime.getParameters()).toEqual({ lo: 40 });
    } finally {
      runtime.dispose();
    }
  });

  it('treats empty writes as a no-op and rejects invalid containers', () => {
    const document = compile('<number label="Amount" bind="amount" initial="2" min="0" max="10">');
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.setParameters({})).toEqual([]);
      expect(runtime.snapshot().revision).toBe(0);

      expect(() => runtime.setParameters(null as unknown as Record<string, LocalValue>)).toThrow(TypeError);
      expect(() => runtime.setParameters([] as unknown as Record<string, LocalValue>)).toThrow(TypeError);
      expect(() => runtime.setParameters('amount' as unknown as Record<string, LocalValue>)).toThrow(TypeError);
      expect(runtime.setParameters(Object.create(null) as Record<string, LocalValue>)).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('reports internal, unknown and prototype names as parameter diagnostics', () => {
    const document = compile([
      '<number label="Amount" bind="amount" initial="2" min="0" max="10">',
      '<counter label="Anonymous" initial="3">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const internal = Object.keys(document.bindings).find((key) => key.startsWith('@')) as string;
      const internalDiagnostic = runtime.setParameters({ [internal]: 5 })[0];
      expect(internalDiagnostic?.code).toBe('local.runtime.parameter');
      expect(internalDiagnostic?.message).toContain(internal);
      expect(internalDiagnostic?.range).toEqual({ start: 0, end: 0 });
      expect(internalDiagnostic?.line).toBe(1);
      expect(internalDiagnostic?.column).toBe(1);

      const unknownDiagnostic = runtime.setParameter('missing', 1)[0];
      expect(unknownDiagnostic?.code).toBe('local.runtime.parameter');
      expect(unknownDiagnostic?.message).toContain('missing');

      const candidate = JSON.parse('{"amount": 4, "__proto__": {"polluted": true}}') as Record<string, LocalValue>;
      const prototypeDiagnostics = runtime.setParameters(candidate);
      expect(prototypeDiagnostics.some((entry) => (
        entry.code === 'local.runtime.parameter' && entry.message.includes('__proto__')
      ))).toBe(true);
      expect(runtime.getParameter('amount')).toBe(2);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });

  it('throws from every parameter method after disposal', () => {
    const document = compile('<number label="Amount" bind="amount" initial="2" min="0" max="10">');
    const runtime = createLocalRuntime(document);
    runtime.dispose();
    expect(() => runtime.parameterNames()).toThrow();
    expect(() => runtime.getParameter('amount')).toThrow();
    expect(() => runtime.getParameters()).toThrow();
    expect(() => runtime.setParameter('amount', 3)).toThrow();
    expect(() => runtime.setParameters({ amount: 3 })).toThrow();
  });
});
