import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import {
  formatBold,
  formatInlineCode,
  formatItalic,
  formatStrike,
  insertCodeBlock,
  insertImage,
  insertLink,
  insertTable,
} from '../src/editor-commands';
import { EDITOR_COMMAND_COPY } from '../src/editor-i18n';
import { COPY, DEFAULT_LANGUAGE, copyFor, pick } from '../src/i18n';
import {
  NATIVE_COMPONENTS,
  NATIVE_COMPONENT_GROUPS,
  getNativeComponentCatalog,
  renderNativeSnippet,
  type NativeComponentDefinition,
} from '../src/native-components';

const EMPTY = { start: 0, end: 0 };
const CJK = /[\u3400-\u9fff]/;

/** Keys and value kinds of a nested copy object; functions are leaves. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shapeOf((value as Record<string, unknown>)[key])]),
    );
  }
  return typeof value;
}

function fillInsertTokens(template: string): string {
  return template
    .replace(/\{\{selection(?::[^{}]*)?\}\}/g, '示例内容')
    .replace(/\{\{select:([^{}]*)\}\}/g, '$1')
    .replace(/\{\{caret\}\}/g, '');
}

function templateSource(component: NativeComponentDefinition): string {
  return fillInsertTokens(renderNativeSnippet(component, ''));
}

describe('demo copy dictionaries', () => {
  it('has the same recursive shape in English and Chinese', () => {
    expect(shapeOf(COPY.zh)).toEqual(shapeOf(COPY.en));
  });

  it('defaults to English copy and resolves both languages', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(copyFor('en')).toBe(COPY.en);
    expect(copyFor('zh')).toBe(COPY.zh);
    expect(pick('en', 'English', '中文')).toBe('English');
    expect(pick('zh', 'English', '中文')).toBe('中文');
    expect(COPY.en.htmlLang).toBe('en');
    expect(COPY.zh.htmlLang).toBe('zh-CN');
    expect(COPY.en.documentTitle).not.toBe(COPY.zh.documentTitle);
    expect(COPY.en.languageToggle.ariaLabel).toBe('Switch to Chinese');
    expect(COPY.zh.languageToggle.ariaLabel).toBe('切换到英文');
    expect(COPY.en.guide.documentFile).toBe('docs/guides/local-guide-en.md');
    expect(COPY.zh.guide.documentFile).toBe('docs/guides/local-guide-ch.md');
  });

  it('formats status and diagnostics text in both languages', () => {
    expect(COPY.en.status.compiled(2, 15, false)).toBe('Compiled · 2 diagnostics');
    expect(COPY.en.status.compiled(0, 15, true)).toBe('Compiled · 15 ms · main thread');
    expect(COPY.zh.status.compiled(2, 15, false)).toBe('已编译 · 2 条诊断');
    expect(COPY.zh.status.compiled(0, 15, true)).toBe('已编译 · 15 ms · 主线程');
    expect(COPY.en.editor.diagnosticsCount(3)).toBe('3');
    expect(COPY.zh.editor.diagnosticsCount(3)).toBe('3 条');
    expect(COPY.en.editor.position(2, 4)).toBe('Line 2 · Column 4');
    expect(COPY.zh.editor.position(2, 4)).toBe('第 2 行 · 第 4 列');
  });
});

describe('editor command copy', () => {
  it('keeps the English command defaults unchanged', () => {
    expect(formatBold('', EMPTY)).toEqual({ value: '**bold text**', selection: { start: 2, end: 11 } });
    expect(formatItalic('', EMPTY)).toEqual({
      value: '*italic text*',
      selection: { start: 1, end: 12 },
    });
    expect(formatStrike('', EMPTY)).toEqual({
      value: '~~strikethrough text~~',
      selection: { start: 2, end: 20 },
    });
    expect(formatInlineCode('', EMPTY)).toEqual({ value: '`code`', selection: { start: 1, end: 5 } });
    expect(insertLink('', EMPTY)).toEqual({
      value: '[link text](https://example.com)',
      selection: { start: 1, end: 10 },
    });
    expect(insertImage('', EMPTY)).toEqual({
      value: '![example image](images/example.png)',
      selection: { start: 2, end: 15 },
    });
    expect(insertCodeBlock('', EMPTY)).toEqual({
      value: '```text\nWrite code here\n```',
      selection: { start: 8, end: 23 },
    });
    const table = insertTable('', EMPTY);
    const lines = table.value.split('\n');
    expect(lines[0]).toBe('| Column 1 | Column 2 | Column 3 |');
    expect(lines[2]).toContain('| Example 1 |');
    expect(table.value.slice(table.selection.start, table.selection.end)).toBe('Example 1');
  });

  it('produces Chinese placeholders when the language is Chinese', () => {
    expect(formatBold('', EMPTY, 'zh')).toEqual({
      value: '**粗体文字**',
      selection: { start: 2, end: 6 },
    });
    expect(formatItalic('', EMPTY, 'zh')).toEqual({
      value: '*斜体文字*',
      selection: { start: 1, end: 5 },
    });
    expect(formatStrike('', EMPTY, 'zh')).toEqual({
      value: '~~删除线文字~~',
      selection: { start: 2, end: 7 },
    });
    expect(formatInlineCode('', EMPTY, 'zh')).toEqual({
      value: '`代码`',
      selection: { start: 1, end: 3 },
    });
    expect(insertLink('', EMPTY, 'zh').value).toBe('[链接文字](https://example.com)');
    expect(insertImage('', EMPTY, 'zh').value).toBe('![示意图](images/example.png)');
    expect(insertCodeBlock('', EMPTY, 'zh').value).toBe('```text\n在这里写代码\n```');
    const table = insertTable('', EMPTY, 'zh');
    const lines = table.value.split('\n');
    expect(lines[0]).toBe('| 列 1 | 列 2 | 列 3 |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toContain('| 示例 1 |');
    expect(lines[3]).toContain('| 示例 4 |');
    expect(table.value.slice(table.selection.start, table.selection.end)).toBe('示例 1');
    for (const value of Object.values(EDITOR_COMMAND_COPY.zh)) {
      if (typeof value === 'string') expect(value).toMatch(CJK);
    }
  });

  it('keeps Chinese placeholders out of the English defaults', () => {
    expect(formatBold('', EMPTY).value).toBe('**bold text**');
    expect(formatBold('', EMPTY).value).not.toMatch(CJK);
    expect(formatBold('', EMPTY, 'en').value).toBe('**bold text**');
    expect(formatBold('', EMPTY, 'en').value).not.toMatch(CJK);
  });
});

describe('native component catalog localization', () => {
  it('keeps the English catalog unchanged and canonical', () => {
    const catalog = getNativeComponentCatalog();
    expect(getNativeComponentCatalog('en')).toEqual(catalog);
    expect(catalog.groups).toEqual(NATIVE_COMPONENT_GROUPS);
    expect(catalog.components).toHaveLength(NATIVE_COMPONENTS.length);
    catalog.components.forEach((component, index) => {
      const canonical = NATIVE_COMPONENTS[index];
      expect(component.id).toBe(canonical.id);
      expect(component.group).toBe(canonical.group);
      expect(component.label).toBe(canonical.label);
      expect(component.description).toBe(canonical.description);
      expect(component.template).toBe(canonical.template);
      for (const keyword of canonical.keywords) {
        expect(component.keywords).toContain(keyword);
      }
    });
  });

  it('returns Chinese labels, descriptions and groups for every component', () => {
    const catalog = getNativeComponentCatalog('zh');
    const english = getNativeComponentCatalog('en');
    expect(catalog.components).toHaveLength(NATIVE_COMPONENTS.length);
    expect(catalog.components.map((component) => component.id)).toEqual(
      NATIVE_COMPONENTS.map((component) => component.id),
    );
    for (const group of catalog.groups) {
      const original = NATIVE_COMPONENT_GROUPS.find((item) => item.id === group.id);
      expect(original, group.id).toBeTruthy();
      expect(group.label).toMatch(CJK);
      expect(group.label).not.toBe(original!.label);
    }
    for (const component of catalog.components) {
      const original = english.components.find((item) => item.id === component.id)!;
      expect(component.label, component.id).toMatch(CJK);
      expect(component.description, component.id).toMatch(CJK);
      expect(component.label, component.id).not.toBe(original.label);
      expect(component.description, component.id).not.toBe(original.description);
      expect(component.template.trim().length, component.id).toBeGreaterThan(0);
    }
  });

  it('compiles every Chinese component template', () => {
    const catalog = getNativeComponentCatalog('zh');
    for (const component of catalog.components) {
      const snippet = templateSource(component);
      const result = compileLocal(snippet);
      if (!result.ok) {
        const diagnostics = result.diagnostics
          .map((item) => `  ${item.line}:${item.column} [${item.code}] ${item.message}`)
          .join('\n');
        throw new Error(
          `Chinese template for ${component.id} failed to compile:\n${snippet}\n${diagnostics}`,
        );
      }
      expect(result.document.nodes.length, component.id).toBeGreaterThan(0);
      const runtime = createLocalRuntime(result.document);
      expect(runtime.snapshot().revision, component.id).toBe(0);
      runtime.dispose();
    }
  });
});
