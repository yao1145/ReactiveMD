import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  compileLocal,
  createLocalRuntime,
  LOCAL_SYNTAX_VERSION,
  type Diagnostic,
  type LocalDocument,
  type LocalNode,
  type LocalValue,
} from '../src/local';
import { LocalDocumentView } from '../src/local/LocalDocumentView';

/* ------------------------------------------------------------------ */
/* Fixture types                                                       */
/* ------------------------------------------------------------------ */

interface CaseAction {
  bind: string;
  value: LocalValue;
  codes: string[];
  expectedState?: Record<string, LocalValue>;
}

interface CaseReset {
  component: string;
  index?: number;
  expectedState: Record<string, LocalValue>;
}

interface ProtocolCase {
  id: string;
  component: string;
  source: string;
  ok: boolean;
  codes: string[];
  initial?: Record<string, LocalValue>;
  bindingNames?: string[];
  actions?: CaseAction[];
  reset?: CaseReset;
  text?: string;
  expectedText?: string;
  htmlIncludes?: string[];
  htmlExcludes?: string[];
}

interface ProtocolSuite {
  protocolVersion: string;
  syntaxVersion: string;
  cases: ProtocolCase[];
}

const suite = JSON.parse(
  readFileSync(new URL('../examples/conformance/component-protocol-1.json', import.meta.url), 'utf8'),
) as ProtocolSuite;

/* ------------------------------------------------------------------ */
/* Portable format checks                                              */
/* ------------------------------------------------------------------ */

const ROOT_KEYS = new Set(['protocolVersion', 'syntaxVersion', 'cases']);
const CASE_KEYS = new Set([
  'id', 'component', 'source', 'ok', 'codes', 'initial', 'bindingNames',
  'actions', 'reset', 'text', 'expectedText', 'htmlIncludes', 'htmlExcludes',
]);
const ACTION_KEYS = new Set(['bind', 'value', 'codes', 'expectedState']);
const RESET_KEYS = new Set(['component', 'index', 'expectedState']);
const SUCCESS_KEYS = [
  'initial', 'bindingNames', 'actions', 'reset', 'text',
  'expectedText', 'htmlIncludes', 'htmlExcludes',
];
const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const BIND_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLocalValue(value: unknown): value is LocalValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isState(value: unknown): value is Record<string, LocalValue> {
  return isRecord(value) && Object.values(value).every(isLocalValue);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isCodes(value: unknown): value is string[] {
  return isStringArray(value) && new Set(value).size === value.length;
}

function checkKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  problems: string[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) problems.push(`${path} 含未知字段 ${key}`);
  }
}

function validateAction(value: unknown, path: string, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${path} 必须是对象`);
    return;
  }
  checkKeys(value, ACTION_KEYS, path, problems);
  if (typeof value.bind !== 'string' || !BIND_NAME.test(value.bind)) {
    problems.push(`${path}.bind 必须是合法参数名`);
  }
  if (!('value' in value) || !isLocalValue(value.value)) {
    problems.push(`${path}.value 必须是字符串、有限数字、布尔值、null 或字符串数组`);
  }
  if (!isCodes(value.codes)) {
    problems.push(`${path}.codes 必须是去重的非空字符串数组`);
  }
  if ('expectedState' in value && !isState(value.expectedState)) {
    problems.push(`${path}.expectedState 必须是参数状态对象`);
  }
}

function validateReset(value: unknown, path: string, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${path} 必须是对象`);
    return;
  }
  checkKeys(value, RESET_KEYS, path, problems);
  if (typeof value.component !== 'string' || !COMPONENT_NAME.test(value.component)) {
    problems.push(`${path}.component 必须是合法组件名`);
  }
  if (!('expectedState' in value) || !isState(value.expectedState)) {
    problems.push(`${path}.expectedState 是必填的状态对象`);
  }
  if ('index' in value) {
    const index = value.index;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      problems.push(`${path}.index 必须是从 0 开始的安全整数`);
    }
  }
}

function validateCase(value: unknown, path: string, ids: Set<string>, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${path} 必须是对象`);
    return;
  }
  checkKeys(value, CASE_KEYS, path, problems);

  if (typeof value.id !== 'string' || value.id.length === 0) {
    problems.push(`${path}.id 必须是非空字符串`);
  } else if (ids.has(value.id)) {
    problems.push(`${path}.id 重复：${value.id}`);
  } else {
    ids.add(value.id);
  }

  if (typeof value.component !== 'string' || !COMPONENT_NAME.test(value.component)) {
    problems.push(`${path}.component 必须是合法组件名`);
  }
  if (typeof value.source !== 'string') {
    problems.push(`${path}.source 必须是源码字符串`);
  }
  if (typeof value.ok !== 'boolean') {
    problems.push(`${path}.ok 必须是布尔值`);
  }
  if (!isCodes(value.codes)) {
    problems.push(`${path}.codes 必须是去重的非空字符串数组`);
  }
  if ('initial' in value && !isState(value.initial)) {
    problems.push(`${path}.initial 必须是参数状态对象`);
  }
  if ('bindingNames' in value) {
    if (!Array.isArray(value.bindingNames)) {
      problems.push(`${path}.bindingNames 必须是字符串数组`);
    } else if (new Set(value.bindingNames).size !== value.bindingNames.length) {
      problems.push(`${path}.bindingNames 不能重复`);
    } else if (!value.bindingNames.every((name) => typeof name === 'string' && name.length > 0)) {
      problems.push(`${path}.bindingNames 只能包含非空字符串`);
    }
  }
  if ('actions' in value) {
    if (!Array.isArray(value.actions)) {
      problems.push(`${path}.actions 必须是数组`);
    } else {
      value.actions.forEach((action, index) =>
        validateAction(action, `${path}.actions[${index}]`, problems),
      );
    }
  }
  if ('reset' in value) validateReset(value.reset, `${path}.reset`, problems);
  if ('htmlIncludes' in value && !isStringArray(value.htmlIncludes)) {
    problems.push(`${path}.htmlIncludes 只能包含非空字符串`);
  }
  if ('htmlExcludes' in value && !isStringArray(value.htmlExcludes)) {
    problems.push(`${path}.htmlExcludes 只能包含非空字符串`);
  }

  const hasText = 'text' in value;
  const hasExpectedText = 'expectedText' in value;
  if (hasText !== hasExpectedText) {
    problems.push(`${path}.text 与 expectedText 必须成对出现`);
  }
  if (hasText && typeof value.text !== 'string') {
    problems.push(`${path}.text 必须是字符串`);
  }
  if (hasExpectedText && typeof value.expectedText !== 'string') {
    problems.push(`${path}.expectedText 必须是字符串`);
  }

  if (value.ok === false) {
    for (const key of SUCCESS_KEYS) {
      if (key in value) problems.push(`${path}.${key} 不得出现在编译失败的用例中`);
    }
  }
}

function formatProblems(input: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(input)) return ['根对象必须是 JSON 对象'];
  checkKeys(input, ROOT_KEYS, '根对象', problems);
  if (input.protocolVersion !== 'component-protocol-1') {
    problems.push('protocolVersion 必须精确等于 component-protocol-1');
  }
  if (input.syntaxVersion !== 'local-draft-1') {
    problems.push('syntaxVersion 必须精确等于 local-draft-1');
  }
  if (!Array.isArray(input.cases) || input.cases.length === 0) {
    problems.push('cases 必须是非空数组');
    return problems;
  }
  const ids = new Set<string>();
  input.cases.forEach((entry, index) => validateCase(entry, `cases[${index}]`, ids, problems));
  return problems;
}

/* ------------------------------------------------------------------ */
/* Document helpers                                                    */
/* ------------------------------------------------------------------ */

function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function codesOf(diagnostics: Diagnostic[]): string[] {
  return [...new Set(diagnostics.map((diagnostic) => diagnostic.code))].sort();
}

/** Named bindings are the public parameters; anonymous state keys start with `@`. */
function publicBindingNames(document: LocalDocument): string[] {
  return Object.keys(document.bindings)
    .filter((name) => !name.startsWith('@'))
    .sort();
}

function ownerNode(document: LocalDocument, bind: string): LocalNode {
  const binding = document.bindings[bind];
  if (!binding) throw new Error(`用例引用了不存在的参数 ${bind}`);
  const node = flatten(document.nodes).find((entry) => entry.id === binding.nodeIds[0]);
  if (!node) throw new Error(`参数 ${bind} 没有可写入的控件`);
  return node;
}

function findByComponent(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = flatten(document.nodes).filter(
    (node) => node.type === 'component' && node.name === name,
  );
  const found = matches[index];
  if (!found) throw new Error(`找不到第 ${index} 个 <${name}>`);
  return found;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

describe('component-protocol-1 fixture format', () => {
  it('declares the protocol and syntax revisions exactly', () => {
    expect(suite.protocolVersion).toBe('component-protocol-1');
    expect(suite.syntaxVersion).toBe(LOCAL_SYNTAX_VERSION);
  });

  it('uses unique ids and only fields allowed by the machine format', () => {
    expect(formatProblems(suite)).toEqual([]);
  });

  it('covers slider, tabs and plot cases', () => {
    const components = new Set(suite.cases.map((fixture) => fixture.component));
    for (const component of ['slider', 'tabs', 'plot']) {
      expect(components.has(component), `缺少 ${component} 用例`).toBe(true);
    }
  });

  it('distinguishes successful compilation from rejected sources', () => {
    expect(suite.cases.some((fixture) => fixture.ok)).toBe(true);
    expect(suite.cases.some((fixture) => !fixture.ok)).toBe(true);
  });

  const minimalSuite = () => ({
    protocolVersion: 'component-protocol-1',
    syntaxVersion: 'local-draft-1',
    cases: [{ id: 'format-check', component: 'slider', source: '', ok: true, codes: [] } as Record<string, unknown>],
  });
  type FormatSample = ReturnType<typeof minimalSuite>;

  it.each<{ name: string; mutate: (input: FormatSample) => void }>([
    { name: 'unknown case fields', mutate: input => { input.cases[0].unexpected = true; } },
    { name: 'missing diagnostic expectations', mutate: input => { delete input.cases[0].codes; } },
    { name: 'duplicate ids', mutate: input => { input.cases.push({ ...input.cases[0] }); } },
    { name: 'duplicate diagnostic codes', mutate: input => { input.cases[0].codes = ['local.type', 'local.type']; } },
    { name: 'unpaired text expectations', mutate: input => { input.cases[0].text = '{{ n }}'; } },
    { name: 'actions on failed compilation', mutate: input => { input.cases[0].ok = false; input.cases[0].actions = []; } },
    { name: 'object state writes', mutate: input => { input.cases[0].actions = [{ bind: 'n', value: {}, codes: [] }]; } },
    { name: 'negative reset indices', mutate: input => { input.cases[0].reset = { component: 'slider', index: -1, expectedState: {} }; } },
    { name: 'unknown protocol revisions', mutate: input => { input.protocolVersion = 'component-protocol-999'; } },
  ])('rejects $name', ({ mutate }) => {
    const input = minimalSuite();
    expect(formatProblems(input)).toEqual([]);
    mutate(input);
    expect(formatProblems(input).length).toBeGreaterThan(0);
  });
});

describe('component-protocol-1 reference cases', () => {
  for (const fixture of suite.cases) {
    it(fixture.id, () => {
      const result = compileLocal(fixture.source);
      const expectedCodes = sorted(fixture.codes);
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(fixture.ok);
      expect(codesOf(result.diagnostics)).toEqual(expectedCodes);

      if (!result.ok) {
        expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
        return;
      }

      // A successful compile may degrade, but diagnostics must stay warnings.
      expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);

      const document = result.document;
      const publicNames = publicBindingNames(document);
      if (fixture.bindingNames) {
        expect(publicNames).toEqual(sorted(fixture.bindingNames));
      }
      for (const name of Object.keys(fixture.initial ?? {})) {
        expect(publicNames, `initial 中的 ${name} 不是公开参数`).toContain(name);
      }
      for (const action of fixture.actions ?? []) {
        expect(publicNames, `action 中的 ${action.bind} 不是公开参数`).toContain(action.bind);
      }

      const runtime = createLocalRuntime(document);
      try {
        if (fixture.initial) {
          expect(runtime.snapshot().state).toMatchObject(fixture.initial);
        }

        for (const action of fixture.actions ?? []) {
          const node = ownerNode(document, action.bind);
          const previous = runtime.snapshot();
          const diagnostics = runtime.set(node, action.value);
          expect(
            codesOf(diagnostics),
            `写入 ${action.bind} = ${JSON.stringify(action.value)}`,
          ).toEqual(sorted(action.codes));
          if (action.codes.length > 0) {
            // A rejected write preserves every parameter and the revision.
            expect(runtime.snapshot()).toBe(previous);
          }
          for (const id of document.bindings[action.bind].nodeIds) {
            const shared = flatten(document.nodes).find(entry => entry.id === id)!;
            expect(runtime.get(shared)).toEqual(runtime.snapshot().state[action.bind]);
          }
          if (action.expectedState) {
            expect(runtime.snapshot().state).toMatchObject(action.expectedState);
          }
        }

        if (fixture.reset) {
          const node = findByComponent(document, fixture.reset.component, fixture.reset.index ?? 0);
          runtime.reset(node);
          expect(runtime.snapshot().state).toMatchObject(fixture.reset.expectedState);
        }

        if (fixture.text !== undefined) {
          expect(runtime.text(fixture.text)).toBe(fixture.expectedText);
        }

        if (fixture.htmlIncludes?.length || fixture.htmlExcludes?.length) {
          const html = renderToStaticMarkup(
            createElement(LocalDocumentView, { document, runtime }),
          );
          for (const needle of fixture.htmlIncludes ?? []) {
            expect(html, `htmlIncludes 未出现：${needle}`).toContain(needle);
          }
          for (const needle of fixture.htmlExcludes ?? []) {
            expect(html, `htmlExcludes 不应出现：${needle}`).not.toContain(needle);
          }
        }
      } finally {
        runtime.dispose();
      }
    });
  }
});
