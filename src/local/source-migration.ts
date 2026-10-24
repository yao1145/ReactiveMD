import { compileLocal } from './compiler';
import { diagnosticEnglish, localDiagnosticDetails } from './diagnostics';
import { MAX_LOCAL_DIAGNOSTICS } from './limits';
import { parseLocal, type ParsedLocal } from './parser';
import { LOCAL_SYNTAX_VERSION } from './version';
import type { Diagnostic, LocalNode, SourceRange } from './types';

export interface LocalSourceVersion {
  declaredVersion: string | null;
  effectiveVersion: string;
  supported: boolean;
  range: SourceRange | null;
  diagnostics: Diagnostic[];
}

export interface LocalUpgradeOptions {
  fromVersion?: string;
  /** Accept the documented UTF-16 -> code-point text-constraint change. */
  allowSemanticChanges?: boolean;
}

export interface LocalUpgradeReport {
  ok: boolean;
  fromVersion: string;
  toVersion: typeof LOCAL_SYNTAX_VERSION;
  needsMigration: boolean;
  diagnostics: Diagnostic[];
}

export interface LocalMigrationResult extends LocalUpgradeReport {
  source: string;
  changed: boolean;
  edits: { range: SourceRange; text: string }[];
}

const NEW_NAMES = new Set([
  'sum', 'average', 'minOf', 'maxOf', 'formatNumber', 'formatPercent', 'formatScientific',
  'formatCurrency', 'trim', 'lower', 'upper', 'startsWith', 'endsWith', 'replace', 'slice', 'dateCompare', 'dateDiff',
]);
const NEW_TAGS = new Set([
  'jump', 'anchor', 'text', 'section', 'multi-select', 'range-slider', 'coordinate', 'quiz', 'steps', 'step',
  'computed', 'const', 'validation', 'data-table', 'column',
]);
const CURRENT_DECLARATION = `<!-- reactive-md: ${LOCAL_SYNTAX_VERSION} -->`;

function versionInfo(parsed: ParsedLocal): LocalSourceVersion {
  const diagnostics = parsed.diagnostics.filter(item => item.code.startsWith('local.version.')
    || item.code === 'local.budget' || (item.code === 'local.parse' && !parsed.nodes.length));
  const declaredVersion = parsed.versionDeclaration?.version ?? null;
  return {
    declaredVersion,
    effectiveVersion: declaredVersion ?? LOCAL_SYNTAX_VERSION,
    supported: !diagnostics.some(item => item.severity === 'error'),
    range: parsed.versionDeclaration ? { ...parsed.versionDeclaration.range } : null,
    diagnostics,
  };
}

/** Inspect source metadata without constructing a runtime or evaluating declarations. */
export function inspectLocalSourceVersion(source: string): LocalSourceVersion {
  return versionInfo(parseLocal(source));
}

function issue(source: string, code: string, range: SourceRange, params?: Record<string, string>, severity: 'error' | 'warning' = 'error'): Diagnostic {
  const detail = localDiagnosticDetails(code, params);
  const prefix = source.slice(0, range.start);
  const lastLine = prefix.lastIndexOf('\n');
  return {
    code, severity, range: { ...range }, message: diagnosticEnglish(detail),
    line: prefix.split('\n').length, column: range.start - lastLine,
    messageKey: detail.key, ...(detail.params ? { params: detail.params } : {}),
  };
}

function check(source: string, options: LocalUpgradeOptions = {}): { report: LocalUpgradeReport; declaration: ParsedLocal['versionDeclaration'] } {
  const parsed = parseLocal(source);
  const info = versionInfo(parsed);
  const validOptions = options !== null && typeof options === 'object' && !Array.isArray(options);
  const from = validOptions ? options.fromVersion ?? info.effectiveVersion : info.effectiveVersion;
  const fromVersion = typeof from === 'string' ? from : '';
  const report: LocalUpgradeReport = {
    ok: false, fromVersion, toVersion: LOCAL_SYNTAX_VERSION,
    needsMigration: !parsed.versionDeclaration || fromVersion !== LOCAL_SYNTAX_VERSION,
    diagnostics: info.diagnostics.filter(item => item.code !== 'local.version.unsupported'),
  };
  const output = { report, declaration: parsed.versionDeclaration };
  // Source type and source-budget diagnostics take precedence over metadata work.
  if (typeof source !== 'string' || report.diagnostics.some(item => item.severity === 'error')) return output;
  const range = info.range ?? { start: 0, end: 0 };
  const append = (diagnostic: Diagnostic) => {
    if (report.diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) {
      if (diagnostic.severity === 'warning') return;
      let replace = report.diagnostics.length - 1;
      while (replace >= 0 && report.diagnostics[replace].severity !== 'warning') replace -= 1;
      if (replace < 0) return;
      report.diagnostics.splice(replace, 1);
    }
    report.diagnostics.push(diagnostic);
  };
  const add = (code: string, at: SourceRange, params?: Record<string, string>, severity?: 'error' | 'warning') => {
    append(issue(source, code, at, params, severity));
  };
  if (!validOptions || typeof from !== 'string' || !['local-draft-1', LOCAL_SYNTAX_VERSION].includes(fromVersion)
    || (options.allowSemanticChanges !== undefined && typeof options.allowSemanticChanges !== 'boolean')
    || (options.fromVersion !== undefined && info.declaredVersion !== null && fromVersion !== info.declaredVersion)) {
    add('local.upgrade.from-version', range, {
      from: fromVersion, detail: 'use local-draft-1 or local-draft-2 and match the source declaration',
    });
    return output;
  }

  // Replace metadata with equal-length whitespace so every reported body
  // position still addresses the original source. Only the caller's returned
  // edit changes the real document bytes.
  const body = parsed.versionDeclaration
    ? source.slice(0, range.start) + source.slice(range.start, range.end).replace(/[^\r\n]/g, ' ') + source.slice(range.end)
    : source;
  const bodyParsed = parsed.versionDeclaration ? parseLocal(body) : parsed;
  if (fromVersion === 'local-draft-1') {
    const visit = (nodes: LocalNode[]): void => {
      for (const node of nodes) {
        if (node.name && NEW_TAGS.has(node.name)) {
          add('local.upgrade.tag', node.range, { name: node.name });
          continue;
        }
        for (const name of ['bind', 'bind-start', 'bind-end', 'bind-x', 'bind-y']) {
          const binding = node.attrs?.[name];
          if (binding && NEW_NAMES.has(binding)) add('local.upgrade.reserved-binding', node.range, { name: binding });
        }
        if ((node.name === 'input' || node.name === 'textarea')
          && (node.attrs?.['max-length'] !== undefined || Number(node.attrs?.['min-length'] ?? 0) > 0)) {
          add('local.upgrade.text-length', node.range, undefined, options.allowSemanticChanges ? 'warning' : 'error');
        }
        const expressions = [
          ...(node.type === 'interpolation' ? [node.value ?? ''] : []),
          ...Object.values(node.attrs ?? {}).flatMap(value => [...value.matchAll(/\{\{([\s\S]*?)\}\}/g)].map(match => match[1])),
        ];
        for (const expression of expressions) {
          // Strings are literal data, so a string such as "sum([x])" must not
          // be classified as a newly active operation.
          const surface = expression.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '');
          if (surface.includes('[') || [...NEW_NAMES].some(name => new RegExp(`\\b${name}\\s*\\(`).test(surface))) {
            add('local.upgrade.expression', node.range);
          }
        }
        if (node.type !== 'fallback' && node.children) visit(node.children);
      }
    };
    visit(bodyParsed.nodes);
  }
  if (report.diagnostics.some(item => item.severity === 'error')) return output;
  const compiled = compileLocal(body);
  for (const diagnostic of compiled.diagnostics) {
    append(diagnostic);
  }
  if (!compiled.ok) return output;
  if (!parsed.versionDeclaration && report.diagnostics.length < MAX_LOCAL_DIAGNOSTICS) {
    add('local.upgrade.version-missing', { start: source.charCodeAt(0) === 0xfeff ? 1 : 0, end: source.charCodeAt(0) === 0xfeff ? 1 : 0 }, { version: LOCAL_SYNTAX_VERSION }, 'warning');
  }
  report.ok = true;
  return output;
}

/** Report blockers and declared compatibility exceptions before editing source. */
export function checkLocalUpgrade(source: string, options?: LocalUpgradeOptions): LocalUpgradeReport {
  return check(source, options).report;
}

/** Pure, idempotent metadata migration. Failure returns the original source. */
export function migrateLocalSource(source: string, options?: LocalUpgradeOptions): LocalMigrationResult {
  const { report, declaration } = check(source, options);
  const unchanged = { ...report, source, changed: false, edits: [] };
  if (!report.ok || !report.needsMigration) return unchanged;
  const offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const range = declaration?.range ?? { start: offset, end: offset };
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const text = declaration ? CURRENT_DECLARATION : `${CURRENT_DECLARATION}${newline}${newline}`;
  const migrated = source.slice(0, range.start) + text + source.slice(range.end);
  return { ...report, source: migrated, changed: migrated !== source, edits: [{ range: { ...range }, text }] };
}
