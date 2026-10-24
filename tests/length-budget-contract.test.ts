import { describe, expect, it } from 'vitest';
import {
  compileExpression,
  compileLocal,
  countLocalCodePoints,
  createLocalRuntime,
} from '../src/local';
import { localValueBudgetError } from '../src/local/expression';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_STRING_LENGTH,
} from '../src/local/limits';

const AUTHOR_TEXT_CASES: [string, number][] = [
  ['😀', 1],
  ['中文', 2],
  ['é', 2],
  ['👩‍💻', 3],
  ['\ud800', 1],
];

function textareaRuntime(maxLength: number) {
  const result = compileLocal(`<textarea bind="value" label="Value" max-length="${maxLength}">`);
  if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
  const runtime = createLocalRuntime(result.document);
  const control = result.document.nodes.find(node => node.name === 'textarea')!;
  return { runtime, control };
}

describe('author-visible length counts Unicode code points', () => {
  it.each(AUTHOR_TEXT_CASES)('counts %j as %i code points', (text, length) => {
    expect(countLocalCodePoints(text)).toBe(length);
    expect(compileExpression('len(value)').evaluate({ value: text })).toBe(length);
  });

  it.each(AUTHOR_TEXT_CASES)('accepts %j at the exact code-point limit', (text, length) => {
    const result = compileLocal(`<input bind="value" label="Value" max-length="${length}" initial="${text}">`);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);

    const { runtime, control } = textareaRuntime(length);
    try {
      expect(runtime.set(control, text)).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it.each(AUTHOR_TEXT_CASES)('rejects one extra code point for %j', (text, length) => {
    const initial = compileLocal(`<input bind="value" label="Value" max-length="${length}" initial="${text}a">`);
    expect(initial.ok).toBe(false);
    expect(initial.diagnostics.map(item => item.code)).toContain('local.initial.length');

    const { runtime, control } = textareaRuntime(length);
    const before = runtime.snapshot();
    try {
      const diagnostics = runtime.set(control, `${text}a`);
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'local.runtime.value', severity: 'error' }),
      ]));
      expect(runtime.snapshot()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
});

describe('resource budgets stay UTF-16 code units', () => {
  it('keeps the string budget boundary inclusive', () => {
    const exact = '😀'.repeat(MAX_LOCAL_STRING_LENGTH / 2);
    expect(exact.length).toBe(MAX_LOCAL_STRING_LENGTH);
    expect(countLocalCodePoints(exact)).toBe(MAX_LOCAL_STRING_LENGTH / 2);
    expect(localValueBudgetError('a'.repeat(MAX_LOCAL_STRING_LENGTH - 1))).toBeNull();
    expect(localValueBudgetError('a'.repeat(MAX_LOCAL_STRING_LENGTH))).toBeNull();
    expect(localValueBudgetError('a'.repeat(MAX_LOCAL_STRING_LENGTH + 1))).toContain(String(MAX_LOCAL_STRING_LENGTH));
  });

  it('counts array members by UTF-16 length and items by elements', () => {
    expect(localValueBudgetError(Array.from({ length: MAX_LOCAL_ARRAY_LENGTH }, () => 'a'))).toBeNull();
    expect(localValueBudgetError(Array.from({ length: MAX_LOCAL_ARRAY_LENGTH + 1 }, () => 'a'))).not.toBeNull();
    expect(localValueBudgetError(['a'.repeat(MAX_LOCAL_STRING_LENGTH - 1)])).toBeNull();
    expect(localValueBudgetError(['a'.repeat(MAX_LOCAL_STRING_LENGTH + 1)])).not.toBeNull();
  });
});

describe('diagnostic positions stay UTF-16 while visible lengths use code points', () => {
  it('keeps CRLF as two source code units and columns UTF-16 based', () => {
    const source = 'line\r\n{{ missing }}';
    const diagnostic = compileLocal(source).diagnostics.find(item => item.code === 'local.binding.unknown');
    expect(diagnostic).toBeDefined();
    expect(diagnostic).toMatchObject({ line: 2, column: 4, range: { start: 9 } });
    expect(source.startsWith('missing', diagnostic!.range.start)).toBe(true);
  });

  it('counts surrogate pairs as two columns but one code point', () => {
    const source = '😀 {{ missing }}';
    const diagnostic = compileLocal(source).diagnostics.find(item => item.code === 'local.binding.unknown');
    expect(diagnostic).toMatchObject({ line: 1, column: 7, range: { start: 6 } });
    expect(countLocalCodePoints('😀')).toBe(1);
  });
});

describe('diagnostic budget retains a real error behind warnings', () => {
  it('replaces a disposable warning when the limit is full', () => {
    const source = `${'<slidr />\n'.repeat(MAX_LOCAL_DIAGNOSTICS)}{{ count + }}`;
    const diagnostics = compileLocal(source).diagnostics;
    expect(diagnostics.length).toBeLessThanOrEqual(MAX_LOCAL_DIAGNOSTICS);
    expect(diagnostics.some(item => item.severity === 'error' && item.code.startsWith('local.expression.'))).toBe(true);
  });
});
