import type { Diagnostic } from './types';
import { compileExpression, interpolate, type LocalExpression } from './expression';
import { localKey, type LocalBinding, type LocalDocument, type LocalNode, type LocalRuntime, type LocalSnapshot, type LocalValue } from './types';

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const EPSILON = 1e-9;

function cloneValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? [...value] : value;
}

function valuesEqual(a: LocalValue | undefined, b: LocalValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => entry === b[index]);
  }
  return a === b;
}

function isValidDate(value: string): boolean {
  if (value === '') return true;
  const match = DATE_TEXT.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function onStep(value: number, base: number, step: number): boolean {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) <= EPSILON * Math.max(1, Math.abs(quotient));
}

function freezeState(state: Record<string, LocalValue>): Readonly<Record<string, LocalValue>> {
  for (const [key, value] of Object.entries(state)) {
    if (Array.isArray(value)) state[key] = Object.freeze([...value]) as unknown as LocalValue;
  }
  return Object.freeze(state);
}

function diagnosticFor(document: LocalDocument, node: LocalNode, code: string, message: string): Diagnostic {
  const start = Math.max(0, Math.min(document.source.length, node.range.start));
  const prefix = document.source.slice(0, start).split('\n');
  return {
    code,
    message,
    severity: 'error',
    range: { start, end: Math.max(start + 1, Math.min(document.source.length, node.range.end)) },
    line: prefix.length,
    column: (prefix.at(-1) ?? '').length + 1,
  };
}

function rawAttr(node: LocalNode, name: string): string | undefined {
  return node.attrs?.[name];
}

function staticBoolean(node: LocalNode, name: string): boolean | undefined {
  const raw = rawAttr(node, name);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function staticNumber(node: LocalNode, name: string): number | undefined {
  const raw = rawAttr(node, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function codePointLength(value: string): number {
  return value.length;
}

type ValidationResult = { ok: true; value: LocalValue; message?: undefined } | { ok: false; message: string };

function invalid(message: string): ValidationResult {
  return { ok: false, message };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateValue(binding: LocalBinding, node: LocalNode, value: LocalValue): ValidationResult {
  switch (binding.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid(`参数“${binding.name}”需要有限数字。`);
      }
      if (binding.min !== undefined && value < binding.min) {
        return invalid(`参数“${binding.name}”不能小于 ${binding.min}。`);
      }
      if (binding.max !== undefined && value > binding.max) {
        return invalid(`参数“${binding.name}”不能大于 ${binding.max}。`);
      }
      const step = binding.step ?? 1;
      const base = binding.min ?? 0;
      if (step > 0 && !onStep(value, base, step)) {
        return invalid(`参数“${binding.name}”必须落在步长 ${step} 上（以 ${base} 为基点）。`);
      }
      return { ok: true, value };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : invalid(`参数“${binding.name}”需要布尔值。`);
    case 'string': {
      if (typeof value !== 'string') return invalid(`参数“${binding.name}”需要字符串。`);
      if (node.name === 'date') {
        if (!isValidDate(value)) return invalid('日期必须是有效的 YYYY-MM-DD，或空字符串。');
        if (value === '' && staticBoolean(node, 'required') === true) {
          return invalid('该日期为必填项。');
        }
        const min = rawAttr(node, 'min');
        const max = rawAttr(node, 'max');
        if (value !== '' && min && value < min) return invalid(`日期不能早于 ${min}。`);
        if (value !== '' && max && value > max) return invalid(`日期不能晚于 ${max}。`);
        return { ok: true, value };
      }
      if (node.name === 'input' || node.name === 'textarea') {
        const length = codePointLength(value);
        if (value === '' && staticBoolean(node, 'required') === true) {
          return invalid('该字段为必填项。');
        }
        const minLength = staticNumber(node, 'min-length');
        const maxLength = staticNumber(node, 'max-length');
        if (minLength !== undefined && minLength > 0 && value !== '' && length < minLength) {
          return invalid(`至少需要 ${minLength} 个字符。`);
        }
        if (maxLength !== undefined && length > maxLength) {
          return invalid(`最多允许 ${maxLength} 个字符。`);
        }
        if (node.name === 'input' && rawAttr(node, 'type') === 'email' && value !== '' && !EMAIL_PATTERN.test(value)) {
          return invalid('请输入有效的邮箱地址。');
        }
      }
      if (binding.options?.length && !binding.options.includes(value)) {
        return invalid(`值“${value}”不在可用选项中：${binding.options.join('、')}。`);
      }
      return { ok: true, value };
    }
    case 'array': {
      if (!Array.isArray(value)) return invalid(`参数“${binding.name}”需要字符串数组。`);
      const chosen = new Set<string>();
      for (const entry of value) {
        if (typeof entry !== 'string') return invalid(`参数“${binding.name}”的成员必须是字符串。`);
        if (binding.options && !binding.options.includes(entry)) {
          return invalid(`清单条目“${entry}”不存在。`);
        }
        chosen.add(entry);
      }
      const ordered = binding.options
        ? binding.options.filter((id) => chosen.has(id))
        : [...chosen];
      return { ok: true, value: ordered };
    }
    case 'null':
      return { ok: true, value };
  }
  return invalid(`参数“${binding.name}”的值类型不受支持。`);
}

export function createLocalRuntime(document: LocalDocument): LocalRuntime {
  if (!document || document.syntax !== 'local') {
    throw new Error('createLocalRuntime 需要本地交互文档。');
  }

  const nodeIndex = new Map<string, LocalNode>();
  const collectNodes = (nodes: LocalNode[]): void => {
    for (const node of nodes) {
      nodeIndex.set(node.id, node);
      if (node.children) collectNodes(node.children);
    }
  };
  collectNodes(document.nodes);

  const initial: Record<string, LocalValue> = {};
  for (const [key, binding] of Object.entries(document.bindings)) initial[key] = cloneValue(binding.initial);

  let state: Record<string, LocalValue> = initial;
  let revision = 0;
  let snapshot: LocalSnapshot = { revision, state: freezeState({ ...state }) };
  let disposed = false;
  const listeners = new Set<() => void>();
  const tokens = new Map<string, number>();
  const expressions = new Map<string, LocalExpression>();

  const ensure = (): void => {
    if (disposed) throw new Error('本地交互运行时已销毁。');
  };

  const commit = (next: Record<string, LocalValue>): void => {
    state = next;
    revision += 1;
    snapshot = { revision, state: freezeState({ ...next }) };
    for (const listener of listeners) listener();
  };

  const compile = (expression: string): LocalExpression => {
    let compiled = expressions.get(expression);
    if (!compiled) {
      compiled = compileExpression(expression);
      expressions.set(expression, compiled);
    }
    return compiled;
  };

  const subtreeIds = (node: LocalNode): Set<string> => {
    const ids = new Set<string>();
    const walk = (current: LocalNode): void => {
      ids.add(current.id);
      for (const child of current.children ?? []) walk(child);
    };
    walk(node);
    return ids;
  };

  const runtime: LocalRuntime = {
    document,

    snapshot(): LocalSnapshot {
      ensure();
      return snapshot;
    },

    get(node: LocalNode): LocalValue {
      ensure();
      const key = localKey(node);
      return Object.hasOwn(state, key) ? cloneValue(state[key]) : null;
    },

    set(node: LocalNode, value: LocalValue): Diagnostic[] {
      ensure();
      const key = localKey(node);
      const binding = document.bindings[key];
      if (!binding) {
        return [diagnosticFor(document, node, 'local.runtime.binding', '该组件没有可写入的绑定状态。')];
      }
      const result = validateValue(binding, node, value);
      if (!result.ok) {
        return [diagnosticFor(document, node, 'local.runtime.value', result.message)];
      }
      const nextValue = cloneValue(result.value);
      if (valuesEqual(state[key], nextValue)) return [];
      commit({ ...state, [key]: nextValue });
      return [];
    },

    evaluate(expression: string): LocalValue {
      ensure();
      return compile(expression).evaluate({ ...state });
    },

    text(template: string): string {
      ensure();
      return interpolate(template, { ...state });
    },

    reset(node: LocalNode): void {
      ensure();
      const ids = subtreeIds(node);
      const next: Record<string, LocalValue> = { ...state };
      for (const [key, binding] of Object.entries(document.bindings)) {
        if (binding.nodeIds.some((id) => ids.has(id))) next[key] = cloneValue(binding.initial);
      }
      for (const id of ids) tokens.set(id, (tokens.get(id) ?? 0) + 1);
      commit(next);
    },

    resetToken(node: LocalNode): number {
      ensure();
      return tokens.get(node.id) ?? 0;
    },

    subscribe(listener: () => void): () => void {
      ensure();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      expressions.clear();
      tokens.clear();
    },
  };

  return runtime;
}
