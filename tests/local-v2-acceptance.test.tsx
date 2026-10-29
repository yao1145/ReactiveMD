import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, type LocalNode } from '../src/local';

function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

describe('local-draft-3 integrated behavior', () => {
  it('registers new controls rather than silently displaying their source', () => {
    const result = compileLocal('<multi-select bind="subjects" label="Subjects" max-selected="2">\n<option value="math">Math</option>\n<option value="physics">Physics</option>\n</multi-select>');
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.snapshot().state.subjects).toEqual([]);
      const node = flatten(result.document.nodes).find(node => node.name === 'multi-select')!;
      expect(runtime.set(node, ['physics', 'math'])).toEqual([]);
      expect(runtime.evaluate("contains(subjects, 'math')")).toBe(true);
      expect(runtime.snapshot().state.subjects).toEqual(['math', 'physics']);
    } finally { runtime.dispose(); }
  });

  it('rejects missing jump targets and unsafe author colors at compile time', () => {
    expect(compileLocal('<jump to="missing">Go</jump>').ok).toBe(false);
    expect(compileLocal('<text color="red;display:none">Hidden</text>').ok).toBe(false);
    const result = compileLocal('<jump to="result">Go</jump>\n\n<anchor id="result">\n\n<text color="#123">Result</text>');
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects an explicit anchor that precedes a colliding heading', () => {
    const result = compileLocal('<anchor id="result">\n\n# Result');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(item => item.code === 'local.anchor.duplicate')).toBe(true);
  });

  it('keeps inline text and jump bodies free of block Markdown', () => {
    expect(compileLocal('<text color="red">\n\n# Heading\n\n</text>').ok).toBe(false);
    expect(compileLocal('<jump to="target">\n\n- a list\n\n</jump>\n\n<anchor id="target">').ok).toBe(false);
  });

  it('keeps generated decimal interval endpoints inside their own constraints', () => {
    const result = compileLocal('<range-slider label="Decimal" min="0.1" max="0.3" step="0.1">');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    const node = flatten(result.document.nodes).find(node => node.name === 'range-slider')!;
    try {
      const end = runtime.get(node, 'end');
      expect(end).toBeLessThanOrEqual(0.3);
      expect(runtime.set(node, end, 'end')).toEqual([]);
    } finally { runtime.dispose(); }
  });
});
