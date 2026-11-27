import type { CompileState, LocalCompilerPlotMath } from './compiler-services';
import type { ReportForNode } from './compiler-embedding';
import type { AttrMap, Entry } from './compiler-structure';
import { kernelRule, type KernelRule } from '../../contracts/component-kernel';
import {
  expressionEnv,
  fullInterpolation,
  meaningful,
  numberValue,
  suggestName,
  typeName,
} from './compiler-values';
import { dataTableMaxRows, fullExpressionAttribute, validateScopedExpression } from './compiler-expressions';
import {
  MAX_LOCAL_DATA_DOCUMENT_CELLS,
  MAX_LOCAL_DATA_DOCUMENT_ROWS,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_VALIDATIONS,
} from '../../contracts/limits';
import type { LocalNode, LocalValidation, LocalValueKind } from '../types';
import { parseValidationFields } from '../evaluation/validation';

/**
 * Validate every component declaring a `data-table` rule and sum document
 * budgets. Rows use the ordinary global environment; `key` and the child value
 * attribute additionally see the immutable row locals `item`/`index`.
 */
function attributeReports(state: CompileState, owner: LocalNode, reject?: (node: LocalNode) => void): CompileState {
  if (!reject) return state;
  return { ...state, report: (code, ...args) => {
    if (code.includes('budget')) state.report(code, ...args);
    else reject(owner);
  } };
}

export function validateDataTables(document: CompileState, reject?: (node: LocalNode) => void): void {
  const dataTables: [Entry, Extract<KernelRule, { kind: 'data-table' }>][] = [];
  for (const entry of document.entries) {
    const rule = kernelRule(entry.kernel, 'data-table');
    if (rule) dataTables.push([entry, rule]);
  }
  if (!dataTables.length) return;
  const env = expressionEnv(document);
  let totalRows = 0;
  let totalCells = 0;
  let rowsBudgetReported = false;
  let cellsBudgetReported = false;

  for (const [entry, rule] of dataTables) {
    const state = attributeReports(document, entry.node, reject);
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const columns = meaningful(entry.node.children)
      .filter((child) => (child.type === 'component' || child.type === 'hostComponent') && child.name === rule.child);
    const maxRows = dataTableMaxRows(attrs, rule);
    const columnLimit = Math.min(rule.maxColumns, MAX_LOCAL_DATA_TABLE_COLUMNS);
    const rowBudget = Math.min(rule.documentRows, MAX_LOCAL_DATA_DOCUMENT_ROWS);
    const cellBudget = Math.min(rule.documentCells, MAX_LOCAL_DATA_DOCUMENT_CELLS);
    const columnCount = Math.min(columns.length, columnLimit);
    totalRows += maxRows;
    totalCells += maxRows * columnCount;
    if (!rowsBudgetReported && totalRows > rowBudget) {
      rowsBudgetReported = true;
      state.report(
        'local.budget.data-table.rows',
        `The document's generated row budget exceeds ${rowBudget}; ${rule.maxRows} summed over every <${entry.name}> must stay within it.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }
    if (!cellsBudgetReported && totalCells > cellBudget) {
      cellsBudgetReported = true;
      state.report(
        'local.budget.data-table.cells',
        `The document's generated cell budget exceeds ${cellBudget}; ${rule.maxRows} multiplied by columns, summed over every <${entry.name}>, must stay within it.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }

    const rows = fullExpressionAttribute(attrs[rule.rows], 'local.data-table.rows', entry.name, rule.rows, state);
    let itemKind: LocalValueKind = 'string';
    let rowsInferred = false;
    if (rows) {
      const result = validateScopedExpression(state, rows.expression, rows.base, env, true);
      if (result?.kind === 'array') {
        itemKind = 'string';
        rowsInferred = true;
      } else if (result?.kind === 'number-array') {
        itemKind = 'number';
        rowsInferred = true;
      } else if (result && result.kind !== null) {
        state.report(
          'local.data-table.rows',
          `<${entry.name}> ${rule.rows} must evaluate to an array, but the expression evaluates to ${typeName(result.kind)}.`,
          rows.base,
        );
      }
    }

    const rowEnv: Record<string, LocalValueKind> = { ...env, item: itemKind, index: 'number' };
    const key = fullExpressionAttribute(attrs[rule.key], 'local.data-table.key', entry.name, rule.key, state);
    if (key) {
      const result = validateScopedExpression(state, key.expression, key.base, rowEnv, rowsInferred);
      if (result) {
        const dependencies = result.compiled.dependencies;
        if (!dependencies.includes('item')) {
          state.report('local.data-table.key', `<${entry.name}> key must depend on item.`, key.base);
        }
        for (const dependency of dependencies) {
          if (dependency === 'item') continue;
          if (dependency === 'index') {
            state.report('local.data-table.key', `<${entry.name}> key cannot depend on index; use a stable item identifier.`, key.base);
          } else if (Object.hasOwn(env, dependency)) {
            state.report(
              'local.data-table.key',
              `<${entry.name}> key cannot depend on global parameter "${dependency}"; it must be derived from item only.`,
              key.base,
            );
          }
        }
        if (result.kind !== null && result.kind !== 'string' && result.kind !== 'number') {
          state.report(
            'local.data-table.key',
            `<${entry.name}> key must evaluate to a string or number, got ${typeName(result.kind)}.`,
            key.base,
          );
        }
      }
    }

    for (const column of columns) {
      const columnAttrs = state.attrs.get(column.id) ?? {};
      const label = columnAttrs[rule.label];
      if (label && !String(label.value ?? '').trim()) {
        state.report('local.data-table.column', `<${rule.child}> ${rule.label} cannot be empty.`, label.offset);
      }
      const value = fullExpressionAttribute(columnAttrs[rule.childValue], 'local.data-table.value', rule.child, rule.childValue, state);
      if (!value) continue;
      const result = validateScopedExpression(state, value.expression, value.base, rowEnv, rowsInferred);
      if (result && (result.kind === 'array' || result.kind === 'number-array')) {
        state.report(
          'local.data-table.value',
          `<${rule.child}> ${rule.childValue} must be a scalar string, number, boolean or null, got ${typeName(result.kind)}.`,
          value.base,
        );
      }
    }
  }
}

/**
 * Validate `<validation>` rules and build their source-ordered metadata. The
 * tag itself stays in the tree so the renderer can place the hint; unlike
 * `<computed>`, it is not stripped.
 */
export function validateValidations(document: CompileState, reject?: (node: LocalNode) => void): LocalValidation[] {
  const validations: LocalValidation[] = [];
  let declarations = 0;
  let budgetReported = false;
  const writable = Object.keys(document.bindingKinds);
  const env = expressionEnv(document);

  for (const entry of document.entries) {
    const rule = kernelRule(entry.kernel, 'validation-rule');
    if (!rule) continue;
    declarations += 1;
    const node = entry.node;
    const maxRules = Math.min(rule.max, MAX_LOCAL_VALIDATIONS);
    if (declarations > maxRules) {
      if (!budgetReported) {
        budgetReported = true;
        document.report(
          'local.validation.budget',
          `The document declares more than ${maxRules} validation rules; rules in hidden regions count too.`,
          node.range.start,
          node.range.end,
        );
      }
      continue;
    }
    if (
      entry.parent
      && (entry.parent.kernel.form !== 'container' || kernelRule(entry.parent.kernel, 'data-table') !== undefined)
    ) {
      document.report(
        'local.validation.placement',
        `<${entry.name}> can appear in normal prose or a container, but not inside inline content or a data table.`,
        node.range.start,
        node.range.end,
      );
    }

    const state = attributeReports(document, node, reject);
    const attrs = state.attrs.get(node.id) ?? {};
    let expression = '';
    let dependencies: string[] = [];
    const when = attrs[rule.when];
    if (when) {
      const full = fullInterpolation(when.raw);
      if (!full) {
        state.report(
          'local.validation.when',
          `<${entry.name}> ${rule.when} must be exactly one {{ boolean }} interpolation.`,
          when.offset,
          when.offset + when.raw.length,
        );
      } else if (full.expression) {
        expression = full.expression;
        const result = validateScopedExpression(state, expression, when.offset + full.start, env, true);
        if (result) {
          dependencies = [...result.compiled.dependencies];
          if (result.kind !== null && result.kind !== 'boolean') {
            state.report(
              'local.type',
              `Expected a boolean here, but the expression evaluates to ${typeName(result.kind)}.`,
              when.offset + full.start,
            );
          }
        }
      }
    }

    const fieldsInfo = attrs[rule.fields];
    const fields = fieldsInfo ? parseValidationFields(fieldsInfo.raw) : [];
    if (fieldsInfo && !fields.length) {
      state.report(
        'local.validation.fields',
        `<${entry.name}> requires at least one field name.`,
        fieldsInfo.offset,
        fieldsInfo.offset + fieldsInfo.raw.length,
      );
    }
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field)) {
        state.report(
          'local.validation.fields',
          `Duplicate field "${field}" in <${entry.name}> fields.`,
          fieldsInfo?.offset ?? node.range.start,
        );
        continue;
      }
      seen.add(field);
      if (!Object.hasOwn(state.bindingKinds, field)) {
        const suggestion = suggestName(field, writable);
        state.report(
          'local.validation.fields',
          `Field "${field}" is not a public writable parameter.${suggestion ? ` Did you mean ${suggestion}?` : ''}`,
          fieldsInfo?.offset ?? node.range.start,
        );
      }
    }

    // The message is an ordinary text template: validateExpressions checks its
    // interpolations. Rules without a usable `when` are already rejected.
    if (!expression) continue;
    validations.push({
      nodeId: node.id,
      expression,
      dependencies,
      message: typeof attrs[rule.message]?.value === 'string' ? String(attrs[rule.message].value) : '',
      fields: [...seen],
      range: { ...node.range },
    });
  }
  return validations;
}

function plotSamples(entry: Entry, attrs: AttrMap, rule: Extract<KernelRule, { kind: 'plot-math' }>): number {
  const fallback = entry.kernel.props[rule.samples]?.default;
  const base = typeof fallback === 'number' ? fallback : 200;
  return numberValue(entry, attrs, rule.samplesAlias) ?? numberValue(entry, attrs, rule.samples) ?? base;
}

export function validatePlots(state: CompileState, reportForNode?: ReportForNode): void {
  const env = expressionEnv(state);
  let totalPoints = 0;
  let pointsBudgetExceeded = false;
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'plot-math');
    if (!rule) continue;
    const report = reportForNode?.(entry.node) ?? state.report;
    const plotMath = state.plotMath;
    if (!plotMath) {
      report(
        'local.capability.plot',
        { key: 'local.capability.plot' },
        entry.node.range.start,
        entry.node.range.end,
      );
      continue;
    }
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const mathNodes = meaningful(entry.node.children).filter((node) => node.type === 'math');
    const samples = plotSamples(entry, attrs, rule);
    // Manifest rule counts can never raise the kernel's hard budgets.
    const curveLimit = Math.min(rule.curves, MAX_LOCAL_PLOT_CURVES);
    const pointLimit = Math.min(rule.points, MAX_LOCAL_PLOT_POINTS);
    if (mathNodes.length > curveLimit) {
      state.report('local.budget.plot.curves', { key: 'local.budget.plot.curves', params: { limit: curveLimit, count: mathNodes.length } }, entry.node.range.start, entry.node.range.end);
    }
    const kinds = mathNodes.map((node) => plotMath.kind(node.value ?? ''));
    const requested = kinds.reduce(
      (sum, kind) => sum + (kind === 'implicit' ? plotMath.gridSize(samples) ** 2 : samples),
      0,
    );
    const nextTotal = totalPoints + requested;
    if (!pointsBudgetExceeded && nextTotal > pointLimit) {
      state.report('local.budget.plot.points', { key: 'local.budget.plot.points', params: { limit: pointLimit } }, entry.node.range.start, entry.node.range.end);
      pointsBudgetExceeded = true;
    }
    totalPoints = Math.min(pointLimit + 1, nextTotal);
    // Once the shapes are known to exceed budget, do not spend work compiling
    // an unbounded number of formulas. The document is already rejected.
    if (mathNodes.length > curveLimit || pointsBudgetExceeded) continue;
    for (let index = 0; index < mathNodes.length; index += 1) {
      const node = mathNodes[index];
      const recipe = (node.value ?? '').trim();
      if (kinds[index] === null) {
        report('local.math.formula', { key: 'local.math.formula.shape' }, node.range.start, node.range.end);
        continue;
      }
      let compiled: ReturnType<LocalCompilerPlotMath['compile']> | null = null;
      try {
        compiled = plotMath.compile(recipe);
      } catch (error) {
        report('local.math', {
            key: 'local.math.compute',
            params: {
              detail: error instanceof Error ? error.message : String(error),
              code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'latex-syntax',
              near: recipe.slice(0, 120),
            },
          }, node.range.start, node.range.end);
      }
      if (!compiled) continue;
      for (const dependency of compiled.dependencies) {
        if (dependency === 'x' || dependency === 'y' || (dependency === 't' && compiled.kind !== 'polar')) continue;
        if (!Object.hasOwn(env, dependency)) {
          report('local.math.binding', { key: 'local.math.binding.unknown', params: { name: dependency } }, node.range.start, node.range.end);
        } else if (env[dependency] !== 'number') {
          report('local.math.binding', { key: 'local.math.binding.type', params: { name: dependency, kind: typeName(env[dependency]) } }, node.range.start, node.range.end);
        }
      }
    }
  }
}
