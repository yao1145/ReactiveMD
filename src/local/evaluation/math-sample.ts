/**
 * Plot-curve sampling for the drawing capability.
 *
 * Kept apart from formula parsing and compilation so an assembly that only
 * compiles plots does not carry the marching-squares sampler.
 */
import { LatexError, MAX_IMPLICIT_GRID } from './math';
import type { LatexEvaluationBudget, LatexExpression, PlotPoint, PlotSample, PlotSegmentPoint } from './math';
import type { LocalValue } from '../contracts/types';

/** Sample points per curve, including endpoints. */
const MAX_SAMPLES = 2_000;
const MAX_REFINE_DEPTH = 5;
/** Minimum node-visit allowance for one curve sampling call. */
const MIN_PLOT_STEPS = 1_000_000;

function safeValue(
  expression: LatexExpression,
  x: number,
  env: Record<string, LocalValue>,
  budget?: LatexEvaluationBudget,
): number | null {
  try {
    return expression.evaluate(x, env, budget);
  } catch (error) {
    if (error instanceof LatexError) {
      if (error.code === 'latex-budget') throw error;
      return null;
    }
    throw error;
  }
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Bounded subdivision inside one sample interval. A genuine singularity makes
 * the local slope grow without bound as the interval is refined; a smooth
 * curve, even a steep or offset one, converges. The check therefore compares
 * the finest slope with an early refinement level and the plot-wide typical
 * slope, never with the distance to zero.
 */
function refinementDetectsBreak(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  globalSlope: number,
  valueAt: (x: number) => number | null,
): boolean {
  const width = x1 - x0;
  if (!(width > 0)) return false;

  let levelTwoSlope = 0;
  let finalSlope = 0;
  for (let depth = 1; depth <= MAX_REFINE_DEPTH; depth += 1) {
    const count = 1 << depth;
    const dx = width / count;
    let previousY = y0;
    let maxSlope = 0;
    for (let k = 1; k <= count; k += 1) {
      const x = k === count ? x1 : x0 + k * dx;
      const y = k === count ? y1 : valueAt(x);
      if (y === null) return true;
      const slope = Math.abs(y - previousY) / dx;
      if (slope > maxSlope) maxSlope = slope;
      previousY = y;
    }
    if (depth === 2) levelTwoSlope = maxSlope;
    finalSlope = maxSlope;
  }

  return finalSlope > Math.max(levelTwoSlope * 6, globalSlope * 12, 1e-9);
}

/**
 * Samples y(x) across [min, max]. Undefined points and the sample after a
 * detected break become null so a renderer cannot join the two sides of an
 * asymptote. The array always has exactly `samples` points.
 *
 * The optional final budget is shared by every curve/plot in a document. Each
 * evaluation is limited by whatever remains of both that shared budget and the
 * per-curve budget, and a `latex-budget` error aborts the whole sampling pass.
 */
export function samplePlot(
  expression: LatexExpression,
  env: Record<string, LocalValue>,
  min: number,
  max: number,
  samples = 200,
  sharedBudget?: LatexEvaluationBudget,
): PlotSample {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new LatexError('latex-plot-range', 'Plot min/max must be finite numbers.', 0);
  }
  if (!(min < max)) {
    throw new LatexError('latex-plot-range', 'Plot min must be less than max.', 0);
  }
  if (!Number.isInteger(samples) || samples < 2 || samples > MAX_SAMPLES) {
    throw new LatexError('latex-plot-samples', `Sample count must be an integer between 2 and ${MAX_SAMPLES}.`, 0);
  }

  // Each curve keeps its own hard budget, while an optional caller-provided
  // budget is shared by every curve and every plot in the document. A single
  // evaluation receives whatever remains of both, so neither limit can be
  // bypassed by handing out a fresh budget per sample.
  const localBudget: LatexEvaluationBudget = {
    steps: 0,
    limit: Math.max(MIN_PLOT_STEPS, samples * 1024),
  };

  const sampleValue = (x: number): number | null => {
    const localRemaining = localBudget.limit - localBudget.steps;
    // A malformed external budget fails closed (zero remaining) rather than
    // becoming an unlimited NaN or Infinity comparison.
    const sharedRemaining = sharedBudget
      ? Number.isFinite(sharedBudget.limit) && Number.isFinite(sharedBudget.steps)
        ? sharedBudget.limit - sharedBudget.steps
        : 0
      : Number.POSITIVE_INFINITY;
    const evaluation: LatexEvaluationBudget = {
      steps: 0,
      limit: Math.max(0, Math.min(localRemaining, sharedRemaining)),
    };
    try {
      return safeValue(expression, x, env, evaluation);
    } finally {
      localBudget.steps += evaluation.steps;
      if (sharedBudget) {
        sharedBudget.steps = Number.isFinite(sharedBudget.steps)
          ? sharedBudget.steps + evaluation.steps
          : evaluation.steps;
      }
    }
  };

  const step = (max - min) / (samples - 1);
  const raw: PlotPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const x = i === samples - 1 ? max : min + i * step;
    raw.push({ x, y: sampleValue(x) });
  }

  const magnitudes = raw
    .map((point) => point.y)
    .filter((value): value is number => value !== null)
    .map((value) => Math.abs(value));
  const spikeLimit = Math.max(1e-9, medianOf(magnitudes) * 8);

  // A sample that lands exactly on a floating-point asymptote (tan of pi/2)
  // can be finite but astronomically larger than both neighbours. Treat such
  // isolated spikes as undefined rather than drawing a needle.
  for (let i = 1; i < raw.length - 1; i += 1) {
    const previous = raw[i - 1].y;
    const current = raw[i].y;
    const following = raw[i + 1].y;
    if (previous === null || current === null || following === null) continue;
    const neighbourMax = Math.max(1, Math.abs(previous), Math.abs(following));
    if (Math.abs(current) > neighbourMax * 100 && Math.abs(current) > spikeLimit) {
      raw[i] = { x: raw[i].x, y: null };
    }
  }

  const lastIndex = raw.length - 1;
  let endpoint = raw[lastIndex].y;
  const beforeEnd = lastIndex > 0 ? raw[lastIndex - 1].y : null;
  if (endpoint !== null && beforeEnd !== null
    && Math.abs(endpoint) > Math.max(1, Math.abs(beforeEnd)) * 100
    && Math.abs(endpoint) > spikeLimit) {
    endpoint = null;
    raw[lastIndex] = { x: raw[lastIndex].x, y: null };
  }

  // Offset-invariant scales for deciding whether an interval needs a closer
  // look: adjacent value changes and adjacent slopes.
  const deltas: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < raw.length - 1; i += 1) {
    const left = raw[i];
    const right = raw[i + 1];
    if (left.y === null || right.y === null) continue;
    const delta = Math.abs(right.y - left.y);
    deltas.push(delta);
    const dx = right.x - left.x;
    if (dx > 0) slopes.push(delta / dx);
  }
  const globalDelta = medianOf(deltas);
  const globalSlope = medianOf(slopes);

  // Keep exactly `samples` points so every curve shares x positions; a break
  // is represented by turning the post-break sample null.
  for (let i = 0; i < raw.length - 1; i += 1) {
    const point = raw[i];
    const next = raw[i + 1];
    const y1 = point.y;
    const y2 = next.y;
    if (y1 === null || y2 === null) continue;

    const cutNext = () => {
      raw[i + 1] = { x: next.x, y: null };
    };

    const midX = point.x + (next.x - point.x) / 2;
    const midY = sampleValue(midX);
    if (midY === null) {
      cutNext();
      continue;
    }

    const gap = Math.abs(y2 - y1);
    const deviation = Math.abs(midY - (y1 + y2) / 2);
    const interesting = deviation > Math.max(gap * 0.25, globalDelta * 0.4, 1e-9)
      || gap > Math.max(globalDelta * 16, 1e-9);
    if (!interesting) continue;

    const singular = refinementDetectsBreak(
      point.x,
      y1,
      next.x,
      y2,
      globalSlope,
      (x) => sampleValue(x),
    );
    if (singular) cutNext();
  }

  return { points: raw, endpoint };
}

function validatePlotShape(min: number, max: number, samples: number, maximumSamples: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new LatexError('latex-plot-range', 'Plot min/max must be finite numbers.', 0);
  }
  if (!(min < max)) {
    throw new LatexError('latex-plot-range', 'Plot min must be less than max.', 0);
  }
  if (!Number.isInteger(samples) || samples < 2 || samples > maximumSamples) {
    throw new LatexError('latex-plot-samples', `Sample count must be an integer between 2 and ${maximumSamples}.`, 0);
  }
}

function takeEvaluationBudget(
  local: LatexEvaluationBudget,
  shared: LatexEvaluationBudget | undefined,
): LatexEvaluationBudget {
  const localRemaining = local.limit - local.steps;
  const sharedRemaining = shared
    ? Number.isFinite(shared.limit) && Number.isFinite(shared.steps)
      ? shared.limit - shared.steps
      : 0
    : Number.POSITIVE_INFINITY;
  return { steps: 0, limit: Math.max(0, Math.min(localRemaining, sharedRemaining)) };
}

function recordEvaluationBudget(
  local: LatexEvaluationBudget,
  shared: LatexEvaluationBudget | undefined,
  evaluation: LatexEvaluationBudget,
): void {
  local.steps += evaluation.steps;
  if (shared) {
    shared.steps = Number.isFinite(shared.steps)
      ? shared.steps + evaluation.steps
      : evaluation.steps;
  }
}

/**
 * Samples a parametric curve `(x(t), y(t))` over [min, max]. Points whose x or
 * y value is undefined keep a NaN x and a null y so the renderer breaks the
 * stroke instead of joining across a domain gap.
 */
export function sampleParametric(
  xExpression: LatexExpression,
  yExpression: LatexExpression,
  env: Record<string, LocalValue>,
  min: number,
  max: number,
  samples = 200,
  sharedBudget?: LatexEvaluationBudget,
): PlotSample {
  validatePlotShape(min, max, samples, MAX_SAMPLES);
  const localBudget: LatexEvaluationBudget = {
    steps: 0,
    limit: Math.max(MIN_PLOT_STEPS, samples * 2048),
  };
  const step = (max - min) / (samples - 1);
  const points: PlotPoint[] = [];

  for (let index = 0; index < samples; index += 1) {
    const t = index === samples - 1 ? max : min + index * step;
    const pointEnv: Record<string, LocalValue> = { ...env, t };
    const xBudget = takeEvaluationBudget(localBudget, sharedBudget);
    let x: number | null = null;
    try {
      x = safeValue(xExpression, t, pointEnv, xBudget);
    } finally {
      recordEvaluationBudget(localBudget, sharedBudget, xBudget);
    }
    const yBudget = takeEvaluationBudget(localBudget, sharedBudget);
    let y: number | null = null;
    try {
      y = x === null ? null : safeValue(yExpression, t, pointEnv, yBudget);
    } finally {
      recordEvaluationBudget(localBudget, sharedBudget, yBudget);
    }
    points.push({
      x: x === null || !Number.isFinite(x) ? Number.NaN : x,
      y: x === null || y === null || !Number.isFinite(y) ? null : y,
      t,
    });
  }

  const last = points[points.length - 1];
  return { points, endpoint: last && last.y !== null ? last.y : null };
}

/** Samples r(theta) in radians and projects each finite radius to x/y. */
export function samplePolar(
  expression: LatexExpression,
  env: Record<string, LocalValue>,
  min: number,
  max: number,
  samples = 200,
  sharedBudget?: LatexEvaluationBudget,
): PlotSample {
  validatePlotShape(min, max, samples, MAX_SAMPLES);
  const localBudget: LatexEvaluationBudget = {
    steps: 0,
    limit: Math.max(MIN_PLOT_STEPS, samples * 1024),
  };
  const step = (max - min) / (samples - 1);
  const points: PlotPoint[] = [];
  for (let index = 0; index < samples; index += 1) {
    const theta = index === samples - 1 ? max : min + index * step;
    const evaluation = takeEvaluationBudget(localBudget, sharedBudget);
    let radius: number | null;
    try {
      radius = safeValue(expression, theta, { ...env, theta }, evaluation);
    } finally {
      recordEvaluationBudget(localBudget, sharedBudget, evaluation);
    }
    if (radius === null || !Number.isFinite(radius) || !Number.isFinite(theta)) {
      points.push({ x: Number.NaN, y: null, theta });
      continue;
    }
    points.push({
      x: radius * Math.cos(theta),
      y: radius * Math.sin(theta),
      theta,
    });
  }
  return { points, endpoint: points.at(-1)?.y ?? null };
}

/* ------------------------------------------------------------------ */
/* Implicit curves                                                     */
/* ------------------------------------------------------------------ */

interface ImplicitSegment {
  a: PlotSegmentPoint;
  b: PlotSegmentPoint;
}

function crossingPoint(
  ax: number,
  ay: number,
  av: number,
  bx: number,
  by: number,
  bv: number,
): PlotSegmentPoint {
  const denominator = av - bv;
  const ratio = denominator === 0 ? 0.5 : Math.max(0, Math.min(1, av / denominator));
  return { x: ax + (bx - ax) * ratio, y: ay + (by - ay) * ratio };
}

function marchingSquaresEdges(index: number, centerPositive: boolean): [number, number][] {
  switch (index) {
    case 1: return [[3, 0]];
    case 2: return [[0, 1]];
    case 3: return [[3, 1]];
    case 4: return [[1, 2]];
    case 5: return centerPositive ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
    case 6: return [[0, 2]];
    case 7: return [[3, 2]];
    case 8: return [[2, 3]];
    case 9: return [[0, 2]];
    case 10: return centerPositive ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
    case 11: return [[1, 2]];
    case 12: return [[3, 1]];
    case 13: return [[0, 1]];
    case 14: return [[3, 0]];
    default: return [];
  }
}

function stitchImplicitSegments(
  segments: ImplicitSegment[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): PlotSegmentPoint[][] {
  if (segments.length === 0) return [];
  const spanX = xMax - xMin || 1;
  const spanY = yMax - yMin || 1;
  const keyOf = (point: PlotSegmentPoint) =>
    `${Math.round(((point.x - xMin) / spanX) * 1e7)},${Math.round(((point.y - yMin) / spanY) * 1e7)}`;
  const buckets = new Map<string, number[]>();
  const addBucket = (key: string, index: number): void => {
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  };
  segments.forEach((segment, index) => {
    addBucket(keyOf(segment.a), index);
    addBucket(keyOf(segment.b), index);
  });

  const used = new Uint8Array(segments.length);
  const lines: PlotSegmentPoint[][] = [];
  const extend = (line: PlotSegmentPoint[], end: PlotSegmentPoint): boolean => {
    const bucket = buckets.get(keyOf(end));
    if (!bucket) return false;
    for (const index of bucket) {
      if (used[index]) continue;
      const segment = segments[index];
      const other = keyOf(segment.a) === keyOf(end) ? segment.b : segment.a;
      if (keyOf(other) === keyOf(end)) {
        used[index] = 1;
        continue;
      }
      used[index] = 1;
      line.push(other);
      return true;
    }
    return false;
  };

  for (let index = 0; index < segments.length; index += 1) {
    if (used[index]) continue;
    const segment = segments[index];
    if (keyOf(segment.a) === keyOf(segment.b)) {
      used[index] = 1;
      continue;
    }
    used[index] = 1;
    const line: PlotSegmentPoint[] = [segment.a, segment.b];
    let guard = 0;
    while (guard < segments.length && extend(line, line[line.length - 1])) guard += 1;
    line.reverse();
    guard = 0;
    while (guard < segments.length && extend(line, line[line.length - 1])) guard += 1;
    line.reverse();
    lines.push(line);
  }
  return lines;
}

/**
 * Traces `expression(x, y) = 0` with marching squares. The caller supplies the
 * viewport; the environment receives the current y for every evaluation.
 */
export function sampleImplicit(
  expression: LatexExpression,
  env: Record<string, LocalValue>,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  grid = 100,
  sharedBudget?: LatexEvaluationBudget,
): PlotSegmentPoint[][] {
  validatePlotShape(xMin, xMax, grid, MAX_IMPLICIT_GRID);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || !(yMin < yMax)) {
    throw new LatexError('latex-plot-range', 'The vertical plot range must be finite and increasing.', 0);
  }

  const localBudget: LatexEvaluationBudget = {
    steps: 0,
    limit: Math.max(MIN_PLOT_STEPS, grid * grid * 2048),
  };
  const columns = grid + 1;
  const values: (number | null)[] = new Array(columns * columns).fill(null);
  const stepX = (xMax - xMin) / grid;
  const stepY = (yMax - yMin) / grid;

  for (let row = 0; row <= grid; row += 1) {
    const y = row === grid ? yMax : yMin + row * stepY;
    const rowEnv: Record<string, LocalValue> = { ...env, y };
    for (let column = 0; column <= grid; column += 1) {
      const x = column === grid ? xMax : xMin + column * stepX;
      const evaluation = takeEvaluationBudget(localBudget, sharedBudget);
      let value: number | null = null;
      try {
        value = safeValue(expression, x, rowEnv, evaluation);
      } finally {
        recordEvaluationBudget(localBudget, sharedBudget, evaluation);
      }
      values[row * columns + column] = value !== null && Number.isFinite(value) ? value : null;
    }
  }

  const segments: ImplicitSegment[] = [];
  const at = (column: number, row: number): number | null => values[row * columns + column];
  for (let row = 0; row < grid; row += 1) {
    const lastRow = row + 1 === grid;
    const y0 = lastRow ? yMax - stepY : yMin + row * stepY;
    const y1 = lastRow ? yMax : yMin + (row + 1) * stepY;
    for (let column = 0; column < grid; column += 1) {
      const lastColumn = column + 1 === grid;
      const x0 = lastColumn ? xMax - stepX : xMin + column * stepX;
      const x1 = lastColumn ? xMax : xMin + (column + 1) * stepX;
      const v0 = at(column, row);
      const v1 = at(column + 1, row);
      const v2 = at(column + 1, row + 1);
      const v3 = at(column, row + 1);
      if (v0 === null || v1 === null || v2 === null || v3 === null) continue;
      const index = (v0 >= 0 ? 1 : 0) | (v1 >= 0 ? 2 : 0) | (v2 >= 0 ? 4 : 0) | (v3 >= 0 ? 8 : 0);
      if (index === 0 || index === 15) continue;
      const top = crossingPoint(x0, y0, v0, x1, y0, v1);
      const right = crossingPoint(x1, y0, v1, x1, y1, v2);
      const bottom = crossingPoint(x0, y1, v3, x1, y1, v2);
      const left = crossingPoint(x0, y0, v0, x0, y1, v3);
      const edges = [top, right, bottom, left];
      const center = (v0 + v1 + v2 + v3) / 4;
      for (const [first, second] of marchingSquaresEdges(index, center >= 0)) {
        segments.push({ a: edges[first], b: edges[second] });
      }
    }
  }

  return stitchImplicitSegments(segments, xMin, xMax, yMin, yMax);
}
