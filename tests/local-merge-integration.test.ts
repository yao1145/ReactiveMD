import { describe, expect, it } from 'vitest';
import { analyzeLocalSource, compileLocal, createLocalRuntime, formatLocalDiagnostic, isLocalDiagnosticCode, renameLocalBinding } from '../src/local';

const source = `<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ seats * rate }}">
<number bind="seats" label="Seats" initial="4" min="1" max="20">
<number bind="budget" label="Budget" initial="500" min="0">
<input bind="item" label="Global item" initial="A">
<number bind="index" label="Global index" initial="9">
<validation when="{{ total <= budget }}" message="Total: {{ total }}" fields="seats  budget">
<data-table label="Items" rows="{{ [item] }}" key="{{ item }}" max-rows="1">
<column label="Item" value="{{ item }}">
<column label="Position" value="{{ index + 1 }}">
<column label="Cost" value="{{ total }}">
</data-table>

Global index: {{ index }}. Total: {{ total }}.

<plot label="Cost line" min="0" max="1">
$$ y = \\mathrm{total}x $$
</plot>`;

describe('integration with author tools and diagnostic contracts', () => {
  it('tracks read-only declarations and renames values through calculations, hints, columns and formulas', () => {
    expect(compileLocal(source).diagnostics).toEqual([]);
    const names = analyzeLocalSource(source).bindings.map(binding => binding.name);
    expect(names).toEqual(expect.arrayContaining(['rate', 'total', 'seats', 'budget', 'item', 'index']));
    for (const [from, to] of [['seats', 'people'], ['rate', 'unitPrice'], ['total', 'estimate'], ['budget', 'limit']]) {
      const renamed = renameLocalBinding(source, from, to).source;
      expect(compileLocal(renamed).ok, renamed).toBe(true);
      expect(analyzeLocalSource(renamed).bindings.some(binding => binding.name === to)).toBe(true);
    }
    const renamed = renameLocalBinding(source, 'budget', 'limit').source;
    expect(renamed).toContain('fields="seats  limit"');
    expect(renameLocalBinding(source, 'total', 'estimate').source).toContain('\\mathrm{estimate}');
    expect(() => renameLocalBinding(source, 'seats', 'total')).toThrow(/already exists/);
  });

  it('keeps table row locals distinct from same-named document values', () => {
    const analysis = analyzeLocalSource(source);
    expect(analysis.bindings.find(binding => binding.name === 'item')!.references).toHaveLength(1);
    expect(analysis.bindings.find(binding => binding.name === 'index')!.references).toHaveLength(1);
    const renamed = renameLocalBinding(renameLocalBinding(source, 'item', 'subject').source, 'index', 'globalPosition').source;
    expect(renamed).toContain('rows="{{ [subject] }}" key="{{ item }}"');
    expect(renamed).toContain('value="{{ index + 1 }}"');
    expect(compileLocal(renamed).ok).toBe(true);
  });

  it('registers new calculation, collection and validation codes without changing existing ones', () => {
    for (const text of ['<computed name="total" value="{{ missing }}">', '<computed name="n" value="{{ n }}">', '<data-table label="Bad" rows="{{ 1 }}" key="{{ item }}">\n<column label="Item" value="{{ item }}">\n</data-table>']) {
      const result = compileLocal(text);
      expect(result.ok).toBe(false);
      for (const diagnostic of result.diagnostics) expect(isLocalDiagnosticCode(diagnostic.code), diagnostic.code).toBe(true);
    }
    const result = compileLocal('<number bind="people" label="People" initial="4">\n<validation when="{{ people <= 3 }}" message="Choose at most three." fields="people">');
    if (!result.ok) throw new Error('Expected valid source');
    const runtime = createLocalRuntime(result.document);
    try {
      expect(isLocalDiagnosticCode(runtime.validate()[0].code)).toBe(true);
      // A runtime-only index error still has a public translation template.
      expect(formatLocalDiagnostic({ code: 'local.expression.expression-index', message: 'Index error', severity: 'error', range: { start: 0, end: 1 }, line: 1, column: 1, messageKey: 'local.expression.error', params: { code: 'expression-index', detail: 'Index error' } }, 'zh')).toContain('安全整数');
    } finally { runtime.dispose(); }
  });
});
