import { describe, expect, it } from 'vitest';
import { compileLocal, type LocalNode } from 'reactive-md';
import { EXAMPLES, localizedExample, resolveExampleId } from '../src/examples';

const names = 'input textarea number slider toggle checkbox date select choices radio-group option counter timer checklist progress panel card grid tabs tab accordion disclosure if alert badge tooltip table chart plot timeline diagram node edge jump anchor text section multi-select range-slider coordinate quiz steps step validation data-table column'.split(' ');
function componentNames(nodes: LocalNode[]): string[] {
  return nodes.flatMap(node => [ ...(node.type === 'component' && node.name ? [node.name] : []), ...componentNames(node.children ?? []) ]);
}

describe('components distributed across six scenarios', () => {
  it('keeps six feature scenarios without separate gallery or new-component pages', () => {
    expect(EXAMPLES.filter(example => example.section === 'feature').map(example => example.id))
      .toEqual(['functions', 'forms', 'statistics', 'layout', 'flow', 'tasks']);
    expect(EXAMPLES.some(example => ['explore','gallery'].includes(example.id))).toBe(false);
  });

  it('routes retired tour bookmarks to the integrated scenarios', () => {
    expect(resolveExampleId('explore')).toBe('functions');
    expect(resolveExampleId('gallery')).toBe('forms');
    expect(resolveExampleId('statistics')).toBe('statistics');
    expect(resolveExampleId('missing')).toBeUndefined();
  });

  for (const language of ['en','zh'] as const) {
    it(`${language}: all ${names.length} component names occur as working components in the six scenarios`, () => {
      const found = new Set<string>();
      for (const example of EXAMPLES.filter(example => example.section === 'feature')) {
        const result = compileLocal(localizedExample(example, language).source);
        expect(result.ok, example.id + JSON.stringify(result.diagnostics)).toBe(true);
        expect(result.diagnostics, example.id).toEqual([]);
        if (result.ok) expect(Object.keys(result.document.computations ?? {}).length, example.id).toBeGreaterThan(0);
        if (result.ok) componentNames(result.document.nodes).forEach(name => found.add(name));
      }
      expect([...found].sort()).toEqual([...names].sort());
    });
  }
});
