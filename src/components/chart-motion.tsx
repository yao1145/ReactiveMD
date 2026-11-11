import { useCallback, useEffect, useRef } from 'react';
import type * as React from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';

/* Short geometry transitions only. Opacity and selection styling stay with the
   view so that a data update never replays an entrance. */
const GEOMETRY_TRANSITION = { duration: 0.2, ease: 'easeOut' } as const;

const TAU = Math.PI * 2;
const FULL_CIRCLE_EPSILON = 1e-4;
const EMPTY_SECTOR_EPSILON = 1e-7;

function useAnimatedNumber(target: number | null, reduced: boolean | null) {
  const value = useMotionValue(target ?? 0);

  useEffect(() => {
    if (target === null) return;
    if (reduced || value.get() === target) {
      value.set(target);
      return;
    }
    const controls = animate(value, target, GEOMETRY_TRANSITION);
    return () => controls.stop();
  }, [target, reduced, value]);

  return value;
}

/* Keep the caller's ref working while the component owns one for DOM events. */
function useElementRef<E extends Element>(external: React.Ref<E> | undefined) {
  const local = useRef<E | null>(null);
  const setRef = useCallback(
    (node: E | null) => {
      local.current = node;
      if (typeof external === 'function') return external(node);
      if (external) external.current = node;
    },
    [external],
  );
  return [local, setRef] as const;
}

/* React types onAnimationStart as a DOM animation event, while motion reserves
   the same prop name for its animation callbacks. Attach the DOM event directly
   so callers keep the standard SVG signature. */
function useNativeAnimationStart<E extends Element>(
  element: React.RefObject<E | null>,
  handler: React.AnimationEventHandler<E> | undefined,
) {
  useEffect(() => {
    const node = element.current;
    if (!node || !handler) return;
    const listener = (event: Event) => handler(event as unknown as React.AnimationEvent<E>);
    node.addEventListener('animationstart', listener);
    return () => node.removeEventListener('animationstart', listener);
  }, [element, handler]);
}

const PATH_TOKEN = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;
const PATH_COMMAND = /^[a-zA-Z]$/;

/* A path can only be interpolated while its command sequence and the number of
   coordinates per command stay the same. A missing value turns into a new
   subpath, so the signature changes and the next frame snaps instead of drawing
   a line across the gap. */
function pathTopology(d: string): string {
  const tokens = d.match(PATH_TOKEN) ?? [];
  let topology = '';
  let count = -1;
  for (const token of tokens) {
    if (PATH_COMMAND.test(token)) {
      if (count >= 0) topology += `:${count}`;
      topology += `|${token}`;
      count = 0;
    } else if (count >= 0) {
      count += 1;
    }
  }
  return count >= 0 ? `${topology}:${count}` : topology;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* Derive the arc from numeric angles and radii. Arc flags are integers by
   construction, and a full ring is drawn as two half arcs so the start and end
   points never collapse into a zero-length arc. */
function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const outer = Math.max(0, outerRadius);
  if (!(outer > 0)) return '';
  const inner = Math.min(Math.max(0, innerRadius), outer);
  const sweep = endAngle - startAngle;
  if (!Number.isFinite(sweep) || sweep <= EMPTY_SECTOR_EPSILON) return '';

  const delta = Math.min(sweep, TAU);
  const full = delta >= TAU - FULL_CIRCLE_EPSILON;
  const largeArc = delta > Math.PI ? 1 : 0;
  const point = (radius: number, angle: number) =>
    `${round(cx + radius * Math.cos(angle))} ${round(cy + radius * Math.sin(angle))}`;
  const outerText = round(outer);
  const outerStart = point(outer, startAngle);

  if (full) {
    const middle = startAngle + Math.PI;
    const outerMiddle = point(outer, middle);
    const ring = `M ${outerStart} A ${outerText} ${outerText} 0 0 1 ${outerMiddle} A ${outerText} ${outerText} 0 0 1 ${outerStart}`;
    if (inner <= 0) return `${ring} Z`;
    const innerText = round(inner);
    const innerStart = point(inner, startAngle);
    const innerMiddle = point(inner, middle);
    return `${ring} L ${innerStart} A ${innerText} ${innerText} 0 0 0 ${innerMiddle} A ${innerText} ${innerText} 0 0 0 ${innerStart} Z`;
  }

  const outerEnd = point(outer, startAngle + delta);
  if (inner <= 0) {
    return `M ${round(cx)} ${round(cy)} L ${outerStart} A ${outerText} ${outerText} 0 ${largeArc} 1 ${outerEnd} Z`;
  }
  const innerText = round(inner);
  const innerStart = point(inner, startAngle);
  const innerEnd = point(inner, startAngle + delta);
  return `M ${outerStart} A ${outerText} ${outerText} 0 ${largeArc} 1 ${outerEnd} L ${innerEnd} A ${innerText} ${innerText} 0 ${largeArc} 0 ${innerStart} Z`;
}

export function ChartMotionPath(props: React.SVGProps<SVGPathElement>) {
  const { d, ref, onAnimationStart, ...rest } = props;
  const reduced = useReducedMotion();
  const value = useMotionValue(d ?? '');
  const topology = useRef(d ? pathTopology(d) : '');
  const [element, setRef] = useElementRef(ref);

  useEffect(() => {
    if (d === undefined) return;
    if (!d) {
      topology.current = '';
      value.set('');
      return;
    }
    const next = pathTopology(d);
    const snap = next !== topology.current;
    topology.current = next;
    if (snap || reduced) {
      value.set(d);
      return;
    }
    const controls = animate(value, d, GEOMETRY_TRANSITION);
    return () => controls.stop();
  }, [d, reduced, value]);

  useNativeAnimationStart(element, onAnimationStart);

  return (
    <motion.path
      {...(rest as unknown as React.ComponentProps<typeof motion.path>)}
      ref={setRef}
      d={value}
      initial={false}
    />
  );
}

export function ChartMotionRect(props: React.SVGProps<SVGRectElement>) {
  const { x, y, width, height, ref, onAnimationStart, ...rest } = props;
  const reduced = useReducedMotion();
  const xValue = useAnimatedNumber(typeof x === 'number' ? x : null, reduced);
  const yValue = useAnimatedNumber(typeof y === 'number' ? y : null, reduced);
  const widthValue = useAnimatedNumber(typeof width === 'number' ? width : null, reduced);
  const heightValue = useAnimatedNumber(typeof height === 'number' ? height : null, reduced);
  const [element, setRef] = useElementRef(ref);

  useNativeAnimationStart(element, onAnimationStart);

  return (
    <motion.rect
      {...(rest as unknown as React.ComponentProps<typeof motion.rect>)}
      ref={setRef}
      x={typeof x === 'number' ? xValue : x}
      y={typeof y === 'number' ? yValue : y}
      width={typeof width === 'number' ? widthValue : width}
      height={typeof height === 'number' ? heightValue : height}
      initial={false}
    />
  );
}

export function ChartMotionCircle(props: React.SVGProps<SVGCircleElement>) {
  const { cx, cy, r, ref, onAnimationStart, ...rest } = props;
  const reduced = useReducedMotion();
  const cxValue = useAnimatedNumber(typeof cx === 'number' ? cx : null, reduced);
  const cyValue = useAnimatedNumber(typeof cy === 'number' ? cy : null, reduced);
  const rValue = useAnimatedNumber(typeof r === 'number' ? r : null, reduced);
  const [element, setRef] = useElementRef(ref);

  useNativeAnimationStart(element, onAnimationStart);

  return (
    <motion.circle
      {...(rest as unknown as React.ComponentProps<typeof motion.circle>)}
      ref={setRef}
      cx={typeof cx === 'number' ? cxValue : cx}
      cy={typeof cy === 'number' ? cyValue : cy}
      r={typeof r === 'number' ? rValue : r}
      initial={false}
    />
  );
}

export function ChartMotionArc(
  props: React.SVGProps<SVGPathElement> & {
    cx: number;
    cy: number;
    outerRadius: number;
    innerRadius: number;
    startAngle: number;
    endAngle: number;
  },
) {
  const { cx, cy, outerRadius, innerRadius, startAngle, endAngle, ref, onAnimationStart, ...rest } =
    props;
  const reduced = useReducedMotion();
  const cxValue = useMotionValue(cx);
  const cyValue = useMotionValue(cy);
  const outerValue = useMotionValue(outerRadius);
  const innerValue = useMotionValue(innerRadius);
  const startValue = useMotionValue(startAngle);
  const endValue = useMotionValue(endAngle);
  const d = useTransform(
    [cxValue, cyValue, outerValue, innerValue, startValue, endValue],
    ([centerX, centerY, outer, inner, start, end]: number[]) =>
      arcPath(centerX, centerY, outer, inner, start, end),
  );
  const [element, setRef] = useElementRef(ref);

  useEffect(() => {
    const targets = [
      [cxValue, cx],
      [cyValue, cy],
      [outerValue, outerRadius],
      [innerValue, innerRadius],
      [startValue, startAngle],
      [endValue, endAngle],
    ] as const;
    if (reduced) {
      for (const [value, target] of targets) value.set(target);
      return;
    }
    const controls = targets.map(([value, target]) => animate(value, target, GEOMETRY_TRANSITION));
    return () => controls.forEach((control) => control.stop());
  }, [
    cx,
    cy,
    outerRadius,
    innerRadius,
    startAngle,
    endAngle,
    reduced,
    cxValue,
    cyValue,
    outerValue,
    innerValue,
    startValue,
    endValue,
  ]);

  useNativeAnimationStart(element, onAnimationStart);

  return (
    <motion.path
      {...(rest as unknown as React.ComponentProps<typeof motion.path>)}
      ref={setRef}
      d={d}
      initial={false}
    />
  );
}
