import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Diagnostic, LocalValue } from './component-primitives';
import type { LocalLocale, Localize } from './component-primitives';
import { formatLocalDiagnostic } from './component-primitives';
import { isLocalColor } from './component-primitives';
import type {
  LocalComponentContext,
  LocalComponentContent,
  LocalComponentHint,
  LocalComponentValue,
} from './component-api';
import { formatComponentNumber } from './component-api';

/* ---------------------------------------------------- public re-exports */

/**
 * Builtin modules import these from this public React entry instead of
 * reaching into kernel/local internals. The evaluators themselves stay
 * canonical kernel code; nothing is copied here.
 */
export * from './component-primitives';

/* ------------------------------------------------------------- view shape */

/** Convenience view over one public component context. */
export interface LocalComponentView {
  readonly context: LocalComponentContext;
  readonly content: LocalComponentContent;
  readonly props: Readonly<Record<string, LocalComponentValue>>;
  readonly runtime: LocalComponentContext['runtime'];
  readonly bindings: LocalComponentContext['bindings'];
  readonly children: LocalComponentContext['children'];
  readonly mode: LocalComponentContext['mode'];
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly disabledInvalid: boolean;
  readonly resetToken: number;
  readonly t: Localize;
  readonly locale: LocalLocale;
  readonly validation: LocalComponentContext['validation'];
  readonly source: LocalComponentContext['source'];
  readonly navigation: LocalComponentContext['navigation'];
  readonly url: LocalComponentContext['url'];
  readonly report: (diagnostics: Diagnostic[]) => void;
  render(items?: readonly LocalComponentContent[], visible?: boolean): ReactNode;
  renderInline(items?: readonly LocalComponentContent[], visible?: boolean): ReactNode;
}

export function useComponentView(context: LocalComponentContext): LocalComponentView {
  return {
    context,
    content: context.content,
    props: context.props,
    runtime: context.runtime,
    bindings: context.bindings,
    children: context.children,
    mode: context.mode,
    visible: context.visible,
    disabled: context.disabled,
    disabledInvalid: context.disabledInvalid,
    resetToken: context.resetToken,
    t: context.locale.t,
    locale: context.locale.locale,
    validation: context.validation,
    source: context.source,
    navigation: context.navigation,
    url: context.url,
    report: context.report,
    render: (items, visible) =>
      context.children.renderItems(items ?? context.children.items(), visible),
    renderInline: (items, visible) =>
      context.children.renderInlineItems(items ?? context.children.items(), visible),
  };
}

/* ---------------------------------------------------------------- writers */

export function useWriter(context: LocalComponentContext) {
  const [error, setError] = useState<string | null>(null);
  const { locale, report, bindings } = context;
  const localize = useCallback(
    (diagnostics: Diagnostic[]) =>
      diagnostics
        .map((item) => formatLocalDiagnostic(item, locale.locale))
        .join('; '),
    [locale.locale],
  );
  const write = useCallback(
    (value: LocalValue, slot = 'value'): boolean => {
      const result = bindings.set(slot, value as LocalComponentValue);
      if (!result.ok) {
        if (result.diagnostics.length > 0) {
          setError(localize(result.diagnostics));
          report(result.diagnostics);
        } else {
          setError(locale.t('Cannot write this value', '无法写入此值'));
        }
        return false;
      }
      setError(null);
      return true;
    },
    [bindings, locale, localize, report],
  );
  const writeMany = useCallback(
    (values: Readonly<Record<string, LocalValue>>): boolean => {
      const result = bindings.setMany(values as Readonly<Record<string, LocalComponentValue>>);
      if (!result.ok) {
        if (result.diagnostics.length > 0) {
          setError(localize(result.diagnostics));
          report(result.diagnostics);
        } else {
          setError(locale.t('Cannot write this value', '无法写入此值'));
        }
        return false;
      }
      setError(null);
      return true;
    },
    [bindings, locale, localize, report],
  );
  return { write, writeMany, error, setError };
}

export function useDisabled(context: LocalComponentContext): {
  disabled: boolean;
  invalid: boolean;
} {
  return { disabled: context.disabled, invalid: context.disabledInvalid };
}

export function useValidationField(
  context: LocalComponentContext,
  item?: LocalComponentContent,
) {
  return context.validation.fieldFor(item ?? context.content);
}

export function useValidationHint(
  context: LocalComponentContext,
  item?: LocalComponentContent,
): LocalComponentHint | null {
  return context.validation.hintFor(item ?? context.content);
}

export function useSourceAttributes(
  context: LocalComponentContext,
  item?: LocalComponentContent,
): Record<string, string> {
  return context.source.attributes(item);
}

export function useResetToken(context: LocalComponentContext, onReset: () => void): void {
  const token = context.resetToken;
  const previous = useRef(token);
  const handler = useRef(onReset);
  handler.current = onReset;
  useEffect(() => {
    if (previous.current !== token) {
      previous.current = token;
      handler.current();
    }
  }, [token]);
}

/* -------------------------------------------------------------- attributes */

export function rawAttr(
  content: LocalComponentContent,
  name: string,
): string | undefined {
  return content.attrs[name];
}

export function componentProp(
  context: LocalComponentContext,
  name: string,
): LocalComponentValue {
  return context.props[name] ?? null;
}

/** Resolved text prop with the legacy fallback and failure marker. */
export function textAttr(
  context: LocalComponentContext,
  name: string,
  fallback = '',
): string {
  const value = context.props[name];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (context.content.attrs[name] !== undefined) {
    return context.locale.t('Cannot compute', '无法计算');
  }
  return fallback;
}

export function numberAttr(
  context: LocalComponentContext,
  name: string,
  fallback: number,
): number {
  const value = context.props[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Text prop of a projected child component (e.g. tab/step/option labels). */
export function itemText(
  context: LocalComponentContext,
  item: LocalComponentContent,
  name: string,
  fallback = '',
): string {
  const value = item.props[name];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (item.attrs[name] !== undefined) {
    return context.locale.t('Cannot compute', '无法计算');
  }
  return fallback;
}

/** Boolean prop of a projected child component. */
export function itemBool(
  context: LocalComponentContext,
  item: LocalComponentContent,
  name: string,
  fallback = false,
): boolean {
  const value = item.props[name];
  return typeof value === 'boolean' ? value : fallback;
}


export type ConstraintRead<T> =
  | { present: false; error: false }
  | { present: true; error: true }
  | { present: true; error: false; value: T };

export function numberConstraint(
  context: LocalComponentContext,
  name: string,
): ConstraintRead<number> {
  if (context.content.attrs[name] === undefined) return { present: false, error: false };
  const value = context.props[name];
  return typeof value === 'number' && Number.isFinite(value)
    ? { present: true, error: false, value }
    : { present: true, error: true };
}

export function dateConstraint(
  context: LocalComponentContext,
  name: string,
): ConstraintRead<string> {
  if (context.content.attrs[name] === undefined) return { present: false, error: false };
  const value = context.props[name];
  return typeof value === 'string'
    ? { present: true, error: false, value }
    : { present: true, error: true };
}

export function readBooleanAttr(
  context: LocalComponentContext,
  name: string,
  fallback: boolean,
): { ok: true; value: boolean } | { ok: false } {
  const raw = context.content.attrs[name];
  if (raw === undefined) return { ok: true, value: fallback };
  const value = context.props[name];
  if (typeof value === 'boolean') return { ok: true, value };
  return { ok: false };
}

export function boolAttr(
  context: LocalComponentContext,
  name: string,
  fallback = false,
): boolean {
  const read = readBooleanAttr(context, name, fallback);
  return read.ok ? read.value : fallback;
}

export function toneAttr<T extends string>(
  context: LocalComponentContext,
  name: string,
  values: readonly T[],
  fallback: T,
): { tone: T; error: boolean } {
  if (context.content.attrs[name] === undefined) return { tone: fallback, error: false };
  const value = context.props[name];
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) {
    return { tone: value as T, error: false };
  }
    return { tone: fallback, error: /\{\{/.test(context.content.attrs[name] ?? '') };
}

export function localColor(content: LocalComponentContent): string | undefined {
  const raw = content.attrs.color;
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value !== '' && isLocalColor(value) ? value : undefined;
}

export function accentStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    '--local-accent': color,
    '--local-accent-soft': `color-mix(in srgb, ${color} 14%, var(--surface))`,
    '--local-accent-strong': color,
  } as CSSProperties;
}

/* ------------------------------------------------------------------ values */

export function scalarText(value: LocalValue | LocalComponentValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

export function displayValue(value: LocalComponentValue): string {
  return scalarText(value) ?? '';
}

export function currentValue(context: LocalComponentContext): LocalComponentValue {
  try {
    return context.runtime.get(context.content);
  } catch {
    return null;
  }
}

export function slotNumber(
  context: LocalComponentContext,
  slot: string,
  fallback: number,
): number {
  try {
    const value = context.runtime.get(context.content, slot);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snapToStep(value: number, min: number, max: number, step: number): number {
  const size = Number.isFinite(step) && step > 0 ? step : 1;
  const maximumSteps = Math.max(0, Math.floor((max - min) / size + 1e-9));
  const steps = Math.max(0, Math.min(maximumSteps, Math.round((value - min) / size)));
  const snapped = min + steps * size;
  return Number(snapped.toPrecision(15));
}

export function numericRange(
  context: LocalComponentContext,
  minName: string,
  maxName: string,
  minFallback: number,
  maxFallback: number,
  stepFallback = 1,
): { min: number; max: number; step: number } {
  let min = numberAttr(context, minName, minFallback);
  let max = numberAttr(context, maxName, maxFallback);
  if (min > max) [min, max] = [max, min];
  const rawStep = numberAttr(context, 'step', stepFallback);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
  return { min, max, step };
}

/* --------------------------------------------------------------- display */

export const EMPTY_STATIC_VALUE = '—';

export function staticText(value: string): string {
  return value.trim() === '' ? EMPTY_STATIC_VALUE : value;
}

export function StaticValue({
  label,
  value,
  hint,
  className = '',
  multiline = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
  multiline?: boolean;
}) {
  return (
    <div className={`md-control local-static-control ${className}`.trim()}>
      <span className="md-label">{label}</span>
      <span
        className={`local-static-value${multiline ? ' local-static-multiline' : ''}`}
        data-local-static-value=""
      >
        {value}
      </span>
      {hint ? <span className="md-hint">{hint}</span> : null}
    </div>
  );
}

export function PrintValue({ value, block = false }: { value: ReactNode; block?: boolean }) {
  if (block) {
    return (
      <div
        className="local-print-value local-print-block"
        aria-hidden="true"
        data-local-print-value=""
      >
        {value}
      </div>
    );
  }
  return (
    <span className="local-print-value" aria-hidden="true" data-local-print-value="">
      {value}
    </span>
  );
}

export function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <span className="field-error" role="alert">
      {message}
    </span>
  );
}

export function LocalError({ message }: { message?: string }) {
  return (
    <span className="local-error" role="alert">
      {message ?? 'Cannot compute'}
    </span>
  );
}

export function ToneProblem({ message }: { message: string }) {
  return (
    <span className="local-error local-tone-error" role="status">
      {message}
    </span>
  );
}

export function formatSeconds(seconds: number, t: Localize): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  if (minutes === 0) return t(`${rest} seconds`, `${rest} 秒`);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatNumber(value: number): string {
  return formatComponentNumber(value);
}

/* -------------------------------------------------------- inline text view */

/** Plain text of a projected inline child list (interpolations evaluated). */
export function inlinePlainText(
  context: LocalComponentContext,
  items: readonly LocalComponentContent[] | undefined,
  seen = 0,
): string {
  if (!items || seen > 64) return '';
  let text = '';
  for (const item of items) {
    switch (item.kind) {
      case 'text':
      case 'inlineCode':
      case 'fallback':
        text += item.text;
        break;
      case 'interpolation': {
        try {
          const value = context.runtime.evaluate(item.text);
          const scalar = scalarText(value);
          text += scalar ?? context.locale.t('Cannot compute', '无法计算');
        } catch {
          text += context.locale.t('Cannot compute', '无法计算');
        }
        break;
      }
      case 'break':
        text += ' ';
        break;
      default:
        text += inlinePlainText(context, item.children, seen + 1);
        break;
    }
  }
  return text;
}

export function optionLabel(
  context: LocalComponentContext,
  option: { content: LocalComponentContent },
): string {
  return inlinePlainText(context, option.content.children) || option.content.attrs.value || '';
}

export function renderInlineNodes(
  view: LocalComponentView,
  items: readonly LocalComponentContent[] | undefined,
  visible = view.visible,
): ReactNode {
  return view.renderInline(items, visible);
}
