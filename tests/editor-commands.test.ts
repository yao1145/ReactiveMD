import { describe, expect, it } from 'vitest';
import {
  formatBold,
  formatBulletList,
  formatHeading,
  formatInlineCode,
  formatItalic,
  formatTaskList,
  indentSelection,
  insertLink,
  insertTable,
  insertTemplate,
  outdentSelection,
  readFormatState,
} from '../src/editor/editor-commands';

describe('editor commands', () => {
  it('wraps and unwraps inline markers without changing the input string', () => {
    const source = 'hello world';
    const edit = formatBold(source, { start: 0, end: 5 });
    expect(edit.value).toBe('**hello** world');
    expect(edit.selection).toEqual({ start: 2, end: 7 });
    expect(source).toBe('hello world');

    expect(formatItalic('*hi*', { start: 0, end: 4 }).value).toBe('hi');
  });

  it('inserts localized placeholders for empty selections', () => {
    expect(formatBold('', { start: 0, end: 0 }, 'zh').value).toBe('**粗体文字**');
    expect(insertLink('', { start: 0, end: 0 }, 'zh').value)
      .toBe('[链接文字](https://example.com)');
    expect(formatBold('', { start: 0, end: 0 }).value).toBe('**bold text**');
  });

  it('applies a heading to every covered line', () => {
    const edit = formatHeading('a\nb\nc', { start: 0, end: 5 }, 2);
    expect(edit.value).toBe('## a\n## b\n## c');
  });

  it('toggles bullet and task prefixes', () => {
    expect(formatBulletList('a\nb', { start: 0, end: 3 }).value).toBe('- a\n- b');
    expect(formatTaskList('todo', { start: 0, end: 4 }).value).toBe('- [ ] todo');
    expect(formatTaskList('', { start: 0, end: 0 }).value).toBe('- [ ] ');
  });

  it('indents and outdents covered lines', () => {
    expect(indentSelection('a\nb', { start: 0, end: 3 }).value).toBe('  a\n  b');
    expect(outdentSelection('    a\n  b', { start: 0, end: 9 }).value).toBe('  a\nb');
  });

  it('inserts a block table with its first cell selected', () => {
    const edit = insertTable('before after', { start: 7, end: 7 });
    expect(edit.value.startsWith('before \n\n| Column 1 |')).toBe(true);
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('Example 1');
  });

  it('resolves selection, fallback, select and caret template tokens', () => {
    expect(insertTemplate('abc', { start: 0, end: 3 }, '**{{selection}}**').value)
      .toBe('**abc**');
    expect(insertTemplate('', { start: 0, end: 0 }, '{{selection:Fallback}}').selection)
      .toEqual({ start: 0, end: 8 });
    expect(insertTemplate('', { start: 0, end: 0 }, '{{select:Target}}').selection)
      .toEqual({ start: 0, end: 6 });
    expect(insertTemplate('foo', { start: 1, end: 1 }, 'A{{caret}}B').value).toBe('fABoo');
  });

  it('leaves ordinary reactive expressions untouched', () => {
    const edit = insertTemplate('', { start: 0, end: 0 }, 'Value: {{ 40 }}, cursor{{caret}}.');
    expect(edit.value).toBe('Value: {{ 40 }}, cursor.');
  });

  it('clamps and orders out-of-range selections', () => {
    const wide = formatBold('abc', { start: 99, end: -3 });
    expect(wide.value).toBe('**abc**');
    expect(wide.selection).toEqual({ start: 2, end: 5 });

    expect(formatInlineCode('', { start: -1, end: 1 }).value).toBe('`code`');
  });

  it('reads block and inline formatting at the caret', () => {
    const task = readFormatState('- [x] **call** mom', { start: 10, end: 10 });
    expect(task.list).toBe('task');
    expect(task.bold).toBe(true);
    expect(task.italic).toBe(false);

    const heading = readFormatState('title\n## second', { start: 9, end: 9 });
    expect(heading.headingLevel).toBe(2);

    expect(readFormatState('#nospace', { start: 2, end: 2 }).headingLevel).toBe(0);
    expect(readFormatState('`code`', { start: 1, end: 5 }).inlineCode).toBe(true);
  });
});
