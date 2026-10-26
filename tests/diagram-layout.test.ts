import { describe, expect, it } from 'vitest';
import {
  createDiagramLayoutFallback,
  diagramEdgePath,
  layoutDiagram,
  type DiagramLayoutInput,
  type DiagramLayoutResult,
} from '../src/local/diagram-layout';

const NODE = { width: 120, height: 46 };

function makeInput(
  direction: 'right' | 'down',
  nodeIds: string[],
  edgePairs: [string, string, string?][],
): DiagramLayoutInput {
  return {
    direction,
    nodes: nodeIds.map((id) => ({ id, ...NODE })),
    edges: edgePairs.map(([from, to, label], index) => ({
      id: `edge-${index}`,
      from,
      to,
      label,
      labelWidth: label ? 84 : undefined,
      labelHeight: label ? 36 : undefined,
    })),
  };
}

function expectInside(result: DiagramLayoutResult): void {
  const epsilon = 0.01;
  for (const node of result.nodes.values()) {
    expect(node.x - node.width / 2).toBeGreaterThanOrEqual(-epsilon);
    expect(node.y - node.height / 2).toBeGreaterThanOrEqual(-epsilon);
    expect(node.x + node.width / 2).toBeLessThanOrEqual(result.width + epsilon);
    expect(node.y + node.height / 2).toBeLessThanOrEqual(result.height + epsilon);
  }
  for (const edge of result.edges.values()) {
    expect(edge.sections.length).toBeGreaterThan(0);
    for (const section of edge.sections) {
      for (const point of [section.startPoint, ...section.bendPoints, section.endPoint]) {
        expect(point.x).toBeGreaterThanOrEqual(-epsilon);
        expect(point.y).toBeGreaterThanOrEqual(-epsilon);
        expect(point.x).toBeLessThanOrEqual(result.width + epsilon);
        expect(point.y).toBeLessThanOrEqual(result.height + epsilon);
      }
    }
    if (edge.label) {
      expect(edge.label.x).toBeGreaterThanOrEqual(-epsilon);
      expect(edge.label.y).toBeGreaterThanOrEqual(-epsilon);
      expect(edge.label.x + edge.label.width).toBeLessThanOrEqual(result.width + epsilon);
      expect(edge.label.y + edge.label.height).toBeLessThanOrEqual(result.height + epsilon);
    }
  }
}

function expectLabelsClear(result: DiagramLayoutResult): void {
  const labels = [...result.edges.values()].flatMap(edge => edge.label ? [edge.label] : []);
  const nodes = [...result.nodes.values()].map(node => ({
    x: node.x - node.width / 2, y: node.y - node.height / 2,
    width: node.width, height: node.height,
  }));
  const overlaps = (a: typeof labels[number], b: typeof labels[number]) =>
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  labels.forEach((label, index) => {
    expect(nodes.some(node => overlaps(label, node))).toBe(false);
    expect(labels.slice(index + 1).some(other => overlaps(label, other))).toBe(false);
  });
}

describe('diagram layout (ELK layered)', () => {
  it('uses continuous independent curves for parallel, reverse and return edges', async () => {
    for (const direction of ['right', 'down'] as const) {
      const result = await layoutDiagram(makeInput(direction,
        ['input', 'check', 'confirm', 'outside'], [
          ['input', 'check', 'submit'], ['input', 'check', 'unknown'],
          ['check', 'input', 'back'], ['check', 'confirm', 'pass'],
          ['confirm', 'input', 'modify'], ['outside', 'check', 'pass'],
        ]));
      expect(result.source).toBe('elk');
      const paths = [...result.edges.values()].map(edge => diagramEdgePath(edge.sections));
      expect(new Set(paths).size).toBe(6);
      for (const path of paths) {
        expect(path).toContain(' C ');
        expect(path).not.toMatch(/NaN|Infinity| Q | L /);
      }
      expectInside(result);
      expectLabelsClear(result);
    }
  });

  it('lays a three-node right cycle along consecutive layers and keeps its back edge inside', async () => {
    const input = makeInput(
      'right',
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'next'],
        ['b', 'c', 'next'],
        ['c', 'a', 'back'],
      ],
    );

    const result = await layoutDiagram(input);
    expect(result.source).toBe('elk');

    const a = result.nodes.get('a')!;
    const b = result.nodes.get('b')!;
    const c = result.nodes.get('c')!;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);

    const back = result.edges.get('edge-2')!;
    expect(back.sections.length).toBeGreaterThan(0);
    expect(back.label).toBeDefined();
    expectInside(result);
    expectLabelsClear(result);
  });

  it('fans four down branches side by side and merges them on a later layer', async () => {
    const input = makeInput(
      'down',
      ['root', 'b1', 'b2', 'b3', 'b4', 'end'],
      [
        ['root', 'b1', 'one'],
        ['root', 'b2', 'two'],
        ['root', 'b3', 'three'],
        ['root', 'b4', 'four'],
        ['b1', 'end'],
        ['b2', 'end'],
        ['b3', 'end'],
        ['b4', 'end'],
      ],
    );

    const result = await layoutDiagram(input);
    expect(result.source).toBe('elk');

    const root = result.nodes.get('root')!;
    const end = result.nodes.get('end')!;
    const branches = ['b1', 'b2', 'b3', 'b4'].map((id) => result.nodes.get(id)!);
    for (const branch of branches) {
      expect(branch.y).toBeGreaterThan(root.y);
      expect(branch.y).toBeLessThan(end.y);
    }
    const xs = branches.map((branch) => branch.x).sort((left, right) => left - right);
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index] - xs[index - 1]).toBeGreaterThanOrEqual(NODE.width);
    }
    expect(result.width).toBeGreaterThanOrEqual(NODE.width * 4);
    expectInside(result);
    expectLabelsClear(result);
  });
});

describe('diagram layout fallback', () => {
  it('places a right cycle on consecutive layers for synchronous rendering', () => {
    const result = createDiagramLayoutFallback(
      makeInput('right', ['a', 'b', 'c'], [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ]),
    );
    const a = result.nodes.get('a')!;
    const b = result.nodes.get('b')!;
    const c = result.nodes.get('c')!;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expectInside(result);
  });

  it('contains self-loops and long labels in SSR fallback and ELK in both directions', async () => {
    for (const direction of ['right', 'down'] as const) {
      const input = makeInput(
        direction,
        ['a', 'b', 'c'],
        [
          ['a', 'b', 'long label'],
          ['c', 'a', 'back'],
          ['b', 'b', 'self'],
        ],
      );
      input.edges = input.edges.map((edge) =>
        edge.labelWidth ? { ...edge, labelWidth: 120, labelHeight: 36 } : edge,
      );

      const result = createDiagramLayoutFallback(input);
      expect(result.source).toBe('fallback');
      expect(result.edges.size).toBe(3);
      expectInside(result);

      const self = result.edges.get('edge-2')!;
      expect(self.sections.length).toBeGreaterThan(0);
      expect(self.label).toBeDefined();

      const back = result.edges.get('edge-1')!;
      expect(back.sections.length).toBeGreaterThan(0);
      expect(back.label).toBeDefined();
      expectLabelsClear(result);
      const resolved = await layoutDiagram(input);
      expect(resolved.source).toBe('elk');
      expectInside(resolved);
      expectLabelsClear(resolved);
    }
  });
});

