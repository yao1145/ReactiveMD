/**
 * Pure layout math for the Mafs-backed function plot.
 *
 * Mafs normally keeps one pixel-per-unit scale for both axes. A function plot
 * cannot do that when x and y live on wildly different magnitudes (for
 * example x = 0..20 and y = 50000..300000): either the curve collapses into a
 * line or one axis is padded by the other axis' span. Rendering with
 * `preserveAspectRatio={false}` lets each axis use its own scale, and this
 * module supplies one grid spacing per axis plus the visible ranges that make
 * every on-screen grid cell square again.
 *
 * The trick is that both spacings come from the same ladder of "nice" numbers
 * (1, 2, 2.5, 4, 5 x 10^k). Picking a pair whose cell sizes are already close
 * and then expanding the axis with the larger cell by a fraction of a cell
 * yields exactly square cells while the data stays tightly framed.
 */

export interface MafsGridRange {
  min: number;
  max: number;
}

export interface PlotGridLayoutInput {
  xDomain: MafsGridRange;
  yDomain: MafsGridRange;
  width: number;
  height: number;
  /** Fraction of each axis span added as breathing room around the data. */
  padding?: number;
  /** Preferred on-screen size of one grid cell, in CSS pixels. */
  targetCellPx?: number;
  /** Smallest sensible grid cell used when choosing a nice spacing. */
  minCellPx?: number;
  /** Largest sensible grid cell used when choosing a nice spacing. */
  maxCellPx?: number;
}

export interface PlotGridLayout {
  /** Grid spacing in x-axis units. */
  xLines: number;
  /** Grid spacing in y-axis units. */
  yLines: number;
  /** Visible x range, including padding and any square-cell correction. */
  xRange: MafsGridRange;
  /** Visible y range, including padding and any square-cell correction. */
  yRange: MafsGridRange;
  /** Resulting on-screen cell size, identical on both axes. */
  cellPx: number;
}

const NICE_MULTIPLIERS = [1, 2, 2.5, 4, 5];
const DEFAULT_PADDING = 0.04;
const DEFAULT_TARGET_CELL_PX = 58;
const DEFAULT_MIN_CELL_PX = 30;
const DEFAULT_MAX_CELL_PX = 110;
const FALLBACK_WIDTH = 560;
const FALLBACK_HEIGHT = 360;

function positiveOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}

/** Return a finite, ordered range; degenerate inputs get a modest span. */
export function normalizeGridRange(range: MafsGridRange): MafsGridRange {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  if (max > min) return { min, max };
  const center = (min + max) / 2;
  const half = Math.max(Math.abs(center) * 0.15, 0.5);
  return { min: center - half, max: center + half };
}

function padRange(range: MafsGridRange, padding: number): MafsGridRange {
  const pad = (range.max - range.min) * padding;
  return { min: range.min - pad, max: range.max + pad };
}

function centeredRange(range: MafsGridRange, span: number): MafsGridRange {
  const width = Math.max(span, range.max - range.min);
  const center = (range.min + range.max) / 2;
  return { min: center - width / 2, max: center + width / 2 };
}

/** Largest "nice" number (1, 2, 2.5, 4 or 5 x 10^k) not above `value`. */
export function niceGridStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const scaled = value / 10 ** exponent;
  let multiplier = NICE_MULTIPLIERS[0];
  for (const candidate of NICE_MULTIPLIERS) {
    if (candidate <= scaled + 1e-9) multiplier = candidate;
  }
  return multiplier * 10 ** exponent;
}

/** Every nice step within the inclusive interval [min, max]. */
function niceStepsBetween(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return [];
  const steps: number[] = [];
  const lowestExponent = Math.floor(Math.log10(min)) - 1;
  const highestExponent = Math.ceil(Math.log10(max)) + 1;
  for (let exponent = lowestExponent; exponent <= highestExponent; exponent += 1) {
    for (const multiplier of NICE_MULTIPLIERS) {
      const step = multiplier * 10 ** exponent;
      if (step >= min * (1 - 1e-9) && step <= max * (1 + 1e-9)) steps.push(step);
    }
  }
  return steps;
}

function axisCandidates(span: number, pixels: number, minCellPx: number, maxCellPx: number): number[] {
  const candidates = niceStepsBetween(
    (span * minCellPx) / pixels,
    (span * maxCellPx) / pixels,
  );
  return candidates.length > 0 ? candidates : [niceGridStep(span / 8)];
}

/**
 * Choose per-axis grid spacings and visible ranges so that:
 * - each axis frames its own data (small relative padding, never cropped);
 * - both axes use readable "nice" spacings;
 * - one grid cell renders as a square regardless of the axis magnitudes.
 */
export function plotGridLayout(input: PlotGridLayoutInput): PlotGridLayout {
  const width = positiveOr(input.width, FALLBACK_WIDTH);
  const height = positiveOr(input.height, FALLBACK_HEIGHT);
  const padding = input.padding === undefined
    ? DEFAULT_PADDING
    : Math.max(0, input.padding);
  const targetCellPx = positiveOr(input.targetCellPx, DEFAULT_TARGET_CELL_PX);
  const minCellPx = positiveOr(input.minCellPx, DEFAULT_MIN_CELL_PX);
  const maxCellPx = positiveOr(input.maxCellPx, DEFAULT_MAX_CELL_PX);

  const xBase = padRange(normalizeGridRange(input.xDomain), padding);
  const yBase = padRange(normalizeGridRange(input.yDomain), padding);
  const xSpan = xBase.max - xBase.min;
  const ySpan = yBase.max - yBase.min;

  const xCandidates = axisCandidates(xSpan, width, minCellPx, maxCellPx);
  const yCandidates = axisCandidates(ySpan, height, minCellPx, maxCellPx);

  let best: { xLines: number; yLines: number; cellPx: number; score: number } | null = null;
  for (const xLines of xCandidates) {
    for (const yLines of yCandidates) {
      const xCell = (xLines * width) / xSpan;
      const yCell = (yLines * height) / ySpan;
      const cellPx = Math.min(xCell, yCell);
      if (!(cellPx > 0)) continue;
      // Prefer pairs whose natural cell sizes already match (little padding
      // correction) and whose cells stay near the preferred size.
      const mismatch = Math.max(xCell, yCell) / cellPx - 1;
      const sizePenalty = Math.abs(Math.log(cellPx / targetCellPx));
      const score = mismatch * 4 + sizePenalty;
      if (!best || score < best.score) best = { xLines, yLines, cellPx, score };
    }
  }

  if (!best) {
    const xLines = niceGridStep(xSpan / 8);
    const yLines = niceGridStep(ySpan / 6);
    return {
      xLines,
      yLines,
      xRange: xBase,
      yRange: yBase,
      cellPx: Math.min((xLines * width) / xSpan, (yLines * height) / ySpan),
    };
  }

  // Expand the axis whose natural cell is too large so both end up identical.
  const xVisibleSpan = (best.xLines * width) / best.cellPx;
  const yVisibleSpan = (best.yLines * height) / best.cellPx;
  return {
    xLines: best.xLines,
    yLines: best.yLines,
    xRange: centeredRange(xBase, xVisibleSpan),
    yRange: centeredRange(yBase, yVisibleSpan),
    cellPx: best.cellPx,
  };
}
