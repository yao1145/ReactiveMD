import { describe, expect, it } from 'vitest';
import { compileExpression, compileLocal, createLocalRuntime } from '../src/local';

describe('author-visible text lengths use the same unit', () => {
  it.each([
    ['😀', 1], ['中文', 2], ['e\u0301', 2], ['👩‍💻', 3], ['\ud800', 1],
  ])('accepts %j at its exact code-point limit %i in initial values and writes', (text, length) => {
    expect(compileExpression('len(value)').evaluate({ value: text })).toBe(length);
    const initial = compileLocal(`<input bind="value" label="Value" max-length="${length}" initial="${text}">`);
    expect(initial.ok, JSON.stringify(initial.diagnostics)).toBe(true);
    const blank = compileLocal(`<textarea bind="value" label="Value" max-length="${length}">`);
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    const runtime = createLocalRuntime(blank.document);
    try {
      const control = blank.document.nodes.find(node => node.name === 'textarea')!;
      expect(runtime.set(control, text)).toEqual([]);
      const before = runtime.snapshot();
      expect(runtime.set(control, text + 'a')).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'local.runtime.value', severity: 'error' }),
      ]));
      expect(runtime.snapshot()).toEqual(before);
    } finally { runtime.dispose(); }
  });
});
