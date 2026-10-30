import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { LocalComponentContext, LocalComponentContent } from '../react/component-api';
import {
  StaticValue,
  PrintValue,
  FieldError,
  LocalError,
  MAX_LOCAL_STRING_LENGTH,
  accentStyle,
  boolAttr,
  clamp,
  countLocalCodePoints,
  currentValue,
  dateConstraint,
  displayValue,
  formatLocalDiagnostic,
  formatNumber,
  formatSeconds,
  inlinePlainText,
  isLocalEmail,
  localColor,
  numberAttr,
  numberConstraint,
  numericRange,
  optionLabel,
  rawAttr,
  readBooleanAttr,
  scalarText,
  slotNumber,
  snapToStep,
  staticText,
  textAttr,
  toneAttr,
  useComponentView,
  useDisabled,
  useResetToken,
  useSourceAttributes,
  useValidationField,
  useWriter,
} from '../react/component-utils';

/* ----------------------------------------------------------------- inputs */

export function textProblem(
  value: string,
  options: {
    required: boolean;
    minLength?: number;
    maxLength?: number;
    email?: boolean;
  },
  t: (en: string, zh: string) => string,
): string | null {
  if (options.required && value.length === 0) return t('This field is required', '请填写此字段');
  if (value.length > MAX_LOCAL_STRING_LENGTH) {
    return t(
      `At most ${MAX_LOCAL_STRING_LENGTH} characters`,
      `最多允许 ${MAX_LOCAL_STRING_LENGTH} 个字符`,
    );
  }
  if (options.email && value !== '' && !isLocalEmail(value)) {
    return t('Enter a valid email address', '请输入有效的邮箱地址');
  }
  const length = countLocalCodePoints(value);
  if (options.minLength !== undefined && options.minLength > 0 && value !== '' && length < options.minLength) {
    return t(`At least ${options.minLength} characters`, `至少需要 ${options.minLength} 个字符`);
  }
  if (options.maxLength !== undefined && options.maxLength >= 0 && length > options.maxLength) {
    return t(`At most ${options.maxLength} characters`, `最多允许 ${options.maxLength} 个字符`);
  }
  return null;
}

function lengthProp(context: LocalComponentContext, name: string): number | undefined {
  if (context.content.attrs[name] === undefined) return undefined;
  return Math.max(0, Math.floor(numberAttr(context, name, 0)));
}

export function InputView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, runtime, mode, t } = view;
  const { write, error, setError } = useWriter(context);
  const label = textAttr(context, 'label', content.name || t('Input', '输入'));
  const placeholder = textAttr(context, 'placeholder', '');
  const typeRaw = rawAttr(content, 'type') ?? 'text';
  const email = typeRaw === 'email';
  const requiredRead = readBooleanAttr(context, 'required', false);
  const required = requiredRead.ok ? requiredRead.value : false;
  const requiredDynamic = (rawAttr(content, 'required') ?? '').includes('{{');
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const minLength = lengthProp(context, 'min-length');
  const maxLength = lengthProp(context, 'max-length');
  const display = displayValue(currentValue(context));

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(context, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  if (mode === 'static') {
    return (
      <StaticValue
        className={`local-input${email ? ' local-input-email' : ''}`}
        label={label}
        value={staticText(display)}
      />
    );
  }

  const problemFor = (value: string) =>
    textProblem(value, { required, minLength, maxLength, email }, t);

  return (
    <div className={`md-control local-input${email ? ' local-input-email' : ''}`} {...sourceAttrs}>
      <label className="md-label" htmlFor={`${domId}-input`}>
        {label}
      </label>
      <input
        id={`${domId}-input`}
        className="md-text-input"
        type={email ? 'email' : 'text'}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={draftError || error || validation.invalid || !requiredRead.ok ? true : undefined}
        aria-describedby={validation.describedBy}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          const problem = problemFor(draft);
          setDraftError(problem);
          if (!problem && draft !== display) write(draft);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = event.target.value;
          setDraft(value);
          setError(null);
          if (touched) setDraftError(problemFor(value));
          if (!composing.current && problemFor(value) === null) write(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setDraft(value);
          if (touched) setDraftError(problemFor(value));
          if (problemFor(value) === null) write(value);
        }}
      />
      <PrintValue value={staticText(display)} />
      <FieldError message={disabledInvalid || !requiredRead.ok ? t('Cannot compute', '无法计算') : (draftError ?? error ?? (requiredDynamic && required && display === '' ? t('This field is required', '请填写此字段') : null))} />
    </div>
  );
}

export function TextareaView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, mode, t } = view;
  const { write, error, setError } = useWriter(context);
  const label = textAttr(context, 'label', t('Text', '文本'));
  const placeholder = textAttr(context, 'placeholder', '');
  const rows = Math.min(40, Math.max(1, Math.floor(numberAttr(context, 'rows', 4))));
  const requiredRead = readBooleanAttr(context, 'required', false);
  const required = requiredRead.ok ? requiredRead.value : false;
  const requiredDynamic = (rawAttr(content, 'required') ?? '').includes('{{');
  const { disabled, invalid: disabledInvalid } = useDisabled(context);
  const validation = useValidationField(context);
  const minLength = lengthProp(context, 'min-length');
  const maxLength = lengthProp(context, 'max-length');
  const display = displayValue(currentValue(context));

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(context, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-textarea"
        label={label}
        value={staticText(display)}
        multiline
      />
    );
  }

  const problemFor = (value: string) =>
    textProblem(value, { required, minLength, maxLength }, t);

  return (
    <div className="md-control local-textarea" {...sourceAttrs}>
      <label className="md-label" htmlFor={`${domId}-textarea`}>
        {label}
      </label>
      <textarea
        id={`${domId}-textarea`}
        className="md-text-input"
        rows={rows}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={draftError || error || validation.invalid || !requiredRead.ok ? true : undefined}
        aria-describedby={validation.describedBy}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          const problem = problemFor(draft);
          setDraftError(problem);
          if (!problem && draft !== display) write(draft);
        }}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          const value = event.target.value;
          setDraft(value);
          setError(null);
          if (touched) setDraftError(problemFor(value));
          if (!composing.current && problemFor(value) === null) write(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setDraft(value);
          if (touched) setDraftError(problemFor(value));
          if (problemFor(value) === null) write(value);
        }}
      />
      <PrintValue value={staticText(display)} block />
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

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(context, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
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
      <StaticValue
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
    return write(parsed.value);
  };

  return (
    <div className="md-control local-number" {...sourceAttrs}>
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

export function ToggleView(context: LocalComponentContext) {
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
    return <StaticValue className="md-toggle local-toggle" label={label} value={stateLabel} />;
  }

  return (
    <div className="md-control md-toggle local-toggle" style={accentStyle(localColor(content))} {...sourceAttrs}>
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
    return <StaticValue className="local-checkbox" label={label} value={stateLabel} />;
  }

  return (
    <div className="md-control local-checkbox" style={accentStyle(localColor(content))} {...sourceAttrs}>
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

export function DateView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const sourceAttrs = useSourceAttributes(context);
  const { content, mode, t } = view;
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
  const rangeProblem = value !== '' && ((min !== '' && value < min) || (max !== '' && value > max))
    ? t(`Date must be between ${min || '…'} and ${max || '…'}`, `日期必须在 ${min || '…'} 与 ${max || '…'} 之间`)
    : null;
  const missingProblem = required && value === '' && (touched || requiredDynamic)
    ? t('Select a date', '请选择日期')
    : null;
  const problem = missingProblem ?? rangeProblem;

  if (mode === 'static') {
    return <StaticValue className="local-date" label={label} value={staticText(value)} />;
  }

  return (
    <div className="md-control local-date" {...sourceAttrs}>
      <label className="md-label" htmlFor={`${domId}-date`}>
        {label}
      </label>
      <input
        id={`${domId}-date`}
        className="md-text-input"
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        aria-invalid={problem || error || validation.invalid || constraintError ? true : undefined}
        aria-describedby={validation.describedBy}
        onBlur={() => setTouched(true)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setTouched(true);
          write(event.target.value);
        }}
      />
      <PrintValue value={staticText(value)} />
      <FieldError message={disabledInvalid || constraintError ? t('Cannot compute', '无法计算') : (problem ?? error)} />
    </div>
  );
}

/* --------------------------------------------------------------- choices */

export function SelectView(context: LocalComponentContext) {
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
      <StaticValue
        className="md-select local-select"
        label={label}
        value={staticText(activeLabel)}
      />
    );
  }

  return (
    <div className="md-control md-select local-select" style={accentStyle(localColor(content))}>
      <label className="md-label" htmlFor={`${domId}-select`}>
        {label}
      </label>
      <select
        id={`${domId}-select`}
        className="md-select-input"
        value={active}
        disabled={disabled}
        aria-invalid={validation.invalid || undefined}
        aria-describedby={validation.describedBy}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => write(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.content.id} value={option.value}>
            {optionLabel(context, option) || option.value}
          </option>
        ))}
      </select>
      <PrintValue value={staticText(activeLabel)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

export function ChoicesView(context: LocalComponentContext) {
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

  if (options.length === 0) return <LocalError message={t('Missing options', '缺少选项')} />;

  if (mode === 'static') {
    return (
      <StaticValue
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
    <div className="md-control local-choices" style={accentStyle(localColor(content))}>
      <span className="md-label" id={`${domId}-choices-label`}>
        {label}
      </span>
      <div
        className="local-choice-list"
        role="radiogroup"
        aria-labelledby={`${domId}-choices-label`}
        aria-disabled={disabled || undefined}
        aria-invalid={validation.invalid || undefined}
        aria-describedby={validation.describedBy}
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
              onClick={() => write(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {view.renderInline(option.content.children, visible)}
            </button>
          );
        })}
      </div>
      <PrintValue value={staticText(selectedLabel)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

export function RadioGroupView(context: LocalComponentContext) {
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
      <StaticValue
        className="local-radio-group"
        label={label}
        value={staticText(selectedLabel)}
      />
    );
  }

  return (
    <fieldset
      className="md-control local-radio-group"
      style={accentStyle(localColor(content))}
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
        style={accentStyle(localColor(content))}
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
      style={accentStyle(localColor(content))}
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
    return <StaticValue className="local-counter" label={label} value={String(value)} />;
  }

  const change = (direction: 1 | -1) => {
    const next = Number((value + direction * safeStep).toFixed(12));
    write(next);
  };

  const reset = () => {
    runtime.reset(content);
  };

  return (
    <div
      className="local-counter"
      role="group"
      aria-label={label}
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
          {value}
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
      <StaticValue
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
    <div
      className="local-timer"
      role="group"
      aria-label={label}
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
      style={color ? ({ '--local-progress-color': color } as CSSProperties) : undefined}
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
      <StaticValue
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
      style={accentStyle(localColor(content))}
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

export function RangeSliderView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, mode, t } = view;
  const { write, error, setError } = useWriter(context);
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
  useResetToken(context, () => {
    setCrossing(null);
    setError(null);
  });

  const startName = t('Start', '起点');
  const endName = t('End', '终点');
  const rangeSummary = `${startName}: ${start} · ${endName}: ${end}`;

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-range-slider"
        label={label}
        value={rangeSummary}
      />
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

  return (
    <div
      className="md-control local-range-slider"
      style={accentStyle(localColor(content))}
      role="group"
      aria-label={label}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <span className="md-label">{label}</span>
      <div className="local-range-row">
        <span className="local-range-name">{t('Start', '起点')}</span>
        <input
          type="range"
          className="local-range-input"
          min={min}
          max={end}
          step={step}
          value={start}
          disabled={disabled}
          aria-label={`${label} ${t('Start', '起点')}`}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            commit('start', Number(event.target.value))
          }
        />
        <span className="local-range-value" aria-hidden="true">
          {start}
        </span>
      </div>
      <div className="local-range-row">
        <span className="local-range-name">{t('End', '终点')}</span>
        <input
          type="range"
          className="local-range-input"
          min={start}
          max={max}
          step={step}
          value={end}
          disabled={disabled}
          aria-label={`${label} ${t('End', '终点')}`}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            commit('end', Number(event.target.value))
          }
        />
        <span className="local-range-value" aria-hidden="true">
          {end}
        </span>
      </div>
      <PrintValue value={rangeSummary} />
      <FieldError
        message={disabledInvalid ? t('Cannot compute', '无法计算') : (crossing ?? error)}
      />
    </div>
  );
}

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
  useResetToken(context, () => setError(null));

  const coordinateSummary = `X: ${x} · Y: ${y}`;

  if (mode === 'static') {
    return (
      <StaticValue
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
    moveTo(nextX, nextY);
  };

  return (
    <div
      className="local-coordinate"
      style={accentStyle(localColor(content))}
      role="group"
      aria-label={label}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      <span className="md-label">{label}</span>
      <div className="local-coordinate-surface">
        <div
          ref={padRef}
          className="local-coordinate-pad"
          role="group"
          aria-label={t(`${label} drag area`, `${label} 拖拽区`)}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={onKeyDown}
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
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
          onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
            if (!dragging.current || disabled) return;
            const point = pointValue(event);
            if (point) moveTo(point.x, point.y);
          }}
          onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
            dragging.current = false;
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
              /* The pointer may already be released. */
            }
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        >
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

/* ------------------------------------------------------------------- quiz */

type QuizResult = 'correct' | 'incorrect' | 'incomplete';

export function QuizView(context: LocalComponentContext) {
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
      <div className="local-quiz local-static-quiz" role="group" aria-label={label}>
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
    <div className="local-quiz" role="group" aria-label={label}>
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
