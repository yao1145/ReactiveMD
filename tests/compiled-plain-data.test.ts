import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/local';
import { compileLocalDocument } from '../src/local/compiler';
import { plainCompiledData } from '../src/local/compiled-data';

function expectPlainData(value: unknown, path = 'result', seen = new Set<object>()): void {
  expect(typeof value, path).not.toBe('function');
  expect(typeof value, path).not.toBe('symbol');
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.getPrototypeOf(value), path).toBe(Array.isArray(value) ? Array.prototype : Object.prototype);
  for (const [key, child] of Object.entries(value)) expectPlainData(child, `${path}.${key}`, seen);
}

const source = `<slider bind="n" label="Number" initial="2" min="0" max="10">
<coordinate bind-x="px" bind-y="py" label="Point" initial-x="1" initial-y="2">
<const name="offset" value="{{ 1 }}">
<computed name="total" value="{{ n + offset }}">

<div data-note="test">Total: {{ total }}</div>

<table label="Values">
| Name | Value |
| --- | --- |
| First | {{ n }} |
</table>`;

describe('public compiled data for React Server Components', () => {
  it.each([compileLocal, compileLocalDocument])('returns only ordinary records and arrays at every depth', compile => {
    const result = compile(source);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expectPlainData(result);
    if (!result.ok) return;
    expect(Object.isFrozen(result.document.dependencies)).toBe(true);
    for (const value of Object.values(result.document.dependencies!)) if (value) expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(result.document.tableShapes)).toBe(true);
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.evaluate('total')).toBe(3);
      runtime.setParameter('n', 4);
      expect(runtime.evaluate('total')).toBe(5);
    } finally { runtime.dispose(); }
    expectPlainData(result);
    const restored = JSON.parse(JSON.stringify(result.document));
    const restoredRuntime = createLocalRuntime(restored);
    try { expect(restoredRuntime.evaluate('total')).toBe(3); } finally { restoredRuntime.dispose(); }
  });

  it('normalizes native HTML and failed results as well', () => {
    expectPlainData(compileLocal('<p>Native</p>', {enableCss: true}));
    const failed = compileLocal('<slider bind="__proto__" label="Bad">');
    expect(failed.ok).toBe(false);
    expectPlainData(failed);
    expectPlainData(compileLocal('{{ missing }}'));
    expectPlainData(compileLocal('text', {markdownBreaks: 'bad'} as any));
  });

  it('keeps hostile keys as data without mutating Object.prototype', () => {
    const before = Object.getOwnPropertyNames(Object.prototype);
    expectPlainData(compileLocal('<span data-__proto__="x" data-constructor="y">Text</span>'));
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(before);
  });

  it('preserves own special keys, undefined and shared frozen data without JSON coercion', () => {
    const record = Object.create(null);
    record.__proto__ = {sourceValue: true};
    record.constructor = 'source';
    record.optional = undefined;
    const output = plainCompiledData({first: record, second: record, frozen: Object.freeze([record])});
    expectPlainData(output);
    expect(Object.hasOwn(output.first, '__proto__')).toBe(true);
    expect(output.first.__proto__).toEqual({sourceValue: true});
    expect(output.first.constructor).toBe('source');
    expect(Object.hasOwn(output.first, 'optional')).toBe(true);
    expect(output.first.optional).toBeUndefined();
    expect(output.first).toBe(output.second);
    expect(output.first).toBe(output.frozen[0]);
    expect(Object.isFrozen(output.frozen)).toBe(true);
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(({} as any).sourceValue).toBeUndefined();
  });
});
