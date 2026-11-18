import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Coordinates,
  Line,
  Mafs,
  MovablePoint,
  Point,
  Polyline,
  Text,
  useTransformContext,
  vec,
} from 'mafs';
import { plotGridLayout } from './mafs-plot-grid';

export interface MafsRange {
  min: number;
  max: number;
}

export interface PlotSurfacePoint {
  x: number;
  y: number;
}

export interface PlotSurfaceSegment {
  curve: number;
  points: PlotSurfacePoint[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return String(Number(value.toFixed(4)));
}

function axisLabel(value: number): string {
  return Math.abs(value) < 1e-9 ? '' : formatNumber(value);
}

/**
 * Draws the coordinate grid and ticks. Labels are hidden right at the visible
 * edges, where the halved text would be clipped, and thinned out when the
 * grid lines are closer together than the readable minimum.
 */
function MafsAxes({
  xSpacing,
  ySpacing,
  subdivisions,
  width,
  height,
  xLabelMinGap,
  yLabelMinGap,
}: {
  xSpacing: number;
  ySpacing?: number;
  subdivisions?: number | false;
  width: number;
  height: number;
  /** Pixel gap below which x labels are shown on every n-th grid line. */
  xLabelMinGap?: number;
  /** Pixel gap below which y labels are shown on every n-th grid line. */
  yLabelMinGap?: number;
}) {
  const { viewTransform } = useTransformContext();
  const groupRef = useRef<SVGGElement>(null);
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  // Mafs renders into a shifted viewBox, so read its corner to convert the
  // projected position back into viewport coordinates before clipping labels.
  useLayoutEffect(() => {
    const viewBox = groupRef.current?.ownerSVGElement?.getAttribute('viewBox')?.split(/\s+/).map(Number);
    if (!viewBox || viewBox.length < 2 || !Number.isFinite(viewBox[0]) || !Number.isFinite(viewBox[1])) return;
    setOrigin((current) => (current && current[0] === viewBox[0] && current[1] === viewBox[1] ? current : [viewBox[0], viewBox[1]]));
  });
  const spacingY = ySpacing ?? xSpacing;
  const pixelCellX = Math.abs(viewTransform[0] * xSpacing);
  const pixelCellY = Math.abs(viewTransform[4] * spacingY);
  const xEvery = labelEvery(pixelCellX, xLabelMinGap);
  const yEvery = labelEvery(pixelCellY, yLabelMinGap);
  const margin = 14;
  const xLabel = (value: number): string => {
    if (!onEveryGridLine(value, xSpacing, xEvery)) return '';
    if (!origin) return axisLabel(value);
    const px = vec.transform([value, 0], viewTransform)[0] - origin[0];
    return px < margin || px > width - margin ? '' : axisLabel(value);
  };
  const yLabel = (value: number): string => {
    if (!onEveryGridLine(value, spacingY, yEvery)) return '';
    if (!origin) return axisLabel(value);
    const py = vec.transform([0, value], viewTransform)[1] - origin[1];
    return py < margin || py > height - margin ? '' : axisLabel(value);
  };
  return (
    <g ref={groupRef}>
      <Coordinates.Cartesian
        xAxis={{ lines: xSpacing, subdivisions, labels: xLabel }}
        yAxis={{ lines: spacingY, subdivisions, labels: yLabel }}
      />
    </g>
  );
}

/** How many grid lines to skip between labels to keep them readable. */
function labelEvery(pixelCell: number, minGap: number | undefined): number {
  if (!minGap || !(pixelCell > 0) || minGap <= pixelCell) return 1;
  return Math.ceil(minGap / pixelCell - 1e-9);
}

function onEveryGridLine(value: number, spacing: number, every: number): boolean {
  if (every <= 1) return true;
  if (!(spacing > 0)) return true;
  const position = value / spacing;
  const rounded = Math.round(position);
  return Math.abs(position - rounded) < 1e-6 && ((rounded % every) + every) % every === 0;
}

function useElementWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function gridSpacing(span: number, step: number): number {
  const size = step > 0 ? step : 1;
  const target = span / 8;
  for (const multiplier of [1, 2, 5, 10, 20, 50, 100]) {
    if (size * multiplier >= target) return size * multiplier;
  }
  return size * 100;
}

function nextNice(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const base = value / 10 ** exponent;
  const next = base < 1.5 ? 2 : base < 3.5 ? 5 : 10;
  return next * 10 ** exponent;
}

/**
 * Keep one grid spacing on both axes so each grid cell renders square. Mafs
 * keeps equal pixel-per-unit scales, so equal math spacing means square cells.
 */
function sharedSpacing(spanX: number, spanY: number, spacingX: number, spacingY: number): number {
  let spacing = Math.min(spacingX || spacingY, spacingY || spacingX) || 1;
  const span = Math.max(spanX, spanY);
  for (let step = 0; step < 12 && span / spacing > 10; step += 1) spacing = nextNice(spacing * 1.01);
  return spacing;
}

/* ------------------------------------------------------------ coordinate */

export interface MafsCoordinatePlaneProps {
  x: number;
  y: number;
  xRange: MafsRange;
  yRange: MafsRange;
  step: number;
  disabled: boolean;
  accent: string;
  onMove: (x: number, y: number) => void;
}

function snap(value: number, range: MafsRange, step: number): number {
  const size = step > 0 ? step : 1;
  const maximumSteps = Math.max(0, Math.floor((range.max - range.min) / size + 1e-9));
  const steps = clamp(Math.round((value - range.min) / size), 0, maximumSteps);
  const snapped = range.min + steps * size;
  return Number(snapped.toPrecision(15));
}

export function MafsCoordinatePlane({
  x,
  y,
  xRange,
  yRange,
  step,
  disabled,
  accent,
  onMove,
}: MafsCoordinatePlaneProps) {
  const spanX = Math.max(1e-9, xRange.max - xRange.min);
  const spanY = Math.max(1e-9, yRange.max - yRange.min);
  const spacing = sharedSpacing(spanX, spanY, gridSpacing(spanX, step), gridSpacing(spanY, step));
  const subdivisions = ((): number | false => {
    const count = Math.round(spacing / (step > 0 ? step : 1)) - 1;
    return count > 0 ? count : false;
  })();
  const axisX = clamp(0, xRange.min, xRange.max);
  const axisY = clamp(0, yRange.min, yRange.max);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapperRef);

  const constrain = ([nextX, nextY]: [number, number]): [number, number] => {
    if (disabled) return [x, y];
    return [snap(nextX, xRange, step), snap(nextY, yRange, step)];
  };

  return (
    <div ref={wrapperRef} data-rmd-part="plane">
    <Mafs
      height={420}
      width="auto"
      pan={false}
      zoom={false}
      preserveAspectRatio="contain"
      viewBox={{ x: [xRange.min, xRange.max], y: [yRange.min, yRange.max], padding: Math.max(spanX, spanY) * 0.09 }}
    >
      <MafsAxes xSpacing={spacing} subdivisions={subdivisions} width={width} height={420} />
      <Line.Segment point1={[x, axisY]} point2={[x, y]} color={accent} opacity={0.5} style="dashed" weight={1.5} />
      <Line.Segment point1={[axisX, y]} point2={[x, y]} color={accent} opacity={0.5} style="dashed" weight={1.5} />
      <MovablePoint
        point={[x, y]}
        onMove={([nextX, nextY]) => onMove(nextX, nextY)}
        constrain={constrain}
        color={accent}
      />
      <Text x={x} y={y} attach="s" attachDistance={24} color={accent} size={17} svgTextProps={{ textAnchor: 'middle' }}>
        ({formatNumber(x)}, {formatNumber(y)})
      </Text>
    </Mafs>
    </div>
  );
}

/* ------------------------------------------------------------------ plot */

export interface MafsPlotSurfaceProps {
  label: string;
  readoutId?: string;
  xDomain: MafsRange;
  yDomain: MafsRange;
  segments: PlotSurfaceSegment[];
  colors: readonly string[];
  focused: number | null;
  onFocusedChange: (curve: number | null) => void;
  onActiveXChange: (x: number | null) => void;
  curvePointAt: (curve: number, x: number) => PlotSurfacePoint | null;
  onKeyDown?: (event: ReactKeyboardEvent<Element>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const PLOT_SURFACE_HEIGHT = 360;
const PLOT_SURFACE_FALLBACK_WIDTH = 560;

interface ViewSyncProps {
  viewRef: { current: vec.Matrix | null };
}

/** Exposes Mafs's math-to-pixel matrix to pointer handlers outside the SVG. */
function ViewSync({ viewRef }: ViewSyncProps) {
  viewRef.current = useTransformContext().viewTransform;
  return null;
}

interface TrackerState {
  curve: number;
  x: number;
  y: number;
}

export function MafsPlotSurface({
  label,
  readoutId,
  xDomain,
  yDomain,
  segments,
  colors,
  focused,
  onFocusedChange,
  onActiveXChange,
  curvePointAt,
  onKeyDown,
  onFocus,
  onBlur,
}: MafsPlotSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<vec.Matrix | null>(null);
  const [tracker, setTracker] = useState<TrackerState | null>(null);
  const width = useElementWidth(surfaceRef);

  // The wrapper owns the keyboard readout; keep Mafs from adding a second tab stop.
  useEffect(() => {
    surfaceRef.current?.querySelector<HTMLElement>('.MafsView')?.setAttribute('tabindex', '-1');
  }, []);

  // Each axis gets its own "nice" spacing and visible range; the ranges are
  // adjusted so that a screen grid cell is square even though the x and y
  // units differ by orders of magnitude.
  const grid = plotGridLayout({
    xDomain,
    yDomain,
    width: width > 0 ? width : PLOT_SURFACE_FALLBACK_WIDTH,
    height: PLOT_SURFACE_HEIGHT,
  });
  // Reserve enough pixels for the longest tick label before thinning labels.
  const xLabelChars = Math.max(axisLabel(xDomain.min).length, axisLabel(xDomain.max).length, 1);
  const xLabelMinGap = 16 + xLabelChars * 8;

  const pointerToMath = (event: ReactPointerEvent<HTMLElement>): [number, number] | null => {
    const matrix = viewRef.current;
    const svg = surfaceRef.current?.querySelector<SVGSVGElement>('.MafsView svg');
    if (!matrix || !svg) return null;
    const rect = svg.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return null;
    }
    const screenMatrix = svg.getScreenCTM();
    const inverse = vec.matrixInvert(matrix);
    if (!screenMatrix || !inverse) return null;
    const user = new DOMPoint(event.clientX, event.clientY).matrixTransform(screenMatrix.inverse());
    return vec.transform([user.x, user.y], inverse);
  };

  const nearestCurve = (x: number, y: number, thresholdPx: number): number | null => {
    const matrix = viewRef.current;
    if (!matrix) return null;
    const scaleX = Math.abs(matrix[0]) || 1;
    const scaleY = Math.abs(matrix[4]) || 1;
    let best: { curve: number; distance: number } | null = null;
    for (let curve = 0; curve < colors.length; curve += 1) {
      const point = curvePointAt(curve, x);
      if (!point || !Number.isFinite(point.y)) continue;
      const distance = Math.hypot((point.x - x) * scaleX, (point.y - y) * scaleY);
      if (distance <= thresholdPx && (!best || distance < best.distance)) {
        best = { curve, distance };
      }
    }
    return best ? best.curve : null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const point = pointerToMath(event);
    if (!point) {
      setTracker(null);
      onActiveXChange(null);
      return;
    }
    const [x, y] = point;
    if (x < xDomain.min || x > xDomain.max) {
      setTracker(null);
      onActiveXChange(null);
      return;
    }
    onActiveXChange(x);
    const curve = focused ?? nearestCurve(x, y, 44);
    if (curve === null) {
      setTracker(null);
      return;
    }
    const at = curvePointAt(curve, x);
    const aligned = at !== null && Math.abs(at.x - x) < 1e-6;
    setTracker(aligned && Number.isFinite(at.y) ? { curve, x: at.x, y: at.y } : null);
  };

  const handlePointerLeave = () => {
    setTracker(null);
    onActiveXChange(null);
  };

  const handleClick = ([x, y]: [number, number]) => {
    const curve = nearestCurve(x, y, 28);
    onFocusedChange(curve);
    onActiveXChange(x);
    if (curve === null) {
      setTracker(null);
      return;
    }
    const at = curvePointAt(curve, x);
    const aligned = at !== null && Math.abs(at.x - x) < 1e-6;
    setTracker(aligned && Number.isFinite(at.y) ? { curve, x: at.x, y: at.y } : null);
  };

  const trackerColor = tracker && tracker.curve < colors.length ? colors[tracker.curve] : colors[0];
  const axisY = clamp(0, yDomain.min, yDomain.max);
  const labelBelow = tracker ? tracker.y > yDomain.max - (yDomain.max - yDomain.min) * 0.08 : false;

  return (
    <div
      ref={surfaceRef}
      className="local-mafs-plot"
      role="group"
      aria-label={label}
      aria-describedby={readoutId}
      tabIndex={0}
      data-rmd-part="plane"
      onPointerDown={() => surfaceRef.current?.focus({ preventScroll: true })}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onKeyDownCapture={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <Mafs
        height={PLOT_SURFACE_HEIGHT}
        width="auto"
        pan
        zoom={{ min: 0.4, max: 4 }}
        preserveAspectRatio={false}
        viewBox={{
          x: [grid.xRange.min, grid.xRange.max],
          y: [grid.yRange.min, grid.yRange.max],
          padding: 0,
        }}
        onClick={handleClick}
      >
        <ViewSync viewRef={viewRef} />
        <MafsAxes
          xSpacing={grid.xLines}
          ySpacing={grid.yLines}
          width={width > 0 ? width : PLOT_SURFACE_FALLBACK_WIDTH}
          height={PLOT_SURFACE_HEIGHT}
          xLabelMinGap={xLabelMinGap}
          yLabelMinGap={24}
        />
        {segments.map((segment, index) =>
          segment.points.length > 1 ? (
            <Polyline
              key={`segment-${segment.curve}-${index}`}
              points={segment.points.map((point) => [point.x, point.y] as [number, number])}
              color={colors[segment.curve % colors.length]}
              weight={focused === segment.curve ? 3 : 2.4}
              strokeOpacity={focused !== null && focused !== segment.curve ? 0.25 : 1}
            />
          ) : null,
        )}
        {tracker ? (
          <>
            <Line.Segment
              point1={[tracker.x, axisY]}
              point2={[tracker.x, tracker.y]}
              color={trackerColor}
              opacity={0.35}
              style="dashed"
              weight={1.2}
            />
            <Point x={tracker.x} y={tracker.y} color={trackerColor} opacity={0.18} svgCircleProps={{ r: 9 }} />
            <Point x={tracker.x} y={tracker.y} color={trackerColor} svgCircleProps={{ r: 4 }} />
            <Text
              x={tracker.x}
              y={tracker.y}
              attach={labelBelow ? 'n' : 's'}
              attachDistance={labelBelow ? 12 : 20}
              color={trackerColor}
              size={14}
              svgTextProps={{ textAnchor: 'middle' }}
            >
              ({formatNumber(tracker.x)}, {formatNumber(tracker.y)})
            </Text>
          </>
        ) : null}
      </Mafs>
    </div>
  );
}
