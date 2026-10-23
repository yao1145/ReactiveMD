import { describe, expect, it } from 'vitest';
import { compileLocal } from 'reactive-md';
import {
  NATIVE_COMPONENT_GROUPS,
  NATIVE_COMPONENTS,
  renderNativeSnippet,
  type NativeComponentDefinition,
  type NativeComponentGroupId,
} from '../src/native-components';

const BIND_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Resolve toolbar-only tokens the way `insertTemplate` would in the editor. */
function fillInsertTokens(template: string): string {
  return template
    .replace(/\{\{selection(?::[^{}]*)?\}\}/g, '示例内容')
    .replace(/\{\{select:([^{}]*)\}\}/g, '$1')
    .replace(/\{\{caret\}\}/g, '');
}

function componentById(id: string): NativeComponentDefinition {
  const component = NATIVE_COMPONENTS.find((item) => item.id === id);
  if (!component) throw new Error(`Missing component ${id}`);
  return component;
}

function renderedBind(snippet: string): string {
  const match = /bind="([^"]+)"/.exec(snippet);
  if (!match) throw new Error(`Snippet has no bind attribute:\n${snippet}`);
  return match[1];
}

function expectCompiles(component: NativeComponentDefinition): void {
  const snippet = fillInsertTokens(renderNativeSnippet(component, ''));
  const result = compileLocal(snippet);
  if (!result.ok) {
    const diagnostics = result.diagnostics
      .map((item) => `  ${item.line}:${item.column} [${item.code}] ${item.message}`)
      .join('\n');
    throw new Error(`组件 ${component.id} 的模板无法编译：\n${snippet}\n${diagnostics}`);
  }
  expect(result.ok).toBe(true);
  expect(result.document.nodes.length).toBeGreaterThan(0);
}

describe('native component catalog', () => {
  it('ships unique, complete group definitions', () => {
    const ids = NATIVE_COMPONENT_GROUPS.map((group) => group.id);
    expect(ids).toEqual(['input', 'action', 'layout', 'data', 'hint']);
    expect(new Set(ids).size).toBe(NATIVE_COMPONENT_GROUPS.length);
    for (const group of NATIVE_COMPONENT_GROUPS) {
      expect(group.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('defines at least twenty unique and complete components', () => {
    expect(NATIVE_COMPONENTS.length).toBeGreaterThanOrEqual(20);

    const ids = NATIVE_COMPONENTS.map((component) => component.id);
    expect(new Set(ids).size).toBe(NATIVE_COMPONENTS.length);

    const groupIds = new Set<NativeComponentGroupId>(
      NATIVE_COMPONENT_GROUPS.map((group) => group.id),
    );
    for (const component of NATIVE_COMPONENTS) {
      expect(component.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(groupIds.has(component.group)).toBe(true);
      expect(component.label.trim().length).toBeGreaterThan(0);
      expect(component.description.trim().length).toBeGreaterThan(0);
      expect(component.keywords.length).toBeGreaterThan(0);
      expect(component.keywords.every((keyword) => keyword.trim().length > 0)).toBe(true);
      expect(component.template.trim().length).toBeGreaterThan(0);
    }

    for (const group of NATIVE_COMPONENT_GROUPS) {
      expect(NATIVE_COMPONENTS.some((component) => component.group === group.id)).toBe(true);
    }
  });

  it('marks exactly badge and tooltip as inline components', () => {
    const inlineIds = NATIVE_COMPONENTS.filter((component) => component.inline).map(
      (component) => component.id,
    );
    expect(inlineIds.sort()).toEqual(['badge', 'tooltip']);
    for (const component of NATIVE_COMPONENTS) {
      if (component.id !== 'badge' && component.id !== 'tooltip') {
        expect(component.inline).not.toBe(true);
      }
    }
  });
});

describe('renderNativeSnippet bind names', () => {
  it('avoids an existing bind and increments suffixes', () => {
    const slider = componentById('slider');

    const first = renderNativeSnippet(slider, '<slider bind="amount" label="已有滑块">');
    expect(first).toContain('bind="amount2"');
    expect(renderedBind(first)).toMatch(BIND_NAME);

    const second = renderNativeSnippet(
      slider,
      '<slider bind="amount" label="已有滑块">\n当前值：{{ amount2 }}。',
    );
    expect(second).toContain('bind="amount3"');
    expect(renderedBind(second)).toMatch(BIND_NAME);
  });

  it('avoids plain identifiers used in the document', () => {
    const slider = componentById('slider');

    const prose = renderNativeSnippet(slider, '正文提到 amount 这个普通标识符。');
    expect(prose).toContain('bind="amount2"');

    const crowded = renderNativeSnippet(
      slider,
      '正文提到 amount、amount2 和 amount3 这些标识符。',
    );
    expect(crowded).toContain('bind="amount4"');
    expect(renderedBind(crowded)).toMatch(BIND_NAME);
  });

  it('leaves toolbar tokens for insertTemplate', () => {
    for (const component of NATIVE_COMPONENTS) {
      const snippet = renderNativeSnippet(component, '');
      expect(snippet).not.toContain('{{bind:');
      if (component.template.includes('{{selection')) {
        expect(snippet).toContain('{{selection');
      }
      if (component.template.includes('{{select:')) {
        expect(snippet).toContain('{{select:');
      }
    }
  });
});

describe('native component templates compile as local-draft-1', () => {
  for (const component of NATIVE_COMPONENTS) {
    it(`${component.id} (${component.group})`, () => {
      expectCompiles(component);
    });
  }
});
