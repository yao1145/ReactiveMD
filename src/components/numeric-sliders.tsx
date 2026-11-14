import {
  useId,
  type CSSProperties,
} from 'react';
import type { LocalComponentContext } from '../react/component-api';
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

  return (
    <div
      className="md-control md-slider local-slider"
      style={accentStyle(localColor(content))}
      {...sourceAttrs}
      data-rmd-part="control"
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
        id={`${domId}-slider`}
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


export function RangeSliderView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, mode, t } = view;
  const { writeMany, error, setError } = useWriter(context);
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
  useResetToken(context, () => {
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

  return (
    <div
      className="md-control local-range-slider"
      style={{
        ...(accentStyle(localColor(content)) ?? {}),
        '--local-range-start': startPercent,
        '--local-range-end': endPercent,
      } as CSSProperties}
      data-rmd-part="control"
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
        message={disabledInvalid ? t('Cannot compute', '无法计算') : error}
      />
    </div>
  );
}
