import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/local';
import { LocalDocumentView } from '../src/react';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/sdk-phase2-baseline.json', import.meta.url), 'utf8'));
function markupDigest(markup: string): string {
  const identifiers = new Map<string, string>();
  const normalized = markup.replace(/_R_[A-Za-z0-9_]+_/g, id => {
    if (!identifiers.has(id)) identifiers.set(id, `_ID_${identifiers.size}_`);
    return identifiers.get(id)!;
  });
  return createHash('sha256').update(normalized).digest('hex');
}

describe('phase-two migration against d227fc0', () => {
  it.each(baseline.cases as unknown[])('$suite: $id', (input) => {
    const fixture = input as any;
    const compiled = compileLocal(fixture.source);
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(fixture.ok);
    expect(compiled.diagnostics.map(({ code, severity, range }) => ({ code, severity, range }))).toEqual(fixture.diagnostics);
    if (!compiled.ok) return;
    const runtime = createLocalRuntime(compiled.document);
    try {
      expect(runtime.getParameters()).toEqual(fixture.initial);
      const shape = Object.fromEntries(Object.entries(compiled.document.bindings).filter(([name]) => !name.startsWith('@')).map(([name, binding]) => [name, {
        type: binding.type, initial: binding.initial, min: binding.min, max: binding.max,
        step: binding.step, options: binding.options, maxItems: binding.maxItems,
      }]));
      expect(JSON.parse(JSON.stringify(shape))).toEqual(fixture.bindingShape);
      const markup = renderToStaticMarkup(createElement(LocalDocumentView, { document: compiled.document, runtime, mode: 'static' }));
      const digest = markupDigest(markup);
      expect([fixture.markupDigest, ...(fixture.markupDigestAlternates ?? [])], `Static output changed for ${fixture.id}`).toContain(digest);
      for (const action of fixture.actions ?? []) {
        expect(runtime.setParameter(action.bind, action.value).map(item => item.code)).toEqual(action.codes);
        expect(runtime.getParameters()).toEqual(action.state);
      }
      if (fixture.text !== undefined) {
        const original = fixture.textTemplate;
        expect(runtime.text(original)).toBe(fixture.text);
      }
    } finally { runtime.dispose(); }
  });
});
