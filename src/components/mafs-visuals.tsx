import {
  useEffect,
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

function gridSpacing(range: MafsRange, step: number): number {
  const span = range.max - range.min;
  if (!(span > 0) || !(step > 0)) return 1;
  return step * Math.max(1, Math.ceil(span / (step * 8)));
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
  const spacingX = gridSpacing(xRange, step);
  const spacingY = gridSpacing(yRange, step);
  const subdivisions = (spacing: number): number | false => {
    const count = Math.round(spacing / (step > 0 ? step : 1)) - 1;
    return count > 0 ? count : false;
  };
  const axisX = clamp(0, xRange.min, xRange.max);
  const axisY = clamp(0, yRange.min, yRange.max);

  const constrain = ([nextX, nextY]: [number, number]): [number, number] => {
    if (disabled) return [x, y];
    return [snap(nextX, xRange, step), snap(nextY, yRange, step)];
  };

  return (
    <Mafs
      height={420}
      width="auto"
      pan={false}
      zoom={false}
      preserveAspectRatio="contain"
      viewBox={{ x: [xRange.min, xRange.max], y: [yRange.min, yRange.max], padding: 0.14 }}
    >
      <Coordinates.Cartesian
        xAxis={{ lines: spacingX, subdivisions: subdivisions(spacingX), labels: axisLabel }}
        yAxis={{ lines: spacingY, subdivisions: subdivisions(spacingY), labels: axisLabel }}
      />
      <Line.Segment point1={[x, axisY]} point2={[x, y]} color={accent} opacity={0.5} style="dashed" weight={1.5} />
      <Line.Segment point1={[axisX, y]} point2={[x, y]} color={accent} opacity={0.5} style="dashed" weight={1.5} />
      <MovablePoint
        point={[x, y]}
        onMove={([nextX, nextY]) => onMove(nextX, nextY)}
        constrain={constrain}
        color={accent}
      />
      <Text x={x} y={y} attach="s" attachDistance={20} color={accent} size={17} svgTextProps={{ textAnchor: 'middle' }}>
        ({formatNumber(x)}, {formatNumber(y)})
      </Text>
      <Text x={xRange.max} y={axisY} attach="w" attachDistance={8} color="var(--coordinate-axis)" size={15}>
        x
      </Text>
      <Text x={axisX} y={yRange.max} attach="n" attachDistance={8} color="var(--coordinate-axis)" size={15}>
        y
      </Text>
    </Mafs>
  );
}

/* ------------------------------------------------------------------ plot */

export interface MafsPlotSurfaceProps {
  label: string;
  readoutId?: string;
  xDomain: MafsRange;
  yDomain: MafsRange;
  xTicks: number[];
  yTicks: number[];
  xLabel: string;
  yLabel: string;
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
  xTicks,
  yTicks,
  xLabel,
  yLabel,
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

  // The wrapper owns the keyboard readout; keep Mafs from adding a second tab stop.
  useEffect(() => {
    surfaceRef.current?.querySelector<HTMLElement>('.MafsView')?.setAttribute('tabindex', '-1');
  }, []);

  const xSpacing = xTicks.length > 1 ? Math.abs(xTicks[1] - xTicks[0]) : undefined;
  const ySpacing = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : undefined;

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
      onPointerDown={() => surfaceRef.current?.focus({ preventScroll: true })}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onKeyDownCapture={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <Mafs
        height={360}
        width="auto"
        pan
        zoom={{ min: 0.4, max: 4 }}
        preserveAspectRatio="contain"
        viewBox={{ x: [xDomain.min, xDomain.max], y: [yDomain.min, yDomain.max], padding: 0.08 }}
        onClick={handleClick}
      >
        <ViewSync viewRef={viewRef} />
        <Coordinates.Cartesian
          xAxis={xSpacing ? { lines: xSpacing, labels: axisLabel } : undefined}
          yAxis={ySpacing ? { lines: ySpacing, labels: axisLabel } : undefined}
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
            <Point x={tracker.x} y={tracker.y} color={trackerColor} opacity={0.18} svgCircleProps={{ r: 10 }} />
            <Point x={tracker.x} y={tracker.y} color={trackerColor} svgCircleProps={{ r: 4.5 }} />
            <Text
              x={tracker.x}
              y={tracker.y}
              attach={labelBelow ? 'n' : 's'}
              attachDistance={16}
              color={trackerColor}
              size={14}
              svgTextProps={{ textAnchor: 'middle' }}
            >
              ({formatNumber(tracker.x)}, {formatNumber(tracker.y)})
            </Text>
          </>
        ) : null}
        {xLabel ? (
          <Text x={xDomain.max} y={yDomain.min} attach="sw" attachDistance={10} color="var(--ink-muted)" size={12}>
            {xLabel}
          </Text>
        ) : null}
        {yLabel ? (
          <Text x={xDomain.min} y={yDomain.max} attach="ne" attachDistance={10} color="var(--ink-muted)" size={12}>
            {yLabel}
          </Text>
        ) : null}
      </Mafs>
    </div>
  );
}
