import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, migrateLocalSource, type LocalNode, type LocalValue } from '../src/local';
import { LocalDocumentView } from '../src/local/LocalDocumentView';

const root = new URL('../examples/conformance/history/v0.3.1/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
const provenance = JSON.parse(read('provenance.json')) as {
  tag: string; commit: string; files: { file: string; sourcePath: string; sha256: string }[];
};
const suite = JSON.parse(read('local-draft-1.json')) as {
  cases: { name: string; source: string; ok: boolean; initial?: Record<string, LocalValue>; bindingNames?: string[];
    actions?: { bind: string; value: LocalValue; codes?: string[] }[]; codes?: string[]; text?: string; expectedText?: string }[];
};
const flat = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flat(node.children ?? [])]);

describe('immutable v0.3.1 historical compatibility corpus', () => {
  it('pins actual tagged sources and their digests', () => {
    expect(provenance.tag).toBe('v0.3.1');
    expect(provenance.commit).toBe('bdfc98bd914058df5093a1c02123ad11a9ebe207');
    for (const file of provenance.files) {
      expect(createHash('sha256').update(readFileSync(new URL(file.file, root))).digest('hex'), file.sourcePath).toBe(file.sha256);
    }
  });

  it.each(suite.cases)('preserves historical core expectation: $name', fixture => {
    const upgrade = migrateLocalSource(fixture.source, { fromVersion: 'local-draft-1' });
    expect(upgrade.ok).toBe(fixture.ok);
    if (!upgrade.ok) {
      expect(upgrade.source).toBe(fixture.source);
      expect(upgrade.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining(fixture.codes ?? []));
      return;
    }
    const result = compileLocal(upgrade.source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect([...new Set(result.diagnostics.map(item => item.code))].sort()).toEqual([...(fixture.codes ?? [])].sort());
    const runtime = createLocalRuntime(result.document);
    try {
      if (fixture.initial) expect(runtime.getParameters()).toMatchObject(fixture.initial);
      if (fixture.bindingNames) expect(runtime.parameterNames()).toEqual(fixture.bindingNames);
      for (const action of fixture.actions ?? []) {
        const before = runtime.snapshot();
        expect(runtime.setParameter(action.bind, action.value).map(item => item.code)).toEqual(action.codes ?? []);
        if (action.codes?.length) expect(runtime.snapshot()).toBe(before);
      }
      if (fixture.text !== undefined) expect(runtime.text(fixture.text)).toBe(fixture.expectedText);
    } finally { runtime.dispose(); }
  });

  it.each(provenance.files.filter(file => file.file.endsWith('.reactive.md')))('preserves tagged document $file', ({ file }) => {
    const source = read(file);
    const migration = migrateLocalSource(source, { fromVersion: 'local-draft-1', allowSemanticChanges: true });
    if (file === 'diagnostics.reactive.md') {
      expect(migration.ok).toBe(false);
      expect(migration.changed).toBe(false);
      return;
    }
    expect(migration.ok, JSON.stringify(migration.diagnostics)).toBe(true);
    const original = compileLocal(source);
    const migrated = compileLocal(migration.source);
    if (!original.ok || !migrated.ok) throw new Error(JSON.stringify([original.diagnostics, migrated.diagnostics]));
    const render = (document: typeof original.document) => {
      const runtime = createLocalRuntime(document);
      try {
        const initial = runtime.getParameters();
        const html = renderToStaticMarkup(createElement(LocalDocumentView, { document, runtime }));
        for (const node of flat(document.nodes).filter(node => node.name === 'panel')) runtime.reset(node);
        expect(runtime.getParameters()).toEqual(initial);
        return html.replace(/\s(?:id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '');
      } finally { runtime.dispose(); }
    };
    const initialValues = (state: Record<string, LocalValue>) => ({
      public: Object.fromEntries(Object.entries(state).filter(([name]) => !name.startsWith('@'))),
      anonymous: Object.entries(state).filter(([name]) => name.startsWith('@')).map(([, value]) => value),
    });
    expect(initialValues(migrated.document.initialState)).toEqual(initialValues(original.document.initialState));
    expect(render(migrated.document)).toBe(render(original.document));
  });
});
