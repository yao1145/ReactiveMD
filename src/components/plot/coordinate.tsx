import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { LocalComponentContext } from '../../react/component-api';
import { useAuthorComponentRoot,
  StaticValue,
  PrintValue,
  FieldError,
  accentStyle,
  clamp,
  localColor,
  numericRange,
  slotNumber,
  snapToStep,
  textAttr,
  useComponentView,
  useDisabled,
  useResetToken,
  useValidationField,
  useWriter,
} from '../../react/component-utils';
import { MafsCoordinatePlane } from './mafs-visuals';
import { useHydrated } from '../shared/use-hydrated';

interface NumberDraftFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onCommit: (value: number) => void;
  reset: number;
}

function NumberDraftField({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
  reset,
}: NumberDraftFieldProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    setDraft(String(value));
    setFocused(false);
  }, [reset]);

  useEffect(() => {
    if (last.current !== value) {
      last.current = value;
      if (!focused) setDraft(String(value));
    }
  }, [value, focused]);

  const parse = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return snapToStep(clamp(parsed, min, max), min, max, step);
  };

  return (
    <div className="local-number-field">
      <label className="md-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="md-text-input"
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const parsed = parse(draft);
          setDraft(String(parsed ?? value));
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parse(text);
          if (parsed !== null) onCommit(parsed);
        }}
      />
    </div>
  );
}

export function CoordinateView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, resetToken, t } = view;
  const { write, writeMany, error, setError } = useWriter(context);
  const label = textAttr(context, 'label', t('Coordinate', '坐标'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const xRange = numericRange(context, 'x-min', 'x-max', -5, 5, 1);
  const yRange = numericRange(context, 'y-min', 'y-max', -5, 5, 1);
  const defaultX = snapToStep(0, xRange.min, xRange.max, xRange.step);
  const defaultY = snapToStep(0, yRange.min, yRange.max, yRange.step);
  const x = snapToStep(slotNumber(context, 'x', defaultX), xRange.min, xRange.max, xRange.step);
  const y = snapToStep(slotNumber(context, 'y', defaultY), yRange.min, yRange.max, yRange.step);
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hydrated = useHydrated();
  // Mafs is client-only; the static and server passes keep the plain SVG plane
  // so the first client render matches the server markup.
  const useMafs = hydrated;
  useResetToken(context, () => setError(null));

  const coordinateSummary = `X: ${x} · Y: ${y}`;

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className="local-coordinate"
        label={label}
        value={coordinateSummary}
      />
    );
  }

  const projectX = (value: number) => xRange.max > xRange.min
    ? 40 + ((value - xRange.min) / (xRange.max - xRange.min)) * 320 : 200;
  const projectY = (value: number) => yRange.max > yRange.min
    ? 360 - ((value - yRange.min) / (yRange.max - yRange.min)) * 320 : 200;
  const pointX = projectX(x);
  const pointY = projectY(y);
  const axisX = projectX(clamp(0, xRange.min, xRange.max));
  const axisY = projectY(clamp(0, yRange.min, yRange.max));
  const gridValues = (range: typeof xRange) => {
    const stride = range.step * Math.max(1, Math.ceil((range.max - range.min) / (range.step * 10)));
    const count = Math.min(11, Math.floor((range.max - range.min) / stride) + 1);
    return Array.from({ length: count }, (_, index) => range.min + index * stride);
  };

  const pointValue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const ratioX = clamp(((event.clientX - rect.left) / rect.width - 0.1) / 0.8, 0, 1);
    const ratioY = clamp(((event.clientY - rect.top) / rect.height - 0.1) / 0.8, 0, 1);
    return {
      x: snapToStep(
        xRange.min + ratioX * (xRange.max - xRange.min),
        xRange.min,
        xRange.max,
        xRange.step,
      ),
      y: snapToStep(
        yRange.min + (1 - ratioY) * (yRange.max - yRange.min),
        yRange.min,
        yRange.max,
        yRange.step,
      ),
    };
  };

  const moveTo = (nextX: number, nextY: number) => {
    if (nextX === x && nextY === y) return;
    writeMany({ x: nextX, y: nextY });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let nextX = x;
    let nextY = y;
    switch (event.key) {
      case 'ArrowLeft':
        nextX = snapToStep(x - xRange.step, xRange.min, xRange.max, xRange.step);
        break;
      case 'ArrowRight':
        nextX = snapToStep(x + xRange.step, xRange.min, xRange.max, xRange.step);
        break;
      case 'ArrowDown':
        nextY = snapToStep(y - yRange.step, yRange.min, yRange.max, yRange.step);
        break;
      case 'ArrowUp':
        nextY = snapToStep(y + yRange.step, yRange.min, yRange.max, yRange.step);
        break;
      case 'Home':
        nextX = xRange.min;
        nextY = yRange.min;
        break;
      case 'End':
        nextX = snapToStep(xRange.max, xRange.min, xRange.max, xRange.step);
        nextY = snapToStep(yRange.max, yRange.min, yRange.max, yRange.step);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    moveTo(nextX, nextY);
  };

  const accent = 'var(--local-accent, var(--coordinate-point))';

  return (
    <div
      className="local-coordinate"
      {...authorRoot(accentStyle(localColor(content)))}
      role="group"
      aria-label={label}
      data-rmd-component="coordinate"
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <span className="md-label">{label}</span>
      <div className={`local-coordinate-surface${useMafs ? ' local-mafs-surface' : ''}`}>
        <div
          ref={padRef}
          className={`local-coordinate-pad${useMafs ? ' local-mafs-coordinate' : ''}`}
          role="group"
          aria-label={t(`${label} drag area`, `${label} 拖拽区`)}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onKeyDownCapture={onKeyDown}
          onPointerDown={useMafs ? undefined : (event: ReactPointerEvent<HTMLDivElement>) => {
            if (disabled) return;
            event.preventDefault();
            dragging.current = true;
            padRef.current?.focus({ preventScroll: true });
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* Pointer capture is not available in every environment. */
            }
            const point = pointValue(event);
            if (point) moveTo(point.x, point.y);
          }}
          onPointerMove={useMafs ? undefined : (event: ReactPointerEvent<HTMLDivElement>) => {
            if (!dragging.current || disabled) return;
            const point = pointValue(event);
            if (point) moveTo(point.x, point.y);
          }}
          onPointerUp={useMafs ? undefined : (event: ReactPointerEvent<HTMLDivElement>) => {
            dragging.current = false;
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
              /* The pointer may already be released. */
            }
          }}
          onPointerCancel={useMafs ? undefined : () => {
            dragging.current = false;
          }}
        >
          {useMafs ? (
            <MafsCoordinatePlane
              x={x}
              y={y}
              xRange={xRange}
              yRange={yRange}
              step={xRange.step}
              disabled={disabled}
              accent={accent}
              onMove={moveTo}
            />
          ) : (
            <svg className="local-coordinate-svg" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
              <defs>
                <marker id={`${domId}-coordinate-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" viewBox="0 0 8 8">
                  <path className="local-coordinate-arrow" d="M1 1 L6 4 L1 7" />
                </marker>
              </defs>
              <g className="local-coordinate-grid">
                <rect x="40" y="40" width="320" height="320" />
                {gridValues(xRange).map((value, index) => <line key={`x-${index}`} x1={projectX(value)} y1="40" x2={projectX(value)} y2="360" />)}
                {gridValues(yRange).map((value, index) => <line key={`y-${index}`} x1="40" y1={projectY(value)} x2="360" y2={projectY(value)} />)}
              </g>
              <g className="local-coordinate-axes">
                <line className="local-coordinate-horizontal" x1="26" y1={axisY} x2="372" y2={axisY} markerEnd={`url(#${domId}-coordinate-arrow)`} />
                <line className="local-coordinate-vertical" x1={axisX} y1="374" x2={axisX} y2="24" markerEnd={`url(#${domId}-coordinate-arrow)`} />
              </g>
              <g className="local-coordinate-axis-label">
                <text x="358" y={axisY - 14}>x</text>
                <text x={axisX + 12} y="40">y</text>
              </g>
              <g className="local-coordinate-projection">
                <line x1={pointX} y1={pointY} x2={pointX} y2={axisY} />
                <line x1={pointX} y1={pointY} x2={axisX} y2={pointY} />
              </g>
              <circle className="local-coordinate-dot" cx={pointX} cy={pointY} r="10" />
              <text className="local-coordinate-value" x={pointX} y={pointY > 330 ? pointY - 22 : pointY + 30}
                textAnchor={pointX < 80 ? 'start' : pointX > 320 ? 'end' : 'middle'}>{`(${x}, ${y})`}</text>
            </svg>
          )}
        </div>
        <span className="local-coordinate-caption">{t('Draggable coordinate plane', '可拖动的坐标平面')}</span>
      </div>
      <span className="md-hint local-hint">
        {t(
          'Arrow keys adjust the point; Home and End jump to the lower or upper bounds.',
          '方向键调整坐标；Home 和 End 跳到最小或最大边界。',
        )}
      </span>
      <div className="local-coordinate-fields">
        <NumberDraftField
          id={`${domId}-coordinate-x`}
          reset={resetToken}
          label={`${label} X`}
          value={x}
          min={xRange.min}
          max={xRange.max}
          step={xRange.step}
          disabled={disabled}
          onCommit={(value) => write(value, 'x')}
        />
        <NumberDraftField
          id={`${domId}-coordinate-y`}
          reset={resetToken}
          label={`${label} Y`}
          value={y}
          min={yRange.min}
          max={yRange.max}
          step={yRange.step}
          disabled={disabled}
          onCommit={(value) => write(value, 'y')}
        />
      </div>
      <PrintValue value={coordinateSummary} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}
