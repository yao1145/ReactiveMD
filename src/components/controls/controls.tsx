import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
} from 'react';
import { animate, motion, useMotionValue, useReducedMotion, type MotionStyle } from 'motion/react';
import type { LocalComponentContext, LocalComponentContent } from '../../react/component-api';
import { DatePicker as UiarcDatePicker } from '../uiarc/date-picker/date-picker';
import { rmdMotion } from '../uiarc/rmd-motion';
import { Select as UiarcSelect } from '../uiarc/select/select';
import { useAuthorComponentRoot,
  StaticValue,
  PrintValue,
  FieldError,
  LocalError,
  accentStyle,
  currentValue,
  dateConstraint,
  displayValue,
  formatLocalDiagnostic,
  formatSeconds,
  inlinePlainText,
  localColor,
  numberAttr,
  numberConstraint,
  optionLabel,
  rawAttr,
  readBooleanAttr,
  staticText,
  textAttr,
  useComponentView,
  useDisabled,
  useResetToken,
  useSourceAttributes,
  useValidationField,
  useWriter,
} from '../../react/component-utils';
import { textProblem } from '../../react/field-validation';
import { useDraftField, useSubmissionField } from '../../react/use-draft-field';

/** Re-exported for compatibility; the pure validation lives in the React layer. */
export { textProblem };

/* ----------------------------------------------------------------- inputs */

function lengthProp(context: LocalComponentContext, name: string): number | undefined {
  if (context.content.attrs[name] === undefined) return undefined;
  return Math.max(0, Math.floor(numberAttr(context, name, 0)));
}

export function InputView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const label = textAttr(context, 'label', view.content.name || view.t('Input', '输入'));
  const email = (rawAttr(view.content, 'type') ?? 'text') === 'email';
  return <TextFieldView context={context} label={label} email={email} />;
}

export function TextareaView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const label = textAttr(context, 'label', view.t('Text', '文本'));
  const rows = Math.min(40, Math.max(1, Math.floor(numberAttr(context, 'rows', 4))));
  return <TextFieldView context={context} label={label} multiline rows={rows} />;
}

/**
 * Shared single-line and multiline text field. The public views only choose
 * the label fallback, email type and textarea rows; draft state, validation
 * and event timing are identical, so they live here once.
 */
function TextFieldView({
  context,
  label,
  email = false,
  multiline = false,
  rows,
}: {
  context: LocalComponentContext;
  label: string;
  email?: boolean;
  multiline?: boolean;
  rows?: number;
}) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, mode, t } = view;
  const { write, error, setError } = useWriter(context);
  const placeholder = textAttr(context, 'placeholder', '');
  const requiredRead = readBooleanAttr(context, 'required', false);
  const required = requiredRead.ok ? requiredRead.value : false;
  const requiredDynamic = (rawAttr(content, 'required') ?? '').includes('{{');
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const minLength = lengthProp(context, 'min-length');
  const maxLength = lengthProp(context, 'max-length');
  const display = displayValue(currentValue(context));
  const className = multiline ? 'local-textarea' : `local-input${email ? ' local-input-email' : ''}`;

  const {
    draft, setDraft,
    setFocused,
    touched, setTouched,
    draftError, setDraftError,
    composing, pendingDraft,
  } = useDraftField(context, display, setError);

  const problemFor = (value: string) =>
    textProblem(value, { required, minLength, maxLength, email }, t);
  useSubmissionField(context, (value) => {
    if (composing.current) return 'invalid';
    const current = displayValue(value);
    const candidate = pendingDraft.current ?? current;
    if (required && candidate === '') return 'required';
    if (candidate !== current) return 'invalid';
  });

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className={className}
        label={label}
        value={staticText(display)}
        multiline={multiline}
      />
    );
  }

  const commitDraft = (value: string): void => {
    if (write(value)) pendingDraft.current = undefined;
  };

  const fieldProps = {
    id: `${domId}-${multiline ? 'textarea' : 'input'}`,
    className: 'md-text-input',
    value: draft,
    placeholder: placeholder || undefined,
    disabled,
    'aria-required': required || undefined,
    'aria-invalid': draftError || error || validation.invalid || !requiredRead.ok ? true : undefined,
    'aria-describedby': validation.describedBy,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      setTouched(true);
      const problem = problemFor(draft);
      setDraftError(problem);
      if (!problem && draft !== display) commitDraft(draft);
    },
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setDraft(value);
      setError(null);
      if (touched) setDraftError(problemFor(value));
      if (!composing.current && problemFor(value) === null) commitDraft(value);
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false;
      const value = event.currentTarget.value;
      setDraft(value);
      if (touched) setDraftError(problemFor(value));
      if (problemFor(value) === null) commitDraft(value);
    },
  };

  return (
    <div {...authorRoot()}
      className={`md-control ${className}`}
      data-rmd-component={multiline ? 'textarea' : 'input'}
      {...sourceAttrs}
    >
      <label className="md-label" htmlFor={fieldProps.id}>
        {label}
      </label>
      {multiline
        ? <textarea {...fieldProps} rows={rows} />
        : <input {...fieldProps} type={email ? 'email' : 'text'} />}
      <PrintValue value={staticText(display)} block={multiline} />
      <FieldError message={disabledInvalid || !requiredRead.ok ? t('Cannot compute', '无法计算') : (draftError ?? error ?? (requiredDynamic && required && display === '' ? t('This field is required', '请填写此字段') : null))} />
    </div>
  );
}

type NumberDraft =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: number };

function parseNumberDraft(text: string): NumberDraft {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.') {
    return { kind: 'empty' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { kind: 'invalid' };
  return { kind: 'valid', value };
}

function numberProblem(
  value: number,
  min: number | undefined,
  max: number | undefined,
  step: number,
  t: (en: string, zh: string) => string,
): string | null {
  const tolerance = 1e-9 * Math.max(1, Math.abs(value));
  if (min !== undefined && value < min - tolerance) {
    return t(`Must be at least ${min}`, `不能小于 ${min}`);
  }
  if (max !== undefined && value > max + tolerance) {
    return t(`Must be at most ${max}`, `不能大于 ${max}`);
  }
  if (!Number.isFinite(step) || step <= 0) {
    return t('Step must be greater than 0', '步长必须大于 0');
  }
  const base = min ?? 0;
  const quotient = (value - base) / step;
  const nearest = Math.round(quotient);
  if (Math.abs(quotient - nearest) > 1e-9 * Math.max(1, Math.abs(quotient))) {
    return t(`Must be a multiple of ${step}`, `需要按步长 ${step} 取值`);
  }
  return null;
}

export function NumberView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { mode, t } = view;
  const { write, error, setError } = useWriter(context);
  const label = textAttr(context, 'label', t('Number', '数字'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const minRead = numberConstraint(context, 'min');
  const maxRead = numberConstraint(context, 'max');
  const min = minRead.present && !minRead.error ? minRead.value : undefined;
  const max = maxRead.present && !maxRead.error ? maxRead.value : undefined;
  const constraintError = minRead.error || maxRead.error;
  const step = numberAttr(context, 'step', 1);
  const stored = currentValue(context);
  const display = typeof stored === 'number' && Number.isFinite(stored) ? String(stored) : '';
  const storedProblem = typeof stored === 'number' && Number.isFinite(stored)
    ? numberProblem(stored, min, max, step, t)
    : null;

  const {
    draft, setDraft,
    focused, setFocused,
    touched, setTouched,
    draftError, setDraftError,
    composing, pendingDraft,
  } = useDraftField(context, display, setError);

  useSubmissionField(context, (value) => {
    if (composing.current) return 'invalid';
    const pending = pendingDraft.current;
    if (pending !== undefined) {
      const parsed = parseNumberDraft(pending);
      if (parsed.kind !== 'valid' || parsed.value !== value) return 'invalid';
    }
  });

  const hint = (
    <>
      {min !== undefined ? t(`Min ${min}`, `最小 ${min}`) : ''}
      {min !== undefined && max !== undefined ? ' · ' : ''}
      {max !== undefined ? t(`Max ${max}`, `最大 ${max}`) : ''}
      {step !== undefined ? t(` · Step ${step}`, ` · 步长 ${step}`) : ''}
    </>
  );

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className="local-number"
        label={label}
        value={staticText(display)}
        hint={hint}
      />
    );
  }

  const commitText = (text: string, reportProblem: boolean): boolean => {
    const parsed = parseNumberDraft(text);
    if (parsed.kind !== 'valid') {
      if (reportProblem) setDraftError(t('Enter a valid number', '请输入有效数字'));
      return false;
    }
    const problem = numberProblem(parsed.value, min, max, step, t);
    if (problem) {
      if (reportProblem) setDraftError(problem);
      return false;
    }
    setDraftError(null);
    const accepted = write(parsed.value);
    if (accepted) pendingDraft.current = undefined;
    return accepted;
  };

  return (
    <div {...authorRoot()} className="md-control local-number" data-rmd-component="number" {...sourceAttrs}>
      <label className="md-label" htmlFor={`${domId}-number`}>
        {label}
      </label>
      <input
        id={`${domId}-number`}
        className="md-text-input"
        type="text"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={draftError || error || validation.invalid || constraintError || (!focused && storedProblem) ? true : undefined}
        aria-describedby={validation.describedBy}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          commitText(draft, true);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const text = event.target.value;
          setDraft(text);
          setError(null);
          if (!composing.current) commitText(text, touched);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setDraft(event.currentTarget.value);
          commitText(event.currentTarget.value, touched);
        }}
      />
      <PrintValue value={staticText(display)} />
      {min !== undefined || max !== undefined || step !== undefined ? (
        <span className="md-hint">{hint}</span>
      ) : null}
      <FieldError message={disabledInvalid || constraintError ? t('Cannot compute', '无法计算') : (draftError ?? error ?? (!focused ? storedProblem : null))} />
    </div>
  );
}

export { SliderView, RangeSliderView } from './numeric-sliders';

export function ToggleView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, mode, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Toggle', '开关'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const checked = currentValue(context) === true;
  const stateLabel = checked ? t('On', '开') : t('Off', '关');

  if (mode === 'static') {
    return <StaticValue authorRoot={authorRoot()} className="md-toggle local-toggle" label={label} value={stateLabel} />;
  }

  return (
    <div
      className="md-control md-toggle local-toggle"
      {...authorRoot(accentStyle(localColor(content)))}
      data-rmd-component="toggle"
      {...sourceAttrs}
    >
      <label className="md-toggle-label" htmlFor={`${domId}-toggle`}>
        <input
          id={`${domId}-toggle`}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={validation.invalid || undefined}
          aria-describedby={validation.describedBy}
          onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <PrintValue value={stateLabel} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

export function CheckboxView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, mode, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Checkbox', '勾选'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const checked = currentValue(context) === true;
  const stateLabel = checked ? t('Checked', '已勾选') : t('Unchecked', '未勾选');

  if (mode === 'static') {
    return <StaticValue authorRoot={authorRoot()} className="local-checkbox" label={label} value={stateLabel} />;
  }

  return (
    <div
      className="md-control local-checkbox"
      {...authorRoot(accentStyle(localColor(content)))}
      data-rmd-component="checkbox"
      {...sourceAttrs}
    >
      <label className="md-toggle-label" htmlFor={`${domId}-checkbox`}>
        <input
          id={`${domId}-checkbox`}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={validation.invalid || undefined}
          aria-describedby={validation.describedBy}
          onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <PrintValue value={stateLabel} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

/** ISO date strings stay keyed to the reader's local calendar, never UTC. */
const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateValue(text: string): Date | undefined {
  const match = DATE_VALUE.exec(text);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || year > 9999) return undefined;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  // Date normalizes impossible days, so reject values that moved.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

function dateValueKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function DateView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, mode, locale, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Date', '日期'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const requiredRead = readBooleanAttr(context, 'required', false);
  const required = requiredRead.ok ? requiredRead.value : false;
  const requiredDynamic = (rawAttr(content, 'required') ?? '').includes('{{');
  const minRead = dateConstraint(context, 'min');
  const maxRead = dateConstraint(context, 'max');
  const min = minRead.present && !minRead.error ? minRead.value : '';
  const max = maxRead.present && !maxRead.error ? maxRead.value : '';
  const constraintError = minRead.error || maxRead.error || !requiredRead.ok;
  const stored = currentValue(context);
  const value = typeof stored === 'string' ? stored : '';
  const [touched, setTouched] = useState(false);
  useResetToken(context, () => setTouched(false));
  const rangeProblem = value !== '' && ((min !== '' && value < min) || (max !== '' && value > max))
    ? t(`Date must be between ${min || '…'} and ${max || '…'}`, `日期必须在 ${min || '…'} 与 ${max || '…'} 之间`)
    : null;
  const missingProblem = required && value === '' && (touched || requiredDynamic)
    ? t('Select a date', '请选择日期')
    : null;
  const problem = missingProblem ?? rangeProblem;

  if (mode === 'static') {
    return <StaticValue authorRoot={authorRoot()} className="local-date" label={label} value={staticText(value)} />;
  }

  const message = disabledInvalid || constraintError
    ? t('Cannot compute', '无法计算')
    : (problem ?? error);
  const errorId = message ? `${domId}-date-error` : undefined;
  return (
    <div {...authorRoot()}
      className="md-control local-date local-date-picker"
      data-rmd-part="control"
      {...sourceAttrs}
    >
      <UiarcDatePicker
        key={view.resetToken}
        id={`${domId}-date`}
        label={label}
        value={parseDateValue(value)}
        onChange={(date) => {
          setTouched(true);
          write(date ? dateValueKey(date) : '');
        }}
        onBlur={() => setTouched(true)}
        minDate={parseDateValue(min)}
        maxDate={parseDateValue(max)}
        locale={locale === 'zh' ? 'zh-CN' : 'en-US'}
        placeholder={t('Select a date', '请选择日期')}
        todayLabel={t('Today', '今天')}
        previousMonthLabel={t('Previous month', '上个月')}
        nextMonthLabel={t('Next month', '下个月')}
        clearLabel={t('Clear', '清除')}
        calendarLabel={t(`${label} calendar`, `${label} 日历`)}
        statusLabel={(formatted) => (formatted
          ? t(`Selected ${formatted}`, `已选择 ${formatted}`)
          : t('Choose a day', '请选择日期'))}
        showToday
        disabled={disabled}
        aria-required={required || undefined}
        invalid={Boolean(message) || validation.invalid}
        describedBy={[validation.describedBy, errorId].filter(Boolean).join(' ') || undefined}
      />
      <FieldError id={errorId} message={message} />
      <PrintValue value={staticText(value)} />
    </div>
  );
}

/* --------------------------------------------------------------- choices */

export function SelectView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Select', '选择'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const options = context.children.options();
  const stored = currentValue(context);
  const current = typeof stored === 'string' ? stored : '';
  const active = options.some((option) => option.value === current)
    ? current
    : options[0]?.value ?? '';
  const activeOption = options.find((option) => option.value === active);
  const activeLabel = activeOption ? optionLabel(context, activeOption) || active : '';

  if (options.length === 0) return <LocalError message={t('Missing options', '缺少选项')} />;

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className="md-select local-select"
        label={label}
        value={staticText(activeLabel)}
      />
    );
  }

  // Map every option to an internal key: empty values and authored strings
  // that resemble a sentinel remain distinct without changing stored values.
  const uiOptions = options.map((option, index) => ({
    value: `${domId}-option-${index}`,
    label: optionLabel(context, option) || option.value,
  }));
  const uiValue = uiOptions[Math.max(0, options.findIndex(option => option.value === active))]?.value ?? '';
  const message = disabledInvalid ? t('Cannot compute', '无法计算') : error;
  const errorId = message ? `${domId}-select-error` : undefined;
  return (
    <div
      className="md-control md-select local-select"
      {...authorRoot(accentStyle(localColor(content)))}
      data-rmd-part="control"
    >
      <UiarcSelect
        key={view.resetToken}
        id={`${domId}-select`}
        label={label}
        options={uiOptions}
        value={uiValue}
        placeholder={t('Select an option', '请选择选项')}
        onValueChange={(next) => {
          const index = uiOptions.findIndex((option) => option.value === next);
          const option = options[index];
          if (option) write(option.value);
        }}
        disabled={disabled}
        invalid={Boolean(message) || validation.invalid}
        describedBy={[validation.describedBy, errorId].filter(Boolean).join(' ') || undefined}
      />
      <FieldError id={errorId} message={message} />
      <PrintValue value={staticText(activeLabel)} />
    </div>
  );
}

export function ChoicesView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Options', '选项'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const options = context.children.options();
  const stored = currentValue(context);
  const current = typeof stored === 'string' ? stored : '';
  const selectedIndex = options.findIndex((option) => option.value === current);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const selectedLabel = selectedOption ? optionLabel(context, selectedOption) : '';
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const reduceMotion = useReducedMotion() ?? false;
  // Two to four choices share one sliding highlight; wider lists stay buttons.
  const segmented = options.length >= 2 && options.length <= 4;
  const choiceIndex = useMotionValue(activeIndex);

  useEffect(() => {
    const target = selectedIndex >= 0 ? selectedIndex : 0;
    if (!segmented || reduceMotion) {
      choiceIndex.jump(target);
      return;
    }
    const controls = animate(choiceIndex, target, rmdMotion.base);
    return () => controls.stop();
  }, [choiceIndex, reduceMotion, segmented, selectedIndex]);

  if (options.length === 0) return <LocalError message={t('Missing options', '缺少选项')} />;

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className="local-choices"
        label={label}
        value={staticText(selectedLabel)}
      />
    );
  }

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    write(option.value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div
      className="md-control local-choices"
      {...authorRoot(accentStyle(localColor(content)))}
      data-rmd-component="choices"
    >
      <span className="md-label" id={`${domId}-choices-label`}>
        {label}
      </span>
      <motion.div
        className="local-choice-list"
        role="radiogroup"
        aria-labelledby={`${domId}-choices-label`}
        aria-disabled={disabled || undefined}
        aria-invalid={validation.invalid || undefined}
        aria-describedby={validation.describedBy}
        data-rmd-choices={segmented ? 'uiarc' : undefined}
        data-rmd-part="list"
        data-rmd-segments={segmented ? '' : undefined}
        style={segmented ? ({ '--pu-choice-index': choiceIndex } as MotionStyle) : undefined}
      >
        {options.map((option, index) => {
          const selected = option.value === current;
          return (
            <button
              key={option.content.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              disabled={disabled}
              className={`local-choice${selected ? ' is-selected' : ''}`}
              data-rmd-appearance="custom"
              data-rmd-part="segment"
              onClick={() => write(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {view.renderInline(option.content.children, visible)}
            </button>
          );
        })}
      </motion.div>
      <PrintValue value={staticText(selectedLabel)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

export function RadioGroupView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Options', '选项'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const options = context.children.options();
  const stored = currentValue(context);
  const current = typeof stored === 'string' ? stored : '';
  const name = domId;
  const selectedOption = options.find((option) => option.value === current);
  const selectedLabel = selectedOption ? optionLabel(context, selectedOption) : '';

  if (options.length === 0) return <LocalError message={t('Missing options', '缺少选项')} />;

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className="local-radio-group"
        label={label}
        value={staticText(selectedLabel)}
      />
    );
  }

  return (
    <fieldset
      className="md-control local-radio-group"
      {...authorRoot(accentStyle(localColor(content)))}
      data-rmd-component="radio-group"
      disabled={disabled}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <legend className="md-label">{label}</legend>
      {options.map((option) => (
        <label className="local-radio-option" key={option.content.id}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={current === option.value}
            onChange={() => write(option.value)}
          />
          <span>{view.renderInline(option.content.children, visible)}</span>
        </label>
      ))}
      <PrintValue value={staticText(selectedLabel)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </fieldset>
  );
}

/* -------------------------------------------------------------- checklist */

interface ChecklistItem {
  id: string;
  content: LocalComponentContent;
}

function readChecklistItems(content: LocalComponentContent): ChecklistItem[] {
  const list = content.children.find((child) => child.kind === 'list');
  return (list?.children ?? [])
    .filter((child) => child.kind === 'listItem')
    .map((child, index) => ({ id: `item-${index + 1}`, content: child }));
}

export function ChecklistView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Checklist', '清单'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const items = readChecklistItems(content);
  const stored = currentValue(context);
  const selected = Array.isArray(stored)
    ? stored.filter((value): value is string => typeof value === 'string')
    : [];

  if (items.length === 0) {
    return <LocalError message={t('Checklist requires a task list', '清单需要任务列表')} />;
  }

  const stateFor = (checked: boolean) => (checked ? t('Checked', '已勾选') : t('Unchecked', '未勾选'));

  if (mode === 'static') {
    return (
      <div
        className="local-checklist local-static-checklist"
        {...authorRoot(accentStyle(localColor(content)))}
        role="group"
        aria-label={label}
      >
        <span className="md-label">{label}</span>
        <ul className="local-static-list">
          {items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <li key={item.id} className="local-static-list-item">
                <span className="local-static-state">{stateFor(checked)}</span>
                <span className={`local-static-item${checked ? ' is-checked' : ''}`}>
                  {view.renderInline(item.content.children, visible)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const toggle = (id: string, checked: boolean) => {
    const chosen = new Set(selected);
    if (checked) chosen.add(id);
    else chosen.delete(id);
    write(items.filter((item) => chosen.has(item.id)).map((item) => item.id));
  };

  return (
    <fieldset
      className="local-checklist"
      {...authorRoot(accentStyle(localColor(content)))}
      data-rmd-component="checklist"
      disabled={disabled}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <legend className="md-label">{label}</legend>
      {items.map((item) => {
        const checked = selected.includes(item.id);
        return (
          <div className="local-checklist-item" key={item.id}>
            <input
              id={`${domId}-${item.id}`}
              type="checkbox"
              checked={checked}
              onChange={(event) => toggle(item.id, event.target.checked)}
            />
            <label
              className={`local-checklist-text${checked ? ' is-checked' : ''}`}
              htmlFor={`${domId}-${item.id}`}
            >
              {view.renderInline(item.content.children, visible)}
            </label>
          </div>
        );
      })}
      <PrintValue
        block
        value={
          <ul className="local-static-list">
            {items.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <li key={item.id} className="local-static-list-item">
                  <span className="local-static-state">{stateFor(checked)}</span>
                  <span className={`local-static-item${checked ? ' is-checked' : ''}`}>
                    {inlinePlainText(context, item.content.children)}
                  </span>
                </li>
              );
            })}
          </ul>
        }
      />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </fieldset>
  );
}

/* ------------------------------------------------------- counter & timer */

export function CounterView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const { content, runtime, mode, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', t('Counter', '计数'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const min = numberAttr(context, 'min', 0);
  const maxPresent = rawAttr(content, 'max') !== undefined;
  const max = maxPresent ? numberAttr(context, 'max', 0) : undefined;
  const step = numberAttr(context, 'step', 1);
  const stored = currentValue(context);
  const value = typeof stored === 'number' && Number.isFinite(stored) ? stored : min;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const tolerance = 1e-9 * Math.max(1, Math.abs(value));
  const canDecrease = value - safeStep >= min - tolerance;
  const canIncrease = max === undefined || value + safeStep <= max + tolerance;

  if (mode === 'static') {
    return <StaticValue authorRoot={authorRoot()} className="local-counter" label={label} value={String(value)} />;
  }

  const change = (direction: 1 | -1) => {
    if (context.dispatchAuthorAction?.(direction === 1 ? 'increment' : 'decrement')) return;
    const next = Number((value + direction * safeStep).toFixed(12));
    write(next);
  };

  const reset = () => {
    if (context.dispatchAuthorAction?.('reset')) return;
    runtime.reset(content);
  };

  return (
    <div {...authorRoot()}
      className="local-counter"
      role="group"
      aria-label={label}
      data-rmd-component="counter"
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <span className="md-label">{label}</span>
      <div className="local-counter-row">
        <button
          type="button"
          className="md-button md-button-secondary local-counter-button"
          aria-label={`${label} ${t('decrease', '减少')}`}
          disabled={disabled || !canDecrease}
          onClick={() => change(-1)}
        >
          −
        </button>
        <span className="local-counter-value" aria-live="polite">
          <span key={value} className="local-counter-value-pop">{value}</span>
        </span>
        <button
          type="button"
          className="md-button md-button-secondary local-counter-button"
          aria-label={`${label} ${t('increase', '增加')}`}
          disabled={disabled || !canIncrease}
          onClick={() => change(1)}
        >
          +
        </button>
        <button
          type="button"
          className="md-button md-button-quiet local-counter-reset"
          disabled={disabled}
          onClick={reset}
        >
          {t('Reset', '恢复初值')}
        </button>
      </div>
      <PrintValue value={String(value)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

export function TimerView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const { content, runtime, mode, visible, locale, t } = view;
  const label = textAttr(context, 'label', t('Timer', '计时器'));
  const validation = useValidationField(context);
  const durationRaw = numberAttr(context, 'duration', 60);
  const duration = Math.floor(durationRaw);
  const stored = currentValue(context);
  const remaining = typeof stored === 'number' && Number.isFinite(stored)
    ? Math.max(0, Math.ceil(stored))
    : duration;

  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const deadline = useRef(0);
  const valueRef = useRef(remaining);
  valueRef.current = remaining;
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    (seconds: number) => {
      const diagnostics = runtime.set(content, seconds);
      if (diagnostics.length) {
        setError(diagnostics.map((item) => formatLocalDiagnostic(item, locale)).join('; '));
      }
    },
    [content, locale, runtime],
  );

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
      if (next !== valueRef.current) {
        valueRef.current = next;
        commit(next);
      }
      if (next <= 0) {
        setRunning(false);
        setCompleted(true);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running, commit]);

  useEffect(() => {
    if (visible || !running) return;
    const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
    valueRef.current = next;
    commit(next);
    setRunning(false);
  }, [visible, running, commit]);

  useResetToken(context, () => {
    setRunning(false);
    setCompleted(false);
    setError(null);
  });

  if (!Number.isFinite(durationRaw) || duration <= 0) {
    return (
      <LocalError
        message={t(
          'Timer duration must be a positive number of seconds',
          '计时时长必须是大于 0 的秒数',
        )}
      />
    );
  }

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className="local-timer"
        label={label}
        value={formatSeconds(remaining, t)}
      />
    );
  }

  const start = () => {
    if (running) return;
    const base = remaining > 0 ? remaining : duration;
    if (remaining <= 0) {
      valueRef.current = duration;
      commit(duration);
    }
    deadline.current = performance.now() + base * 1000;
    setCompleted(false);
    setError(null);
    setRunning(true);
  };

  const pause = () => {
    if (!running) return;
    const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
    valueRef.current = next;
    commit(next);
    setRunning(false);
  };

  const reset = () => {
    setRunning(false);
    setCompleted(false);
    setError(null);
    valueRef.current = duration;
    runtime.reset(content);
  };

  return (
    <div {...authorRoot()}
      className="local-timer"
      role="group"
      aria-label={label}
      data-rmd-component="timer"
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <div className="local-timer-head">
        <span className="md-label">{label}</span>
        <span
          className="local-timer-value"
          role="timer"
          aria-label={t(`${remaining} seconds remaining`, `剩余 ${remaining} 秒`)}
        >
          {formatSeconds(remaining, t)}
        </span>
      </div>
      <div className="local-timer-controls">
        <button
          type="button"
          className="md-button md-button-primary"
          onClick={start}
          disabled={running}
        >
          {t('Start', '开始')}
        </button>
        <button
          type="button"
          className="md-button md-button-secondary"
          onClick={pause}
          disabled={!running}
        >
          {t('Pause', '暂停')}
        </button>
        <button type="button" className="md-button md-button-quiet" onClick={reset}>
          {t('Reset', '重置')}
        </button>
      </div>
      <span className="local-timer-status" role="status" aria-live="polite">
        {completed
          ? t('Completed', '计时完成')
          : running
            ? t('Running', '计时中')
            : t('Paused', '已暂停')}
      </span>
      <PrintValue value={formatSeconds(remaining, t)} />
      <FieldError message={error} />
    </div>
  );
}

export function ProgressView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const { content, t } = view;
  const label = textAttr(context, 'label', t('Progress', '进度'));
  const max = numberAttr(context, 'max', 100);
  const raw = context.props.value;

  if (!Number.isFinite(max) || max <= 0) {
    return <LocalError message={t('Progress maximum must be positive', '进度上限必须是正数')} />;
  }
  if (raw === null || raw === undefined) return <LocalError message={t('Cannot compute', '无法计算')} />;
  const numeric = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN;
  if (!Number.isFinite(numeric)) return <LocalError message={t('Cannot compute', '无法计算')} />;
  if (numeric < 0 || numeric > max) {
    return (
      <LocalError
        message={t(
          `Progress value must be between 0 and ${max}`,
          `进度值需要在 0 到 ${max} 之间`,
        )}
      />
    );
  }
  const percent = (numeric / max) * 100;
  const color = localColor(content);

  return (
    <div
      className="local-progress"
      data-rmd-component="progress"
      {...authorRoot(color ? ({ '--local-progress-color': color } as CSSProperties) : undefined)}
    >
      <div className="local-progress-head">
        <span className="md-label">{label}</span>
        <span className="local-progress-value">{Math.round(percent)}%</span>
      </div>
      <div
        className="local-progress-track"
        role="progressbar"
        aria-label={label || t('Progress', '进度')}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={numeric}
      >
        <div className="local-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- controls */

export function MultiSelectView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const { write, error, setError } = useWriter(context);
  const label = textAttr(context, 'label', t('Multi select', '多选'));
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const options = context.children.options();
  const stored = currentValue(context);
  const selected = Array.isArray(stored)
    ? stored.filter((value): value is string => typeof value === 'string')
    : [];
  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => optionLabel(context, option) || option.value);
  const maxRaw = numberAttr(context, 'max-selected', options.length);
  const max = Number.isFinite(maxRaw) ? Math.max(0, Math.floor(maxRaw)) : options.length;
  const [query, setQuery] = useState('');
  useResetToken(context, () => {
    setQuery('');
    setError(null);
  });

  if (options.length === 0) {
    return <LocalError message={t('Missing options', '缺少选项')} />;
  }

  if (mode === 'static') {
    return (
      <StaticValue authorRoot={authorRoot()}
        className="local-multi-select"
        label={label}
        value={staticText(selectedLabels.join(', '))}
      />
    );
  }

  const chosen = new Set(selected);
  const atMax = selected.length >= max;
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? options.filter((option) => {
        const haystack = `${inlinePlainText(context, option.content.children)} ${option.value}`;
        return haystack.toLocaleLowerCase().includes(needle);
      })
    : options;

  const toggle = (value: string, checked: boolean) => {
    const next = new Set(chosen);
    if (checked) {
      if (!next.has(value) && next.size >= max) return;
      next.add(value);
    } else {
      next.delete(value);
    }
    write(options.filter((option) => next.has(option.value)).map((option) => option.value));
  };

  const clear = () => {
    setQuery('');
    if (selected.length > 0) write([]);
  };

  return (
    <fieldset
      className="local-multi-select"
      {...authorRoot(accentStyle(localColor(content)))}
      data-rmd-component="multi-select"
      disabled={disabled}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <legend className="md-label">{label}</legend>
      <div className="local-multi-toolbar">
        <input
          id={`${domId}-multi-search`}
          type="search"
          className="md-text-input local-multi-search"
          value={query}
          placeholder={t('Search options', '搜索选项')}
          aria-label={t(`Search ${label}`, `搜索${label}`)}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="md-button md-button-quiet local-multi-clear"
          onClick={clear}
        >
          {t('Clear', '清除')}
        </button>
      </div>
      <div className="local-multi-list" role="group" aria-label={label}>
        {matches.length === 0 ? (
          <span className="local-multi-empty">{t('No matching options', '没有匹配选项')}</span>
        ) : (
          matches.map((option) => {
            const checked = chosen.has(option.value);
            return (
              <label
                key={option.content.id}
                className={`local-multi-option${checked ? ' is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && atMax}
                  onChange={(event) => toggle(option.value, event.target.checked)}
                />
                <span>{view.renderInline(option.content.children, visible)}</span>
              </label>
            );
          })
        )}
      </div>
      <span className="local-multi-count" role="status" aria-live="polite">
        {t(`${selected.length} of ${max} selected`, `已选 ${selected.length}/${max}`)}
      </span>
      <PrintValue value={staticText(selectedLabels.join(', '))} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </fieldset>
  );
}

/* ------------------------------------------------------------------- quiz */

type QuizResult = 'correct' | 'incorrect' | 'incomplete';

export function QuizView(context: LocalComponentContext) {
  const authorRoot = useAuthorComponentRoot(context);
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const label = textAttr(context, 'label', t('Quiz', '测验'));
  const type = rawAttr(content, 'type') === 'number' ? 'number' : 'choice';
  const answer = (rawAttr(content, 'answer') ?? '').trim();
  const toleranceRaw = numberAttr(context, 'tolerance', 0);
  const tolerance = Number.isFinite(toleranceRaw) && toleranceRaw >= 0 ? toleranceRaw : 0;
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const options = context.children.options();
  const explanation = textAttr(context, 'explanation', '');
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<QuizResult | null>(null);

  useResetToken(context, () => {
    setDraft('');
    setResult(null);
  });

  const numericAnswer = type === 'number' ? Number(answer) : Number.NaN;
  if (type === 'number' && !Number.isFinite(numericAnswer)) {
    return <LocalError message={t('Quiz answer must be a number', '测验答案必须是数字')} />;
  }
  if (type === 'choice' && options.length === 0) {
    return <LocalError message={t('Missing options', '缺少选项')} />;
  }

  const optionLabels = options.map((option) => option.label || option.value);

  if (mode === 'static') {
    return (
      <div {...authorRoot()} className="local-quiz local-static-quiz" role="group" aria-label={label}>
        <span className="md-label">{label}</span>
        {type === 'choice' ? (
          <ul className="local-static-list local-static-quiz-options">
            {options.map((option) => (
              <li key={option.content.id} className="local-static-list-item">
                {view.renderInline(option.content.children, visible)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="local-static-value">{t('Numeric answer', '数字作答')}</span>
        )}
      </div>
    );
  }

  const check = () => {
    if (type === 'choice') {
      if (draft === '') {
        setResult('incomplete');
        return;
      }
      setResult(draft === answer ? 'correct' : 'incorrect');
      return;
    }
    const trimmed = draft.trim();
    const entered = trimmed === '' ? Number.NaN : Number(trimmed);
    if (!Number.isFinite(entered)) {
      setResult('incomplete');
      return;
    }
    setResult(Math.abs(entered - numericAnswer) <= tolerance ? 'correct' : 'incorrect');
  };

  const tryAgain = () => {
    setDraft('');
    setResult(null);
  };

  const feedback =
    result === null
      ? null
      : result === 'correct'
        ? `${t('Correct', '回答正确')}`
        : result === 'incorrect'
          ? `${t('Not quite', '回答不正确')}`
          : type === 'number'
            ? t('Enter a number first', '请先输入数字')
            : t('Choose an answer first', '请先选择答案');
  const feedbackClass =
    result === 'correct' ? ' is-correct' : result === 'incorrect' ? ' is-incorrect' : '';

  return (
    <div {...authorRoot()} className="local-quiz" role="group" aria-label={label} data-rmd-component="quiz">
      {type === 'choice' ? (
        <fieldset className="local-quiz-options" disabled={disabled}>
          <legend className="md-label">{label}</legend>
          {options.map((option) => (
            <label className="local-radio-option" key={option.content.id}>
              <input
                type="radio"
                name={`${domId}-quiz`}
                value={option.value}
                checked={draft === option.value}
                onChange={() => {
                  setDraft(option.value);
                  setResult(null);
                }}
              />
              <span>{view.renderInline(option.content.children, visible)}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="local-quiz-number">
          <label className="md-label" htmlFor={`${domId}-quiz`}>
            {label}
          </label>
          <input
            id={`${domId}-quiz`}
            className="md-text-input local-quiz-input"
            type="text"
            inputMode="decimal"
            value={draft}
            disabled={disabled}
            aria-label={label}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setDraft(event.target.value);
              setResult(null);
            }}
          />
        </div>
      )}
      <div className="local-quiz-actions">
        <button
          type="button"
          className="md-button md-button-primary local-quiz-check"
          disabled={disabled}
          onClick={check}
        >
          {t('Check answer', '检查答案')}
        </button>
        <button
          type="button"
          className="md-button md-button-secondary local-quiz-again"
          disabled={disabled}
          onClick={tryAgain}
        >
          {t('Try again', '再试一次')}
        </button>
      </div>
      <span
        className={`local-quiz-feedback${feedbackClass}`}
        role="status"
        aria-live="polite"
      >
        {feedback ? `${result === 'correct' ? '✓ ' : result === 'incorrect' ? '✗ ' : ''}${feedback}` : ''}
      </span>
      {result !== null && explanation ? (
        <div className="local-quiz-explanation">{explanation}</div>
      ) : null}
      <PrintValue
        block
        value={
          type === 'choice'
            ? `${feedback ? `${feedback} · ` : ''}${optionLabels.join(' · ')}`
            : feedback || t('No answer yet', '尚未作答')
        }
      />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : null} />
    </div>
  );
}
