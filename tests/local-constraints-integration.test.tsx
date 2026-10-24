import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileExpression, compileLocal, createLocalRuntime, type LocalNode } from '../src/local';
import { LocalDocumentView } from '../src/local/LocalDocumentView';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);

describe('constraints and collections integrated authoring', () => {
  it('supports numeric arrays, indexing and aggregates through the public expression API', () => {
    expect(compileExpression('[10, 20, 30][1]').evaluate({})).toBe(20);
    expect(compileExpression('average([10, 20, 30])').evaluate({})).toBe(20);
    expect(compileExpression('sum([])').evaluate({})).toBe(0);
    expect(compileExpression('maxOf([])').evaluate({})).toBeNull();
  });

  for (const file of ['workshop.reactive.md', 'workshop-zh.reactive.md']) {
    it(`keeps the plan editable and links calculations, hints, tones and generated rows: ${file}`, () => {
      const source = readFileSync(new URL(`../examples/local/recipes/${file}`, import.meta.url), 'utf8');
      const result = compileLocal(source);
      expect(result.diagnostics).toEqual([]);
      if (!result.ok) throw new Error('Expected compilation success');
      const document = structuredClone(result.document);
      const runtime = createLocalRuntime(document);
      const nodes = flatten(document.nodes);
      const field = (bind: string) => nodes.find(n => n.attrs?.bind === bind)!;
      const html = () => renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime} />);
      try {
        expect(runtime.evaluate('total')).toBe(320);
        expect(runtime.evaluate('costs')).toEqual([320, 0]);
        expect(runtime.validate()).toEqual([]);
        expect(runtime.set(field('budget'), 100)).toEqual([]);
        expect(runtime.evaluate('budget')).toBe(100);
        expect(runtime.validate()).toHaveLength(1);
        expect(html()).toContain('md-badge-warning');
        expect(html()).not.toContain('{{ formatCurrency');
        expect(runtime.set(field('subjects'), ['chemistry', 'physics'])).toEqual([]);
        expect(html()).toContain('chemistry');
        expect(html()).toContain('physics');
        expect(html()).toContain('aria-invalid="true"');
        expect(runtime.set(field('endDate'), '2026-10-20')).toEqual([]);
        expect(runtime.validate()).toHaveLength(2);
        runtime.reset(nodes.find(n => n.name === 'panel')!);
        expect(runtime.validate()).toEqual([]);
        expect(runtime.evaluate('subjects')).toEqual([]);
        expect(html()).toContain('md-badge-success');
      } finally { runtime.dispose(); }
    });
  }

  it('isolates an errored constraint while retaining independent failures and recoverability', () => {
    const result = compileLocal('<number bind="denominator" label="Denominator" initial="0">\n<number bind="budget" label="Budget" initial="0">\n<validation when="{{ 1 / denominator > 0 }}" message="Choose a positive denominator" fields="denominator">\n<validation when="{{ budget > 0 }}" message="Choose a positive budget" fields="budget">');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.validate()).toHaveLength(2);
      expect(runtime.validate().some(d => d.code === 'local.validation.expression')).toBe(true);
      expect(runtime.set(flatten(result.document.nodes).find(n => n.attrs?.bind === 'denominator')!, 2)).toEqual([]);
      expect(runtime.validate()).toHaveLength(1);
      expect(runtime.validate()[0].message).toBe('Choose a positive budget');
    } finally { runtime.dispose(); }
  });
});
