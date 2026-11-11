import {
  useId,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { LocalComponentContext } from '../react/component-api';
import { useDefaultTheme } from '../react/default-theme';
import {
  StaticValue,
  PrintValue,
  FieldError,
  accentStyle,
  clamp,
  currentValue,
  localColor,
  numberAttr,
  numberConstraint,
  numericRange,
  slotNumber,
  snapToStep,
  textAttr,
  useComponentView,
  useDisabled,
  useResetToken,
  useSourceAttributes,
  useValidationField,
  useWriter,
} from '../react/component-utils';
import { Slider } from './uiarc/slider/slider';

/** Plain numeric text: no digit wheels, and no binary noise from repeated steps. */
function sliderNumber(value: number): string {
  return String(Number(value.toFixed(12)));
}

/** The legacy readout marker is kept so document contracts and print rules keep working. */
function SliderReadout({ value }: { value: string }) {
  return <span className="md-slider-value" aria-hidden="true">{value}</span>;
}

export function SliderView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const defaultTheme = useDefaultTheme();
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, mode, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Slider', '滑块'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const minRead = numberConstraint(context, 'min');
  const maxRead = numberConstraint(context, 'max');
  const min = minRead.present && !minRead.error ? minRead.value : 0;
  const max = maxRead.present && !maxRead.error ? maxRead.value : 100;
  const constraintError = minRead.error || maxRead.error;
  const step = numberAttr(context, 'step', 1);
  const stored = currentValue(context);
  const rawValue = typeof stored === 'number' && Number.isFinite(stored) ? stored : min;
  const value = Math.min(max, Math.max(min, rawValue));
  const storedProblem = typeof stored === 'number' && Number.isFinite(stored)
    ? (stored < min ? t(`Must be at least ${min}`, `不能小于 ${min}`)
      : stored > max ? t(`Must be at most ${max}`, `不能大于 ${max}`)
      : null)
    : null;
  const invalid = Boolean(validation.invalid || storedProblem || constraintError);

  if (mode === 'static') {
    return (
      <StaticValue
        className="md-slider local-slider"
        label={label}
        value={String(rawValue)}
      />
    );
  }

  if (defaultTheme) {
    return (
      <div
        className="md-control md-slider local-slider"
        style={accentStyle(localColor(content))}
        {...sourceAttrs}
        aria-invalid={invalid || undefined}
        aria-describedby={validation.describedBy}
      >
        <Slider
          label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="local-slider-arc"
          readout={<SliderReadout value={String(rawValue)} />}
          format={sliderNumber}
          invalid={invalid}
          describedBy={validation.describedBy}
          resetSignal={view.resetToken}
          onValueChange={(next) => {
            write(next);
          }}
        />
        {/* Keeps a native range element in the rendered document for hosts and
            tests that look for one; the UIArc thumb owns interaction. */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          data-rmd-native-proxy=""
          style={{ display: 'none' }}
          onChange={() => {}}
        />
        <PrintValue value={String(rawValue)} />
        <FieldError message={disabledInvalid || constraintError ? t('Cannot compute', '无法计算') : (error ?? storedProblem)} />
      </div>
    );
  }

  return (
    <div className="md-control md-slider local-slider" style={accentStyle(localColor(content))} {...sourceAttrs}>
      <label className="md-label" htmlFor={`${domId}-slider`}>
        <span>{label}</span>
        <span className="md-slider-value" aria-hidden="true">
          {rawValue}
        </span>
      </label>
      <input
        id={`${domId}-slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-invalid={validation.invalid || storedProblem || constraintError ? true : undefined}
        aria-describedby={validation.describedBy}
        onChange={(event: ChangeEvent<HTMLInputElement>) => write(Number(event.target.value))}
      />
      <PrintValue value={String(rawValue)} />
      <FieldError message={disabledInvalid || constraintError ? t('Cannot compute', '无法计算') : (error ?? storedProblem)} />
    </div>
  );
}


export function RangeSliderView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const defaultTheme = useDefaultTheme();
  const { content, mode, t } = view;
  const { write, writeMany, error, setError } = useWriter(context);
  const label = textAttr(context, 'label', t('Range', '范围'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const { min, max, step } = numericRange(context, 'min', 'max', 0, 100, 1);
  const steps = Math.floor((max - min) / step + 1e-9);
  const defaultStart = min;
  const defaultEnd = clamp(min + Math.max(0, steps) * step, min, max);
  let start = snapToStep(slotNumber(context, 'start', defaultStart), min, max, step);
  let end = snapToStep(slotNumber(context, 'end', defaultEnd), min, max, step);
  if (start > end) start = end;
  const [crossing, setCrossing] = useState<string | null>(null);
  const [draggingRange, setDraggingRange] = useState<'start' | 'end' | null>(null);
  useResetToken(context, () => {
    setCrossing(null);
    setError(null);
  });

  const startName = t('Start', '起点');
  const endName = t('End', '终点');
  const rangeSummary = `${startName}: ${start} · ${endName}: ${end}`;
  const rangeSpan = max - min;
  const startPercent = rangeSpan > 0 ? ((start - min) / rangeSpan) * 100 : 0;
  const endPercent = rangeSpan > 0 ? ((end - min) / rangeSpan) * 100 : 100;

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-range-slider"
        label={label}
        value={rangeSummary}
      />
    );
  }

  if (defaultTheme) {
    return (
      <div
        className="md-control local-range-slider"
        style={{
          ...(accentStyle(localColor(content)) ?? {}),
          '--local-range-start': startPercent,
          '--local-range-end': endPercent,
        } as CSSProperties}
        role="group"
        aria-label={label}
        aria-invalid={validation.invalid || undefined}
        aria-describedby={validation.describedBy}
      >
        <Slider
          label={label}
          value={[start, end] as [number, number]}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="local-slider-arc"
          thumbLabels={[`${label} ${startName}`, `${label} ${endName}`]}
          readout={<SliderReadout value={`${start} – ${end}`} />}
          format={sliderNumber}
          invalid={validation.invalid}
          describedBy={validation.describedBy}
          resetSignal={view.resetToken}
          onValueChange={(next) => {
            const [nextStart, nextEnd] = next;
            if (nextStart === start && nextEnd === end) return;
            writeMany({ start: nextStart, end: nextEnd });
          }}
        />
        {/* Native range proxies keep the slot labels and values discoverable to
            hosts and older stylesheet contracts; the UIArc thumbs handle input. */}
        <input
          type="range"
          className="local-range-input local-range-input-start"
          min={min}
          max={max}
          step={step}
          value={start}
          disabled={disabled}
          aria-label={`${label} ${startName}`}
          tabIndex={-1}
          aria-hidden="true"
          data-rmd-native-proxy=""
          style={{ display: 'none' }}
          onChange={() => {}}
        />
        <input
          type="range"
          className="local-range-input local-range-input-end"
          min={min}
          max={max}
          step={step}
          value={end}
          disabled={disabled}
          aria-label={`${label} ${endName}`}
          tabIndex={-1}
          aria-hidden="true"
          data-rmd-native-proxy=""
          style={{ display: 'none' }}
          onChange={() => {}}
        />
        <PrintValue value={rangeSummary} />
        <FieldError
          message={disabledInvalid ? t('Cannot compute', '无法计算') : (crossing ?? error)}
        />
      </div>
    );
  }

  const commit = (slot: 'start' | 'end', raw: number) => {
    const value = snapToStep(clamp(raw, min, max), min, max, step);
    if (slot === 'start' && value > end) {
      setCrossing(t('Start cannot exceed end', '起点不能超过终点'));
      return;
    }
    if (slot === 'end' && value < start) {
      setCrossing(t('End cannot be less than start', '终点不能小于起点'));
      return;
    }
    setCrossing(null);
    write(value, slot);
  };

  const rangeThumbSize = (element: HTMLElement) => {
    const size = Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--local-range-thumb'),
    );
    return Number.isFinite(size) && size > 0 ? size : 22;
  };

  const rangeValueAt = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const thumb = rangeThumbSize(element);
    const usable = Math.max(1, rect.width - thumb);
    const ratio = clamp((clientX - rect.left - thumb / 2) / usable, 0, 1);
    return min + ratio * (max - min);
  };

  const beginRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const value = rangeValueAt(event.currentTarget, event.clientX);
    const slot = Math.abs(value - start) <= Math.abs(value - end) ? 'start' : 'end';
    setDraggingRange(slot);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.parentElement
      ?.querySelector<HTMLInputElement>(
        slot === 'start' ? '.local-range-input-start' : '.local-range-input-end',
      )
      ?.focus({ preventScroll: true });
    commit(slot, value);
  };

  const moveRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !draggingRange) return;
    commit(draggingRange, rangeValueAt(event.currentTarget, event.clientX));
  };

  const endRangeDrag = () => setDraggingRange(null);

  return (
    <div
      className={`md-control local-range-slider${disabled ? ' is-disabled' : ''}`}
      style={{
        ...(accentStyle(localColor(content)) ?? {}),
        '--local-range-start': startPercent,
        '--local-range-end': endPercent,
      } as CSSProperties}
      role="group"
      aria-label={label}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <span className="md-label">{label}</span>
      <div className="local-range-track-wrap">
        <div className="local-range-bubble-row" aria-hidden="true">
          <span className="local-range-bubble local-range-bubble-start">{start}</span>
          <span className="local-range-bubble local-range-bubble-end">{end}</span>
        </div>
        <div className="local-range-track-area">
          <div className="local-range-rail" aria-hidden="true" />
          <div className="local-range-fill" aria-hidden="true" />
          <input
            type="range"
            className="local-range-input local-range-input-start"
            min={min}
            max={max}
            step={step}
            value={start}
            disabled={disabled}
            aria-label={`${label} ${t('Start', '起点')}`}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              commit('start', Number(event.target.value))
            }
          />
          <input
            type="range"
            className="local-range-input local-range-input-end"
            min={min}
            max={max}
            step={step}
            value={end}
            disabled={disabled}
            aria-label={`${label} ${t('End', '终点')}`}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              commit('end', Number(event.target.value))
            }
          />
          <div
            className="local-range-hit"
            aria-hidden="true"
            onPointerDown={beginRangeDrag}
            onPointerMove={moveRangeDrag}
            onPointerUp={endRangeDrag}
            onPointerCancel={endRangeDrag}
          />
        </div>
        <div className="local-range-bound-row" aria-hidden="true">
          <span className="local-range-bound local-range-bound-min">{min}</span>
          <span className="local-range-bound local-range-bound-max">{max}</span>
        </div>
      </div>
      <PrintValue value={rangeSummary} />
      <FieldError
        message={disabledInvalid ? t('Cannot compute', '无法计算') : (crossing ?? error)}
      />
    </div>
  );
}
