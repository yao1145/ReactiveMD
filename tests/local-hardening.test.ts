import { expect, it } from 'vitest';
import { parseLocal } from '../src/local/parser';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

it('does not interpret literal private-use text as a second syntax token', () => {
  const source = '\uE0000\uE001\n\n<counter label="人数">';
  const result = parseLocal(source);
  expect(result.diagnostics).toEqual([]);
  expect(flatten(result.nodes).filter(node => node.type === 'component')).toHaveLength(1);
  expect(flatten(result.nodes).filter(node => node.type === 'text').map(node => node.value).join('')).toContain('\uE0000\uE001');
});

it('keeps root-level indented Markdown code inert', () => {
  const result = parseLocal('    <slider bind="sample" label="示例">\n    {{ sample }}');
  expect(result.diagnostics).toEqual([]);
  const nodes = flatten(result.nodes);
  expect(nodes.some(node => node.type === 'component' || node.type === 'interpolation')).toBe(false);
  expect(nodes.some(node => node.type === 'code')).toBe(true);
});
