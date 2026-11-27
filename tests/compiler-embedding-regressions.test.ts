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
});