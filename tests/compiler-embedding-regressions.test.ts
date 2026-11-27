import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local';
import { walkLocalNodes } from '../src/local/source/source-context';
import type { LocalNode } from '../src/local/types';

function nodesOfType(document: { nodes: LocalNode[] }, type: string): LocalNode[] {
  return [...walkLocalNodes(document.nodes)].filter(node => node.type === type);
}

describe('embedding profile regressions', () => {
  it('keeps parser fallback warnings non-fatal when only external slots are enabled', () => {
    const result = compileLocal('Hello\n\n<unmounted />', { embedding: { allowExternalSlots: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'local.component.unknown', severity: 'warning' }),
    ]);
    const fallback = nodesOfType(result.document, 'fallback');
    expect(fallback).toHaveLength(1);
    expect(fallback[0].fallback).toMatchObject({ code: 'local.component.unknown' });
  });

  it('still converts valid external slots when external slots are enabled', () => {
    const result = compileLocal('<external slot="notice" />\n\nAfter', { embedding: { allowExternalSlots: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(nodesOfType(result.document, 'externalSlot')).toEqual([
      expect.objectContaining({ name: 'notice' }),
    ]);
  });

  it('keeps parser fallbacks fatal for restrictive profiles that opt into external slots', () => {
    const result = compileLocal('Hello\n\n<unmounted />', {
      embedding: { allowExternalSlots: true, allowImages: false },
    });
    expect(result.ok).toBe(false);
  });

  it('prunes a rejected validation rule before the declaration budget is reported', () => {
    const numeric = '<number bind="n" label="N" initial="0" min="0" max="100">';
    const rule = '<validation when="{{ n > 0 }}" message="m" fields="n">';
    const invalidRule = '<validation when="{{ n > 0 }}" message="m" fields="missing">';
    const source = [numeric, invalidRule, ...Array.from({ length: 100 }, () => rule)].join('\n');
    const result = compileLocal(source, { embedding: { onUnsupported: 'fallback' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.map(item => item.code)).toEqual(['local.embedding.attribute']);
    expect(result.document.validations).toHaveLength(100);
  });

  it.each([
    ['<plot>Missing formula</plot>', 'local.structure.children'],
    ['<plot>\n$$x + 1$$\n</plot>', 'local.math.formula'],
    ['<table>\n\n| Name | Name |\n| --- | --- |\n| A | B |\n\n</table>', 'local.table.header'],
    ['<jump to="missing">Go</jump>', 'local.jump.target'],
  ])('degrades only the invalid node in %s', (invalid, code) => {
    const source = `${invalid}\n\n<number bind="keep" label="Keep" initial="0">`;
    expect(compileLocal(source)).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code })]) });
    const result = compileLocal(source, { embedding: { onUnsupported: 'fallback' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const range = { start: 0, end: invalid.length };
    expect(nodesOfType(result.document, 'fallback')).toMatchObject([{ value: invalid, range, fallback: { code, range } }]);
    expect(result.diagnostics).toMatchObject([{ code, severity: 'warning' }]);
    expect(Object.keys(result.document.bindings)).toEqual(['keep']);
  });

  it('drops metadata for rejected tables and rechecks components that used their binding', () => {
    const invalid = '<table key="Missing" bind="picked" label="Choices">\n\n| Name |\n| --- |\n| A |\n\n</table>';
    const dependent = '<number bind="other" label="{{ picked }}" initial="0">';
    const last = '{{ other }}';
    const result = compileLocal(`${invalid}\n\n${dependent}\n\n${last}\n\n<number bind="keep" label="Keep" initial="0">`, {
      embedding: { onUnsupported: 'fallback' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nodesOfType(result.document, 'fallback').map(node => node.value)).toEqual([invalid, dependent, last]);
    expect(Object.keys(result.document.bindings)).toEqual(['keep']);
    expect(result.document.tableShapes).toBeUndefined();
  });

  it('keeps a valid anchor when a later anchor repeats its ID', () => {
    const result = compileLocal('<anchor id="target">\n\n<anchor id="target">\n\n<jump to="target">Go</jump>', {
      embedding: { onUnsupported: 'fallback' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nodesOfType(result.document, 'component').map(node => node.name)).toEqual(['anchor', 'jump']);
    expect(nodesOfType(result.document, 'fallback')).toMatchObject([{ fallback: { code: 'local.anchor.duplicate' } }]);
  });

  it('keeps a plot curve budget failure global in fallback mode', () => {
    const formulas = Array.from({ length: 17 }, () => '$$y = x$$').join('\n\n');
    const result = compileLocal(`<plot>\n${formulas}\n</plot>`, { embedding: { onUnsupported: 'fallback' } });
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({
      code: 'local.budget.plot.curves', severity: 'error',
    })]) });
  });

  it('preserves an HTML budget error when the fragment is also disabled by the embedding profile', () => {
    const result = compileLocal('<dl><dt>A</dt><dd>B</dd><dd><button>C</button></dd></dl>', {
      enableExtendedHtml: true, limits: { maxSyntaxNodes: 4 },
      embedding: { allowInteractive: false, onUnsupported: 'fallback' },
    });
    expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({
      code: 'local.budget', messageKey: 'local.budget.nodes', severity: 'error',
    })] });
  });
});
