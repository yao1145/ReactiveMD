import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, LOCAL_SYNTAX_VERSION, type LocalNode, type LocalValue } from '../src/index';

interface Fixture {
  name: string;
  source: string;
  ok: boolean;
  initial?: Record<string, LocalValue>;
  bindingNames?: string[];
  actions?: { bind: string; value: LocalValue; codes?: string[] }[];
  codes?: string[];
  text?: string;
  expectedText?: string;
}
const suite = JSON.parse(readFileSync(new URL('../examples/conformance/local-draft-1.json', import.meta.url), 'utf8')) as {
  syntaxVersion: string;
  cases: Fixture[];
};
function findBinding(nodes: LocalNode[], name: string): LocalNode | undefined {
  for (const node of nodes) {
    if (node.attrs?.bind === name) return node;
    const nested = findBinding(node.children ?? [], name);
    if (nested) return nested;
  }
}

describe('portable syntax conformance fixtures', () => {
  it.each(suite.cases)('$name', fixture => {
    expect(LOCAL_SYNTAX_VERSION).toBe(suite.syntaxVersion);
    const result = compileLocal(fixture.source);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(fixture.ok);
    if (!result.ok) {
      expect([...new Set(result.diagnostics.map(diagnostic => diagnostic.code))].sort()).toEqual([...fixture.codes ?? []].sort());
      return;
    }
    expect([...new Set(result.diagnostics.map(diagnostic => diagnostic.code))].sort()).toEqual([...fixture.codes ?? []].sort());
    expect(result.diagnostics.every(diagnostic => diagnostic.severity === 'warning')).toBe(true);
    if (fixture.bindingNames) expect(Object.keys(result.document.bindings).sort()).toEqual([...fixture.bindingNames].sort());
    const runtime = createLocalRuntime(result.document);
    try {
      if (fixture.initial) expect(runtime.snapshot().state).toMatchObject(fixture.initial);
      for (const action of fixture.actions ?? []) {
        const input = findBinding(result.document.nodes, action.bind);
        expect(input, `Missing binding ${action.bind}`).toBeDefined();
        const diagnostics = runtime.set(input!, action.value);
        expect(diagnostics.map(diagnostic => diagnostic.code).sort()).toEqual([...action.codes ?? []].sort());
      }
      if (fixture.text !== undefined) expect(runtime.text(fixture.text)).toBe(fixture.expectedText);
    } finally { runtime.dispose(); }
  });
});
