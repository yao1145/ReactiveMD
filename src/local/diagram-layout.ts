import ELK, { type ELK as ElkApi, type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';

/* Layered diagram geometry.

   ELK is asynchronous, while visuals are rendered synchronously on the server
   and on first client paint. A deterministic synchronous layout therefore
   provides the initial geometry; once mounted, the component swaps in the ELK
   result. Both results share this module's shape so rendering, bounds and
   label placement stay identical. */

export type DiagramDirection = 'right' | 'down';

export interface DiagramLayoutNodeInput {
  id: string;
  width: number;
  height: number;
}

export interface DiagramLayoutEdgeInput {
  id: string;
  from: string;
  to: string;
  label?: string;
  labelWidth?: number;
  labelHeight?: number;
}

export interface DiagramLayoutInput {
  direction: DiagramDirection;
  nodes: DiagramLayoutNodeInput[];
  edges: DiagramLayoutEdgeInput[];
}

export interface DiagramPoint {
  x: number;
  y: number;
}

export interface DiagramEdgeSection {
  startPoint: DiagramPoint;
  endPoint: DiagramPoint;
  bendPoints: DiagramPoint[];
}

export interface DiagramLabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdgeLayout {
  sections: DiagramEdgeSection[];
  label?: DiagramLabelRect;
}

export interface DiagramNodeLayout {
  /** Node centre, matching the SVG translate used for node cards. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramLayoutResult {
  width: number;
  height: number;
  nodes: Map<string, DiagramNodeLayout>;
  edges: Map<string, DiagramEdgeLayout>;
  source: 'elk' | 'fallback';
}

const LAYOUT_MARGIN = 22;
const NODE_GAP = 40;
const LAYER_GAP = 72;
const LOOP_OFFSET = 28;
const BACK_ROUTE_OFFSET = 26;
const LAYOUT_CACHE_LIMIT = 24;

/* ------------------------------------------------------------------ */
/* Stable input key and async cache                                    */
/* ------------------------------------------------------------------ */

/** Every value that can change geometry; selection, tone and body do not. */
export function diagramLayoutKey(input: DiagramLayoutInput): string {
  return JSON.stringify([
    input.direction,
    input.nodes.map((node) => [node.id, node.width, node.height]),
    input.edges.map((edge) => [
      edge.id,
      edge.from,
      edge.to,
      edge.labelWidth ?? 0,
      edge.labelHeight ?? 0,
    ]),
  ]);
}

let elkInstance: ElkApi | null | undefined;

type ElkConstructor = new () => ElkApi;

/**
 * Bundlers resolve the UMD default export directly, while Node's CJS interop
 * can hand back the module namespace. Support both so the same build works in
 * browsers, SSR and tests.
 */
function createElk(): ElkApi {
  const imported = ELK as unknown as ElkConstructor & { default?: ElkConstructor };
  return new (imported.default ?? imported)();
}

function getElk(): ElkApi | null {
  if (elkInstance !== undefined) return elkInstance;
  try {
    elkInstance = createElk();
  } catch {
    elkInstance = null;
  }
  return elkInstance;
}

const layoutCache = new Map<string, Promise<DiagramLayoutResult>>();

/**
 * Resolves the layered layout. Failures (including an unsupported runtime)
 * degrade to the synchronous fallback instead of breaking the diagram.
 */
export function layoutDiagram(input: DiagramLayoutInput): Promise<DiagramLayoutResult> {
  const key = diagramLayoutKey(input);
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const pending = runElk(input).catch(() => createDiagramLayoutFallback(input));
  layoutCache.set(key, pending);
  if (layoutCache.size > LAYOUT_CACHE_LIMIT) {
    const oldest = layoutCache.keys().next().value;
    if (oldest !== undefined) layoutCache.delete(oldest);
  }
  return pending;
}

async function runElk(input: DiagramLayoutInput): Promise<DiagramLayoutResult> {
  const elk = getElk();
  if (!elk) return createDiagramLayoutFallback(input);

  const elkNodeIds = new Map<string, string>();
  const nodeIds = new Map<string, string>();
  input.nodes.forEach((node, index) => {
    const id = `n${index}`;
    elkNodeIds.set(node.id, id);
    nodeIds.set(id, node.id);
  });

  const elkEdgeIds = new Map<string, string>();
  const edgeIds = new Map<string, string>();
  input.edges.forEach((edge, index) => {
    if (!elkNodeIds.has(edge.from) || !elkNodeIds.has(edge.to)) return;
    const id = `e${index}`;
    elkEdgeIds.set(edge.id, id);
    edgeIds.set(id, edge.id);
  });

  const children = input.nodes.map((node) => ({
    id: elkNodeIds.get(node.id)!,
    width: Math.max(1, node.width),
    height: Math.max(1, node.height),
  }));

  const edges: ElkExtendedEdge[] = [];
  for (const edge of input.edges) {
    const id = elkEdgeIds.get(edge.id);
    const source = elkNodeIds.get(edge.from);
    const target = elkNodeIds.get(edge.to);
    if (!id || !source || !target) continue;
    const elkEdge: ElkExtendedEdge = { id, sources: [source], targets: [target] };
    if (edge.labelWidth && edge.labelHeight) {
      // ELK skips empty text labels even when explicit dimensions are supplied.
      elkEdge.labels = [{ text: edge.label || 'label', width: edge.labelWidth, height: edge.labelHeight }];
    }
    edges.push(elkEdge);
  }

  const graph: ElkNode = {
    id: 'diagram',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': input.direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.spacing.nodeNode': String(NODE_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_GAP),
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '14',
      'elk.spacing.edgeLabel': '8',
      /* Declaration order marks the primary chain; edges that close a cycle
         become reverse edges and are routed around the outside. */
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children,
    edges,
  };

  const result = await elk.layout(graph);

  const inputSizes = new Map(input.nodes.map((node) => [node.id, node]));
  const nodes = new Map<string, DiagramNodeLayout>();
  for (const child of result.children ?? []) {
    const id = nodeIds.get(child.id);
    if (!id) continue;
    const expected = inputSizes.get(id);
    const width = child.width ?? expected?.width ?? 0;
    const height = child.height ?? expected?.height ?? 0;
    nodes.set(id, {
      x: (child.x ?? 0) + width / 2,
      y: (child.y ?? 0) + height / 2,
      width,
      height,
    });
  }
  if (nodes.size !== input.nodes.length) return createDiagramLayoutFallback(input);

  const edgeLayouts = new Map<string, DiagramEdgeLayout>();
  for (const edge of result.edges ?? []) {
    const id = edgeIds.get(edge.id ?? '');
    if (!id) continue;
    const sections: DiagramEdgeSection[] = (edge.sections ?? []).map((section) => ({
      startPoint: { ...section.startPoint },
      endPoint: { ...section.endPoint },
      bendPoints: (section.bendPoints ?? []).map((point) => ({ ...point })),
    }));
    const label = edge.labels?.[0];
    let labelRect: DiagramLabelRect | undefined;
    if (
      label &&
      typeof label.x === 'number' &&
      typeof label.y === 'number' &&
      typeof label.width === 'number' &&
      typeof label.height === 'number'
    ) {
      labelRect = {
        x: label.x,
        y: label.y,
        width: label.width,
        height: label.height,
      };
    }
    edgeLayouts.set(id, { sections, label: labelRect });
  }

  return finalizeLayout(input, {
    width: result.width ?? 0,
    height: result.height ?? 0,
    nodes,
    edges: edgeLayouts,
    source: 'elk',
  });
}

/* ------------------------------------------------------------------ */
/* Synchronous fallback                                                */
/* ------------------------------------------------------------------ */

/**
 * Deterministic layered layout used before ELK resolves (SSR, static export
 * and first paint). Cycle-closing edges found by a declaration-order DFS are
 * ignored for layering and routed outside the node band.
 */
export function createDiagramLayoutFallback(input: DiagramLayoutInput): DiagramLayoutResult {
  const outgoing = new Map<string, DiagramLayoutEdgeInput[]>(
    input.nodes.map((node) => [node.id, []]),
  );
  for (const edge of input.edges) {
    if (edge.from === edge.to) continue;
    outgoing.get(edge.from)?.push(edge);
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const backPairs = new Set<string>();
  const forwardPairs: { from: string; to: string }[] = [];
  const seenForward = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 'visiting');
    for (const edge of outgoing.get(id) ?? []) {
      if (state.get(edge.to) === 'visiting') {
        backPairs.add(`${edge.from}\u0000${edge.to}`);
        continue;
      }
      const pair = `${edge.from}\u0000${edge.to}`;
      if (!seenForward.has(pair)) {
        seenForward.add(pair);
        forwardPairs.push({ from: edge.from, to: edge.to });
      }
      if (!state.has(edge.to)) visit(edge.to);
    }
    state.set(id, 'done');
  };
  for (const node of input.nodes) {
    if (!state.has(node.id)) visit(node.id);
  }

  const next = new Map<string, string[]>(input.nodes.map((node) => [node.id, []]));
  const indegree = new Map<string, number>(input.nodes.map((node) => [node.id, 0]));
  for (const pair of forwardPairs) {
    if (backPairs.has(`${pair.from}\u0000${pair.to}`)) continue;
    next.get(pair.from)?.push(pair.to);
    indegree.set(pair.to, (indegree.get(pair.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>(input.nodes.map((node) => [node.id, 0]));
  const queue = input.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    for (const target of next.get(id) ?? []) {
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(id) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }

  const layerCount = Math.max(0, ...layer.values()) + 1;
  const groups: string[][] = Array.from({ length: layerCount }, () => []);
  for (const node of input.nodes) groups[layer.get(node.id) ?? 0].push(node.id);
  const populated = groups.filter((group) => group.length > 0);

  const sizes = new Map(input.nodes.map((node) => [node.id, node]));
  const widestLabel = input.edges.reduce(
    (widest, edge) =>
      input.direction === 'right'
        ? Math.max(widest, edge.labelWidth ?? 0)
        : Math.max(widest, edge.labelHeight ?? 0),
    0,
  );
  const primaryGap = Math.max(LAYER_GAP, widestLabel + 28);
  const layerWidths = populated.map((group) =>
    Math.max(...group.map((id) => input.direction === 'right'
      ? sizes.get(id)?.width ?? 0
      : sizes.get(id)?.height ?? 0)),
  );
  const slotSizes = populated.map(
    (group) =>
      group.reduce(
        (sum, id) =>
          sum +
          (input.direction === 'right'
            ? sizes.get(id)?.height ?? 0
            : sizes.get(id)?.width ?? 0),
        0,
      ) +
      Math.max(0, group.length - 1) * NODE_GAP,
  );

  const nodes = new Map<string, DiagramNodeLayout>();
  let cursor = 0;
  populated.forEach((group, layerIndex) => {
    let cross = -slotSizes[layerIndex] / 2;
    for (const id of group) {
      const size = sizes.get(id)!;
      const crossSize = input.direction === 'right' ? size.height : size.width;
      const primary = cursor + layerWidths[layerIndex] / 2;
      const centre = cross + crossSize / 2;
      nodes.set(
        id,
        input.direction === 'right'
          ? { x: primary, y: centre, width: size.width, height: size.height }
          : { x: centre, y: primary, width: size.width, height: size.height },
      );
      cross += crossSize + NODE_GAP;
    }
    cursor += layerWidths[layerIndex] + primaryGap;
  });

  return finalizeLayout(input, {
    width: 0,
    height: 0,
    nodes,
    edges: new Map(),
    source: 'fallback',
  });
}

/* ------------------------------------------------------------------ */
/* Shared routing, label placement and bounds                          */
/* ------------------------------------------------------------------ */

interface EdgeRoute {
  sections: DiagramEdgeSection[];
  labelAnchor: DiagramPoint;
}

function finalizeLayout(
  input: DiagramLayoutInput,
  layout: DiagramLayoutResult,
): DiagramLayoutResult {
  const nodes = new Map(layout.nodes);
  const edges = new Map(layout.edges);
  const outer = outerExtent(nodes, input.direction);

  for (const edge of input.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const current = edges.get(edge.id);
    let sections = current?.sections ?? [];
    let anchor: DiagramPoint | null = null;
    if (sections.length === 0) {
      const route = routeEdge(input.direction, from, to, edge.from === edge.to, outer,
        edge.labelWidth ?? 0, edge.labelHeight ?? 0);
      sections = route.sections;
      anchor = route.labelAnchor;
    }
    let label = current?.label;
    if (!label && edge.labelWidth && edge.labelHeight) {
      const centre = anchor ?? routeMidpoint(sections);
      if (centre) {
        label = {
          x: centre.x - edge.labelWidth / 2,
          y: centre.y - edge.labelHeight / 2,
          width: edge.labelWidth,
          height: edge.labelHeight,
        };
      }
    }
    edges.set(edge.id, { sections, label });
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const node of nodes.values()) {
    include(node.x - node.width / 2, node.y - node.height / 2);
    include(node.x + node.width / 2, node.y + node.height / 2);
  }
  for (const edge of edges.values()) {
    for (const section of edge.sections) {
      for (const point of [section.startPoint, ...section.bendPoints, section.endPoint]) {
        include(point.x, point.y);
      }
    }
    if (edge.label) {
      include(edge.label.x, edge.label.y);
      include(edge.label.x + edge.label.width, edge.label.y + edge.label.height);
    }
  }
  if (!Number.isFinite(minX)) {
    return { ...layout, width: Math.max(1, layout.width), height: Math.max(1, layout.height) };
  }

  const shiftX = LAYOUT_MARGIN - minX;
  const shiftY = LAYOUT_MARGIN - minY;
  for (const node of nodes.values()) {
    node.x += shiftX;
    node.y += shiftY;
  }
  for (const edge of edges.values()) {
    for (const section of edge.sections) {
      for (const point of [section.startPoint, ...section.bendPoints, section.endPoint]) {
        point.x += shiftX;
        point.y += shiftY;
      }
    }
    if (edge.label) {
      edge.label.x += shiftX;
      edge.label.y += shiftY;
    }
  }

  return {
    width: maxX - minX + LAYOUT_MARGIN * 2,
    height: maxY - minY + LAYOUT_MARGIN * 2,
    nodes,
    edges,
    source: layout.source,
  };
}

function outerExtent(
  nodes: Map<string, DiagramNodeLayout>,
  direction: DiagramDirection,
): number {
  let extent = 0;
  for (const node of nodes.values()) {
    extent = Math.max(
      extent,
      direction === 'right' ? node.y + node.height / 2 : node.x + node.width / 2,
    );
  }
  return extent;
}

function routeEdge(
  direction: DiagramDirection,
  from: DiagramNodeLayout,
  to: DiagramNodeLayout,
  self: boolean,
  outer: number,
  labelWidth: number,
  labelHeight: number,
): EdgeRoute {
  if (self) {
    if (direction === 'right') {
      const top = from.y - from.height / 2;
      const loopY = top - Math.max(LOOP_OFFSET, labelHeight / 2 + 12);
      const left = from.x - 18;
      const right = from.x + 18;
      return {
        sections: [
          {
            startPoint: { x: right, y: top },
            bendPoints: [
              { x: right, y: loopY },
              { x: left, y: loopY },
            ],
            endPoint: { x: left, y: top },
          },
        ],
        labelAnchor: { x: from.x, y: loopY },
      };
    }
    const right = from.x + from.width / 2;
    const loopX = right + Math.max(LOOP_OFFSET, labelWidth / 2 + 12);
    const top = from.y - 18;
    const bottom = from.y + 18;
    return {
      sections: [
        {
          startPoint: { x: right, y: top },
          bendPoints: [
            { x: loopX, y: top },
            { x: loopX, y: bottom },
          ],
          endPoint: { x: right, y: bottom },
        },
      ],
      labelAnchor: { x: loopX, y: from.y },
    };
  }

  const forward =
    direction === 'right' ? to.x > from.x + 1 : to.y > from.y + 1;

  if (direction === 'right') {
    if (forward) {
      const x1 = from.x + from.width / 2;
      const y1 = from.y;
      const x2 = to.x - to.width / 2;
      const y2 = to.y;
      if (Math.abs(y2 - y1) < 0.5) {
        return {
          sections: [
            {
              startPoint: { x: x1, y: y1 },
              bendPoints: [],
              endPoint: { x: x2, y: y2 },
            },
          ],
          labelAnchor: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
        };
      }
      const midX = (x1 + x2) / 2;
      return {
        sections: [
          {
            startPoint: { x: x1, y: y1 },
            bendPoints: [
              { x: midX, y: y1 },
              { x: midX, y: y2 },
            ],
            endPoint: { x: x2, y: y2 },
          },
        ],
        labelAnchor: { x: midX, y: (y1 + y2) / 2 },
      };
    }
    const routeY = outer + Math.max(BACK_ROUTE_OFFSET, labelHeight / 2 + 12);
    const x1 = from.x;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    return {
      sections: [
        {
          startPoint: { x: x1, y: y1 },
          bendPoints: [
            { x: x1, y: routeY },
            { x: x2, y: routeY },
          ],
          endPoint: { x: x2, y: y2 },
        },
      ],
      labelAnchor: { x: (x1 + x2) / 2, y: routeY },
    };
  }

  if (forward) {
    const x1 = from.x;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y - to.height / 2;
    if (Math.abs(x2 - x1) < 0.5) {
      return {
        sections: [
          {
            startPoint: { x: x1, y: y1 },
            bendPoints: [],
            endPoint: { x: x2, y: y2 },
          },
        ],
        labelAnchor: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      };
    }
    const midY = (y1 + y2) / 2;
    return {
      sections: [
        {
          startPoint: { x: x1, y: y1 },
          bendPoints: [
            { x: x1, y: midY },
            { x: x2, y: midY },
          ],
          endPoint: { x: x2, y: y2 },
        },
      ],
      labelAnchor: { x: (x1 + x2) / 2, y: midY },
    };
  }
  const routeX = outer + Math.max(BACK_ROUTE_OFFSET, labelWidth / 2 + 12);
  const x1 = from.x + from.width / 2;
  const y1 = from.y;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  return {
    sections: [
      {
        startPoint: { x: x1, y: y1 },
        bendPoints: [
          { x: routeX, y: y1 },
          { x: routeX, y: y2 },
        ],
        endPoint: { x: x2, y: y2 },
      },
    ],
    labelAnchor: { x: routeX, y: (y1 + y2) / 2 },
  };
}

function routeMidpoint(sections: DiagramEdgeSection[]): DiagramPoint | null {
  const segments: { start: DiagramPoint; end: DiagramPoint; length: number }[] = [];
  let total = 0;
  for (const section of sections) {
    const points = [section.startPoint, ...section.bendPoints, section.endPoint];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length > 0) {
        segments.push({ start, end, length });
        total += length;
      }
    }
  }
  if (segments.length === 0) return null;
  let remaining = total / 2;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = segment.length === 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
      };
    }
    remaining -= segment.length;
  }
  return segments[segments.length - 1].end;
}
