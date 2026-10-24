import { describe, expect, it } from 'vitest';
import { compileExpression, compileLocal } from '../src/local';
import { createLocalRuntime } from '../src/local';
import { buildDataTableModel } from '../src/local/data-table';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { renderToStaticMarkup } from 'react-dom/server';

describe('constraint and generated-content boundaries', () => {
  it('associates rules with writable visual selections as well as input controls', () => {
    const result = compileLocal('<table bind="selected" key="ID">\n| ID | Item |\n| --- | --- |\n| a | Alpha |\n</table>\n<validation when="{{ selected != \'\' }}" message="Choose an item" fields="selected">');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.validate()).toHaveLength(1);
      const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      expect(html).toContain('aria-invalid="true"');
      expect(html).toMatch(/aria-describedby="[^"]*validation-0"/);
    } finally { runtime.dispose(); }
  });

  it('allows empty literals in either branch of a conditional string collection', () => {
    for (const source of ["flag ? ['a'] : []", "flag ? [] : ['a']"]) {
      const expression = compileExpression(source);
      expect(expression.inferType({ flag: 'boolean' })).toBe('array');
      expect(Array.isArray(expression.evaluate({ flag: true }))).toBe(true);
      expect(Array.isArray(expression.evaluate({ flag: false }))).toBe(true);
    }
  });

  it('renders all valid static integer spellings for row limits', () => {
    for (const max of ['2.0', '2e0', '+2']) {
      const result = compileLocal(`<data-table label="Integer spelling" rows="{{ ['a'] }}" key="{{ item }}" max-rows="${max}">\n<column label="Value" value="{{ item }}">\n</data-table>`);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const runtime = createLocalRuntime(result.document);
      try {
        const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
        expect(html).toContain('<table');
        expect(html).not.toContain('local-data-table-error');
      } finally { runtime.dispose(); }
    }
  });

  it('rejects internal anonymous binding keys as public validation fields', () => {
    const source = '<number label="Anonymous">';
    const initial = compileLocal(source);
    if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
    const internal = Object.keys(initial.document.bindings)[0];
    expect(internal.startsWith('@')).toBe(true);
    const result = compileLocal(`${source}\n<validation when="{{ false }}" fields="${internal}" message="Invalid">`);
    expect(result.ok).toBe(false);
  });

  it('bounds generated row identities even when cells contain no output', () => {
    const result = buildDataTableModel({
      rows: Array.from({ length: 50 }, (_, index) => `a${index}`),
      columns: [{ label: 'Empty', value: "''" }],
      keyExpression: `replace(item, 'a', '${'x'.repeat(3000)}')`,
      runtime: { evaluate: () => null },
      maxRows: 50,
    });
    expect(result.ok).toBe(false);
  });

  it('counts cell error placeholders toward the generated-content budget', () => {
    expect(buildDataTableModel({
      rows: ['a'],
      columns: [{ label: 'Value', value: '1 / 0' }],
      keyExpression: 'item',
      runtime: { evaluate: () => null },
      budget: 10,
    })).toMatchObject({ ok: false, failure: 'text-budget' });
  });
});
