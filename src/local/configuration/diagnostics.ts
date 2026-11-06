import { MAX_LOCAL_DIAGNOSTIC_LENGTH } from './limits';
import type { Diagnostic, LocalDiagnosticParams } from '../contracts/types';
import {
  LOCAL_DIAGNOSTIC_MESSAGES,
  LOCAL_DIAGNOSTIC_TEMPLATE_ALIASES,
  type LocalDiagnosticMessageKey,
} from './diagnostic-messages';

/**
 * Central diagnostic message registry.
 *
 * `code` stays the coarse, machine-stable classification; `messageKey` selects
 * one English/Chinese template and `params` carries the values needed to render
 * it. Construction sites never repeat translations, and formatting never parses
 * an English sentence. Unknown host diagnostics keep their original message.
 */

export type LocalDiagnosticLocale = 'en' | 'zh';

/** Structured metadata attached by a reporting site. */
export interface LocalDiagnosticDetails {
  key: string;
  params?: LocalDiagnosticParams;
}

const MAX_DIAGNOSTIC_PARAMS = 16;
const MAX_DIAGNOSTIC_PARAM_LENGTH = 256;
const MAX_DIAGNOSTIC_PARAM_TOTAL = 2_000;

function boundedParam(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') {
    return value.length > MAX_DIAGNOSTIC_PARAM_LENGTH
      ? `${value.slice(0, MAX_DIAGNOSTIC_PARAM_LENGTH - 1)}…`
      : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return '';
  try {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > MAX_DIAGNOSTIC_PARAM_LENGTH
      ? `${text.slice(0, MAX_DIAGNOSTIC_PARAM_LENGTH - 1)}…`
      : text;
  } catch {
    return String(value).slice(0, MAX_DIAGNOSTIC_PARAM_LENGTH);
  }
}

/** Keep metadata JSON/worker-safe and bounded even if a caller passes junk. */
export function sanitizeDiagnosticParams(params: Record<string, unknown>): LocalDiagnosticParams | undefined {
  const entries = Object.entries(params);
  if (entries.length === 0) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  let total = 0;
  let count = 0;
  for (const [key, raw] of entries) {
    if (count >= MAX_DIAGNOSTIC_PARAMS) break;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value: string | number | boolean | null;
    try {
      value = boundedParam(raw);
    } catch {
      value = '';
    }
    const size = typeof value === 'string' ? value.length : String(value).length;
    if (total + size > MAX_DIAGNOSTIC_PARAM_TOTAL) break;
    result[key] = value;
    total += size;
    count += 1;
  }
  return count > 0 ? result : undefined;
}

/**
 * Build structured metadata at a reporting site. `key` is validated against the
 * template registry by tests, not at runtime: unknown host keys must still be
 * carried through so display code can fall back to `message`.
 */
export function localDiagnosticDetails(
  key: string,
  params?: Record<string, unknown> | LocalDiagnosticParams,
): LocalDiagnosticDetails {
  const safe = params ? sanitizeDiagnosticParams(params as Record<string, unknown>) : undefined;
  return safe ? { key, params: safe } : { key };
}




const LOCAL_PARSER_CODES = [
  'local.parse',
  'local.budget',
  'local.options.invalid',
  'local.theme.expression',
  'local.theme.name',
  'local.theme.attribute',
  'local.theme.malformed',
  'local.theme.duplicate',
  'local.theme.late',
  'local.theme.nested',
  'local.attribute',
  'local.attribute.name',
  'local.attribute.duplicate',
  'local.budget.name',
  'local.budget.math',
  'local.tag.unclosed',
  'local.tag.closing',
  'local.tag.name',
  'local.tag.mismatch',
  'local.tag.shape',
  'local.footnote.unsupported',
  'local.interpolation',
  'local.math.unclosed',
  'local.math.whitespace',
  'local.component.unknown',
  'local.html',
  'local.html.fallback',
  'local.html.table',
  'local.html.repair',
  'local.html.literal',
  'local.recovery.unclosed',
  'local.recovery.mismatch',
  'local.recovery.stray-close',
] as const;

const LOCAL_COMPILER_CODES = [
  'local.budget.data-table.cells',
  'local.budget.data-table.columns',
  'local.budget.data-table.rows',
  'local.computation.budget',
  'local.computation.const',
  'local.computation.cycle',
  'local.computation.duplicate',
  'local.computation.expression',
  'local.computation.name',
  'local.computation.placement',
  'local.computation.reserved',
  'local.computation.unknown',
  'local.external.placement',
  'local.external.name',
  'local.external.reserved',
  'local.external.duplicate',
  'local.external.conflict',
  'local.external.type',
  'local.host.structure',
  'local.computation.value',
  'local.data-table.column',
  'local.data-table.key',
  'local.data-table.rows',
  'local.data-table.value',
  'local.validation.budget',
  'local.validation.expression',
  'local.validation.failed',
  'local.validation.fields',
  'local.validation.placement',
  'local.validation.when',
  'local.parse',
  'local.legacy',
  'local.component.unknown',
  'local.host.attribute',
  'local.attribute.unknown',
  'local.budget.attribute',
  'local.attribute.color',
  'local.attribute.required',
  'local.label.required',
  'local.attribute.static',
  'local.expression.empty',
  'local.expression.invalid',
  'local.attribute.type',
  'local.attribute.range',
  'local.constraint',
  'local.selection.key',
  'local.structure.parent',
  'local.structure.children',
  'local.budget.array',
  'local.option.value',
  'local.tab.value',
  'local.step.value',
  'local.quiz.answer',
  'local.diagram.node',
  'local.diagram.edge',
  'local.checklist.body',
  'local.budget.identifier',
  'local.binding.name',
  'local.binding.reserved',
  'local.binding.type',
  'local.binding.exclusive',
  'local.binding.constraint',
  'local.binding.option',
  'local.initial.duplicate',
  'local.initial.length',
  'local.initial.email',
  'local.initial.range',
  'local.initial.option',
  'local.initial.type',
  'local.initial.date',
  'local.initial',
  'local.initial.step',
  'local.binding.unknown',
  'local.type',
  'local.interpolation',
  'local.attribute.interpolation',
  'local.anchor.id',
  'local.anchor.duplicate',
  'local.jump.target',
  'local.budget.plot.curves',
  'local.budget.plot.points',
  'local.math.formula',
  'local.math',
  'local.math.display',
  'local.math.binding',
  'local.table.header',
  'local.table.row',
  'local.chart.numeric',
  'local.chart.column',
  'local.chart.negative',
  'local.timeline.header',
  'local.timeline.value',
  'local.html.extended',
  'local.html.attribute',
  'local.html.unsafe-url',
  'local.html.capability',
  'local.capability.html',
  'local.capability.plot',
] as const;

const LOCAL_RUNTIME_CODES = ['local.runtime.binding', 'local.runtime.value', 'local.runtime.external'] as const;

const LOCAL_THEME_CODES = [
  'local.theme.name',
  'local.theme.missing',
  'local.theme.manifest',
  'local.theme.duplicate',
  'local.theme.protocol',
  'local.theme.modes',
] as const;

/** Public error codes thrown by `compileExpression`/`interpolate`. */
export const LOCAL_EXPRESSION_ERROR_CODES = [
  'expression-index',
  'expression-cycle',
  'expression-syntax',
  'expression-number',
  'expression-string',
  'expression-budget',
  'expression-assignment',
  'expression-property',
  'expression-empty',
  'expression-unknown-function',
  'expression-arity',
  'expression-forbidden-name',
  'expression-type',
  'expression-unknown-name',
  'expression-value',
  'expression-eval',
  'expression-domain',
  'expression-divide-by-zero',
  'expression-interpolation',
] as const;

export type LocalExpressionErrorCode = (typeof LOCAL_EXPRESSION_ERROR_CODES)[number];

/** Public error codes thrown by `compileLatex`/`samplePlot`. */
export const LOCAL_LATEX_ERROR_CODES = [
  'latex-budget',
  'latex-syntax',
  'latex-empty',
  'latex-relation',
  'latex-number',
  'latex-name',
  'latex-unsupported',
  'latex-variable',
  'latex-type',
  'latex-divide-by-zero',
  'latex-domain',
  'latex-undefined',
  'latex-plot-range',
  'latex-plot-samples',
] as const;

export type LocalLatexErrorCode = (typeof LOCAL_LATEX_ERROR_CODES)[number];

const LOCAL_STATIC_DIAGNOSTIC_CODES: readonly string[] = [
  'local.version.unsupported', 'local.version.malformed', 'local.version.duplicate', 'local.version.placement',
  'local.upgrade.from-version', 'local.upgrade.reserved-binding', 'local.upgrade.tag', 'local.upgrade.text-length',
  'local.upgrade.expression', 'local.upgrade.version-missing',
  ...LOCAL_PARSER_CODES,
  ...LOCAL_COMPILER_CODES,
  ...LOCAL_RUNTIME_CODES,
  ...LOCAL_THEME_CODES,
];

/**
 * Every diagnostic code the core can emit, including the raw public expression
 * and LaTeX error codes and the `local.expression.<code>` forms forwarded by
 * the compiler. Codes are never renamed or reused inside a 0.x minor version.
 */
export const LOCAL_DIAGNOSTIC_CODES: readonly string[] = Object.freeze(
  Array.from(new Set([
    ...LOCAL_STATIC_DIAGNOSTIC_CODES,
    ...LOCAL_EXPRESSION_ERROR_CODES,
    ...LOCAL_EXPRESSION_ERROR_CODES.map((code) => `local.expression.${code}`),
    ...LOCAL_LATEX_ERROR_CODES,
  ])),
);

/**
 * Message keys used on `Diagnostic.messageKey`. Most keys follow
 * `local.<diagnostic-code>.<variant>` so a reader can associate a template with
 * its machine code without a lookup table.
 */


export type LocalDiagnosticTemplateKey = keyof typeof LOCAL_DIAGNOSTIC_TEMPLATE_ALIASES;

/** Registered message keys, sorted for stable test snapshots. */
export const localDiagnosticTemplateKeys: readonly string[] = Object.freeze(
  [...Object.keys(LOCAL_DIAGNOSTIC_TEMPLATE_ALIASES), ...Object.keys(LOCAL_DIAGNOSTIC_MESSAGES).filter(key => key.startsWith('error.'))].sort(),
);

function templateKeyOf(key: string): LocalDiagnosticMessageKey | undefined {
  if (Object.hasOwn(LOCAL_DIAGNOSTIC_TEMPLATE_ALIASES, key)) {
    return LOCAL_DIAGNOSTIC_TEMPLATE_ALIASES[key as LocalDiagnosticTemplateKey];
  }
  if (Object.hasOwn(LOCAL_DIAGNOSTIC_MESSAGES, key)) {
    return key as LocalDiagnosticMessageKey;
  }
  return undefined;
}

/** Look up the raw template text, or `undefined` for an unknown host key. */
export function localDiagnosticTemplate(
  key: string,
  locale: LocalDiagnosticLocale = 'en',
): string | undefined {
  const semantic = templateKeyOf(key);
  if (!semantic) return undefined;
  return LOCAL_DIAGNOSTIC_MESSAGES[semantic][locale === 'zh' ? 'zh' : 'en'];
}

/** Whether a code belongs to the registered core diagnostic surface. */
export function isLocalDiagnosticCode(code: unknown): code is string {
  return typeof code === 'string' && LOCAL_DIAGNOSTIC_CODES.includes(code);
}

function renderTemplate(template: string, params: LocalDiagnosticParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

/** Render a registered template without constructing a full diagnostic. */
export function renderLocalDiagnostic(
  key: string,
  locale: LocalDiagnosticLocale = 'en',
  params?: LocalDiagnosticParams,
): string {
  const template = localDiagnosticTemplate(key, locale);
  return template === undefined ? '' : renderTemplate(template, params);
}

/** English text for `Diagnostic.message`; keep the field backwards compatible. */
export function diagnosticEnglish(detail: LocalDiagnosticDetails): string {
  return renderLocalDiagnostic(detail.key, 'en', detail.params);
}

/**
 * Format a diagnostic in the requested language. Known core diagnostics use
 * their registered template; host-supplied or unknown diagnostics keep the
 * original message. The result respects the existing UTF-16 message budget.
 */
export function formatLocalDiagnostic(
  diagnostic: Diagnostic,
  locale: LocalDiagnosticLocale = 'en',
): string {
  const key = typeof diagnostic.messageKey === 'string' ? diagnostic.messageKey : undefined;
  const template = key === undefined ? undefined : localDiagnosticTemplate(key, locale);
  let params = diagnostic.params;
  if (locale === 'zh' && params) {
    const semantic = key === undefined ? undefined : templateKeyOf(key);
    if (semantic === 'expression.error' || semantic === 'math.computeFailed') {
      const nested = typeof params.code === 'string' ? localDiagnosticTemplate(`error.${params.code}`, 'zh') : undefined;
      if (nested) {
        const context = typeof params.near === 'string' && params.near ? ` 相关源码：${params.near}` : '';
        params = { ...params, detail: nested + context };
      }
    } else if (semantic === 'runtime.budget' && typeof params.detailKey === 'string') {
      const nested = localDiagnosticTemplate(params.detailKey, 'zh');
      if (nested) params = { ...params, detail: renderTemplate(nested, params) };
    }
  }
  const text = template === undefined
    ? (typeof diagnostic.message === 'string' ? diagnostic.message : String(diagnostic.message ?? ''))
    : renderTemplate(template, params);
  const safe = typeof text === 'string' ? text : String(text ?? '');
  return safe.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
    ? `${safe.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
    : safe;
}
