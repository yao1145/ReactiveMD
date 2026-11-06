import { describe, expect, it } from 'vitest';
import { COPY, DEFAULT_LANGUAGE, copyFor, pick } from '../src/i18n';

function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, shapeOf((value as Record<string, unknown>)[key])]));
  }
  return typeof value;
}
describe('demo copy dictionaries', () => {
  it('has the same recursive shape in English and Chinese', () => {
    expect(shapeOf(COPY.zh)).toEqual(shapeOf(COPY.en));
  });
  it('defaults to English and resolves owned guide paths in both languages', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(copyFor('en')).toBe(COPY.en);
    expect(copyFor('zh')).toBe(COPY.zh);
    expect(pick('en', 'English', '中文')).toBe('English');
    expect(pick('zh', 'English', '中文')).toBe('中文');
    expect(COPY.en.htmlLang).toBe('en');
    expect(COPY.zh.htmlLang).toBe('zh-CN');
    expect(COPY.en.languageToggle.ariaLabel).toBe('Switch to Chinese');
    expect(COPY.zh.languageToggle.ariaLabel).toBe('切换到英文');
    expect(COPY.en.guide.documentFile).toBe('content/guides/local-guide-en.md');
    expect(COPY.zh.guide.documentFile).toBe('content/guides/local-guide-ch.md');
  });
  it('formats status and diagnostics in both languages', () => {
    expect(COPY.en.status.compiled(2, 15, false)).toBe('Compiled · 2 diagnostics');
    expect(COPY.zh.status.compiled(2, 15, false)).toBe('已编译 · 2 条诊断');
    expect(COPY.en.editor.position(2, 4)).toBe('Line 2 · Column 4');
    expect(COPY.zh.editor.position(2, 4)).toBe('第 2 行 · 第 4 列');
  });
});
