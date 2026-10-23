import { describe, expect, it } from 'vitest';
import {
  formatBold,
  formatBulletList,
  formatHeading,
  formatInlineCode,
  formatItalic,
  formatOrderedList,
  formatQuote,
  formatStrike,
  formatTaskList,
  indentSelection,
  insertCodeBlock,
  insertDivider,
  insertImage,
  insertLink,
  insertTable,
  insertTemplate,
  insertText,
  outdentSelection,
} from '../src/editor-commands';

describe('inline markers', () => {
  it('wraps a bold selection and keeps the original text selected', () => {
    const edit = formatBold('hello world', { start: 0, end: 5 });
    expect(edit.value).toBe('**hello** world');
    expect(edit.selection).toEqual({ start: 2, end: 7 });
  });

  it('unwraps bold when the selection includes the markers', () => {
    const edit = formatBold('**hello**', { start: 0, end: 9 });
    expect(edit.value).toBe('hello');
    expect(edit.selection).toEqual({ start: 0, end: 5 });
  });

  it('unwraps bold when the markers sit just outside the selection', () => {
    const edit = formatBold('say **hello** now', { start: 6, end: 11 });
    expect(edit.value).toBe('say hello now');
    expect(edit.selection).toEqual({ start: 4, end: 9 });
  });

  it('inserts and selects a bold placeholder for an empty selection', () => {
    const edit = formatBold('', { start: 0, end: 0 });
    expect(edit.value).toBe('**粗体文字**');
    expect(edit.selection).toEqual({ start: 2, end: 6 });
  });

  it('wraps and unwraps italic', () => {
    const wrapped = formatItalic('hello', { start: 0, end: 5 });
    expect(wrapped.value).toBe('*hello*');
    expect(wrapped.selection).toEqual({ start: 1, end: 6 });

    const unwrapped = formatItalic('*hello*', { start: 0, end: 7 });
    expect(unwrapped.value).toBe('hello');
    expect(unwrapped.selection).toEqual({ start: 0, end: 5 });
  });

  it('does not consume one half of a bold marker when toggling italic', () => {
    const edit = formatItalic('**bold**', { start: 2, end: 6 });
    expect(edit.value).toBe('***bold***');
    expect(edit.selection).toEqual({ start: 3, end: 7 });

    const whole = formatItalic('**bold**', { start: 0, end: 8 });
    expect(whole.value).toBe('***bold***');
    expect(whole.selection).toEqual({ start: 1, end: 9 });
  });

  it('inserts and selects an italic placeholder for an empty selection', () => {
    const edit = formatItalic('', { start: 0, end: 0 });
    expect(edit.value).toBe('*斜体文字*');
    expect(edit.selection).toEqual({ start: 1, end: 5 });
  });

  it('wraps, unwraps and inserts strike text', () => {
    const wrapped = formatStrike('hello', { start: 0, end: 5 });
    expect(wrapped.value).toBe('~~hello~~');
    expect(wrapped.selection).toEqual({ start: 2, end: 7 });

    const unwrapped = formatStrike('~~hello~~', { start: 0, end: 9 });
    expect(unwrapped.value).toBe('hello');
    expect(unwrapped.selection).toEqual({ start: 0, end: 5 });

    const placeholder = formatStrike('', { start: 0, end: 0 });
    expect(placeholder.value).toBe('~~删除线文字~~');
    expect(placeholder.selection).toEqual({ start: 2, end: 7 });
  });

  it('wraps, unwraps and inserts inline code', () => {
    const wrapped = formatInlineCode('const x = 1', { start: 0, end: 5 });
    expect(wrapped.value).toBe('`const` x = 1');
    expect(wrapped.selection).toEqual({ start: 1, end: 6 });

    const unwrapped = formatInlineCode('`code`', { start: 0, end: 6 });
    expect(unwrapped.value).toBe('code');
    expect(unwrapped.selection).toEqual({ start: 0, end: 4 });

    const placeholder = formatInlineCode('', { start: 0, end: 0 });
    expect(placeholder.value).toBe('`代码`');
    expect(placeholder.selection).toEqual({ start: 1, end: 3 });
  });

  it('chooses a longer delimiter when the selection contains backticks', () => {
    const edit = formatInlineCode('wrap `code` here', { start: 0, end: 16 });
    expect(edit.value).toBe('``wrap `code` here``');
    expect(edit.selection).toEqual({ start: 2, end: 18 });
  });

  it('pads the delimiter when the selection starts or ends with a backtick', () => {
    const edit = formatInlineCode('`tick', { start: 0, end: 5 });
    expect(edit.value).toBe('`` `tick ``');
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('`tick');
  });

  it('unwraps markers outside the selection', () => {
    const edit = formatInlineCode('see `code` here', { start: 5, end: 9 });
    expect(edit.value).toBe('see code here');
    expect(edit.selection).toEqual({ start: 4, end: 8 });
  });
});

describe('headings', () => {
  it('sets a heading and keeps the caret on the same content position', () => {
    const edit = formatHeading('title', { start: 2, end: 2 }, 2);
    expect(edit.value).toBe('## title');
    expect(edit.selection).toEqual({ start: 5, end: 5 });
  });

  it('replaces an existing heading level', () => {
    const edit = formatHeading('## title', { start: 0, end: 8 }, 3);
    expect(edit.value).toBe('### title');
    expect(edit.selection).toEqual({ start: 4, end: 9 });
  });

  it('removes a heading prefix with level 0', () => {
    const edit = formatHeading('## title', { start: 5, end: 5 }, 0);
    expect(edit.value).toBe('title');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('leaves a plain line untouched at level 0', () => {
    const edit = formatHeading('plain', { start: 1, end: 3 }, 0);
    expect(edit.value).toBe('plain');
    expect(edit.selection).toEqual({ start: 1, end: 3 });
  });

  it('applies to every covered line', () => {
    const edit = formatHeading('a\nb\nc', { start: 0, end: 5 }, 2);
    expect(edit.value).toBe('## a\n## b\n## c');
    expect(edit.selection).toEqual({ start: 3, end: 14 });
  });

  it('handles the current line when the selection is collapsed', () => {
    const edit = formatHeading('first\nsecond', { start: 8, end: 8 }, 1);
    expect(edit.value).toBe('first\n# second');
    expect(edit.selection).toEqual({ start: 10, end: 10 });
  });

  it('formats the first line when the document starts with a newline', () => {
    const edit = formatHeading('\nhello', { start: 0, end: 0 }, 2);
    expect(edit.value).toBe('## \nhello');
    expect(edit.selection).toEqual({ start: 3, end: 3 });
  });
});

describe('list, quote and indentation commands', () => {
  it('adds and removes bullet list prefixes on all lines', () => {
    const added = formatBulletList('alpha\nbeta', { start: 0, end: 10 });
    expect(added.value).toBe('- alpha\n- beta');
    expect(added.selection).toEqual({ start: 2, end: 14 });

    const removed = formatBulletList(added.value, added.selection);
    expect(removed.value).toBe('alpha\nbeta');
    expect(removed.selection).toEqual({ start: 0, end: 10 });
  });

  it('only touches lines covered by the selection', () => {
    const edit = formatBulletList('a\nb\nc', { start: 0, end: 1 });
    expect(edit.value).toBe('- a\nb\nc');
    expect(edit.selection).toEqual({ start: 2, end: 3 });
  });

  it('adds a bullet to an empty line', () => {
    const edit = formatBulletList('', { start: 0, end: 0 });
    expect(edit.value).toBe('- ');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('formats the first line when the document starts with a newline', () => {
    const list = formatBulletList('\nhello', { start: 0, end: 0 });
    expect(list.value).toBe('- \nhello');
    expect(list.selection).toEqual({ start: 2, end: 2 });

    const quote = formatQuote('\nhello', { start: 0, end: 0 });
    expect(quote.value).toBe('> \nhello');
    expect(quote.selection).toEqual({ start: 2, end: 2 });
  });

  it('prefixes blank lines inside a multi-line selection', () => {
    const edit = formatBulletList('a\n\nb', { start: 0, end: 4 });
    expect(edit.value).toBe('- a\n- \n- b');
  });

  it('numbers ordered list lines from 1', () => {
    const edit = formatOrderedList('a\nb\nc', { start: 0, end: 5 });
    expect(edit.value).toBe('1. a\n2. b\n3. c');
  });

  it('removes ordered list prefixes', () => {
    const edit = formatOrderedList('1. a\n2. b\n3. c', { start: 0, end: 14 });
    expect(edit.value).toBe('a\nb\nc');
    expect(edit.selection).toEqual({ start: 0, end: 5 });
  });

  it('adds and removes task list prefixes, including checked items', () => {
    const added = formatTaskList('todo\ndone', { start: 0, end: 9 });
    expect(added.value).toBe('- [ ] todo\n- [ ] done');

    const removed = formatTaskList('- [x] done\n- [ ] todo', { start: 0, end: 21 });
    expect(removed.value).toBe('done\ntodo');
  });

  it('adds a task checkbox to an empty line', () => {
    const edit = formatTaskList('', { start: 0, end: 0 });
    expect(edit.value).toBe('- [ ] ');
    expect(edit.selection).toEqual({ start: 6, end: 6 });
  });

  it('adds and removes quote prefixes', () => {
    const added = formatQuote('a\nb', { start: 0, end: 3 });
    expect(added.value).toBe('> a\n> b');

    const removed = formatQuote(added.value, { start: 0, end: 7 });
    expect(removed.value).toBe('a\nb');
    expect(removed.selection).toEqual({ start: 0, end: 3 });
  });

  it('adds a quote prefix to an empty line', () => {
    const edit = formatQuote('', { start: 0, end: 0 });
    expect(edit.value).toBe('> ');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('indents every covered line by two spaces', () => {
    const edit = indentSelection('a\nb', { start: 0, end: 3 });
    expect(edit.value).toBe('  a\n  b');
    expect(edit.selection).toEqual({ start: 2, end: 7 });
  });

  it('indents an empty line and places the caret after the spaces', () => {
    const edit = indentSelection('', { start: 0, end: 0 });
    expect(edit.value).toBe('  ');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('indents the first line when the document starts with a newline', () => {
    const edit = indentSelection('\nhello', { start: 0, end: 0 });
    expect(edit.value).toBe('  \nhello');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('outdents up to two leading spaces per line', () => {
    const edit = outdentSelection('    a\n  b', { start: 0, end: 9 });
    expect(edit.value).toBe('  a\nb');
    expect(edit.selection).toEqual({ start: 0, end: 5 });
  });

  it('removes one leading tab when outdenting', () => {
    const edit = outdentSelection('\tfoo\n bar', { start: 0, end: 9 });
    expect(edit.value).toBe('foo\nbar');
    expect(edit.selection).toEqual({ start: 0, end: 7 });
  });

  it('leaves lines without indentation alone', () => {
    const edit = outdentSelection('foo', { start: 0, end: 3 });
    expect(edit.value).toBe('foo');
    expect(edit.selection).toEqual({ start: 0, end: 3 });
  });
});

describe('links and images', () => {
  it('turns a selection into a link and selects the URL', () => {
    const edit = insertLink('docs here', { start: 0, end: 4 });
    expect(edit.value).toBe('[docs](https://example.com) here');
    expect(edit.selection).toEqual({ start: 7, end: 26 });
  });

  it('inserts a link placeholder and selects its label', () => {
    const edit = insertLink('', { start: 0, end: 0 });
    expect(edit.value).toBe('[链接文字](https://example.com)');
    expect(edit.selection).toEqual({ start: 1, end: 5 });
  });

  it('turns a selection into an image and selects the URL', () => {
    const edit = insertImage('logo', { start: 0, end: 4 });
    expect(edit.value).toBe('![logo](images/example.png)');
    expect(edit.selection).toEqual({ start: 8, end: 26 });
  });

  it('inserts an image placeholder and selects its alt text', () => {
    const edit = insertImage('', { start: 0, end: 0 });
    expect(edit.value).toBe('![示意图](images/example.png)');
    expect(edit.selection).toEqual({ start: 2, end: 5 });
  });
});

describe('code blocks, tables and dividers', () => {
  it('wraps the selection in a text fenced block and selects the body', () => {
    const edit = insertCodeBlock('const x = 1', { start: 0, end: 11 });
    expect(edit.value).toBe('```text\nconst x = 1\n```');
    expect(edit.selection).toEqual({ start: 8, end: 19 });
  });

  it('inserts a code block placeholder for an empty selection', () => {
    const edit = insertCodeBlock('', { start: 0, end: 0 });
    expect(edit.value).toBe('```text\n在这里写代码\n```');
    expect(edit.selection).toEqual({ start: 8, end: 14 });
  });

  it('uses a longer fence when the body contains backtick fences', () => {
    const body = '```js\nconst x = 1;\n```';
    const edit = insertCodeBlock(body, { start: 0, end: body.length });
    expect(edit.value).toBe('````text\n```js\nconst x = 1;\n```\n````');
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe(body);
  });

  it('inserts a 3x3 table and selects the first value cell', () => {
    const edit = insertTable('', { start: 0, end: 0 });
    const lines = edit.value.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('| 列 1 | 列 2 | 列 3 |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toContain('| 示例 1 |');
    expect(lines[3]).toContain('| 示例 4 |');
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('示例 1');
  });

  it('separates an inserted table from content on the same line', () => {
    const edit = insertTable('before after', { start: 7, end: 7 });
    expect(edit.value.startsWith('before \n\n| 列 1 |')).toBe(true);
    expect(edit.value.endsWith('| 示例 6 |\n\nafter')).toBe(true);
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('示例 1');
  });

  it('inserts a divider as a block', () => {
    const atStart = insertDivider('', { start: 0, end: 0 });
    expect(atStart.value).toBe('---');
    expect(atStart.selection).toEqual({ start: 3, end: 3 });

    const inline = insertDivider('before after', { start: 7, end: 7 });
    expect(inline.value).toBe('before \n\n---\n\nafter');
    expect(inline.selection).toEqual({ start: 12, end: 12 });
  });

  it('separates a divider from a preceding paragraph at a line start', () => {
    const trailingNewline = insertDivider('paragraph\n', { start: 10, end: 10 });
    expect(trailingNewline.value).toBe('paragraph\n\n---');
    expect(trailingNewline.selection).toEqual({ start: 14, end: 14 });

    const beforeText = insertDivider('paragraph\nnext', { start: 10, end: 10 });
    expect(beforeText.value).toBe('paragraph\n\n---\n\nnext');
    expect(beforeText.selection).toEqual({ start: 14, end: 14 });
  });
});

describe('insertText', () => {
  it('replaces the selection and leaves the caret after the insertion', () => {
    const edit = insertText('hello world', { start: 5, end: 11 }, ' 🌍');
    expect(edit.value).toBe('hello 🌍');
    expect(edit.selection).toEqual({ start: 8, end: 8 });
  });

  it('replaces the whole value', () => {
    const edit = insertText('abc', { start: 0, end: 3 }, 'x');
    expect(edit.value).toBe('x');
    expect(edit.selection).toEqual({ start: 1, end: 1 });
  });
});

describe('insertTemplate', () => {
  it('replaces {{selection}} with the selected text and removes the marker', () => {
    const edit = insertTemplate('hello', { start: 0, end: 5 }, '**{{selection}}**');
    expect(edit.value).toBe('**hello**');
    expect(edit.selection).toEqual({ start: 9, end: 9 });
  });

  it('uses the fallback and selects it when there is no selection', () => {
    const edit = insertTemplate('', { start: 0, end: 0 }, '{{selection:后备内容}}');
    expect(edit.value).toBe('后备内容');
    expect(edit.selection).toEqual({ start: 0, end: 4 });
  });

  it('uses the selection instead of the fallback when text is selected', () => {
    const edit = insertTemplate('abc', { start: 0, end: 3 }, '[{{selection:默认}}]');
    expect(edit.value).toBe('[abc]');
    expect(edit.selection).toEqual({ start: 5, end: 5 });
  });

  it('places the caret at {{caret}}', () => {
    const edit = insertTemplate('foo', { start: 1, end: 1 }, '前{{caret}}后');
    expect(edit.value).toBe('f前后oo');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('inserts and selects {{select}} content', () => {
    const edit = insertTemplate('', { start: 0, end: 0 }, '{{select:目标}}');
    expect(edit.value).toBe('目标');
    expect(edit.selection).toEqual({ start: 0, end: 2 });
  });

  it('prefers select over caret', () => {
    const edit = insertTemplate('', { start: 0, end: 0 }, '{{caret}}{{select:选中}}');
    expect(edit.value).toBe('选中');
    expect(edit.selection).toEqual({ start: 0, end: 2 });
  });

  it('places the caret at the end when there is neither select nor caret', () => {
    const edit = insertTemplate('', { start: 0, end: 0 }, 'abc');
    expect(edit.value).toBe('abc');
    expect(edit.selection).toEqual({ start: 3, end: 3 });
  });

  it('leaves no template markers behind', () => {
    const edit = insertTemplate('x', { start: 0, end: 1 }, '{{selection}}{{caret}}{{select:完}}');
    expect(edit.value).toBe('x完');
    expect(edit.value).not.toContain('{{');
    expect(edit.selection).toEqual({ start: 1, end: 2 });
  });

  it('adds no blank lines for block insertion into an empty document', () => {
    const edit = insertTemplate('', { start: 0, end: 0 }, '{{select:块}}', { block: true });
    expect(edit.value).toBe('块');
    expect(edit.selection).toEqual({ start: 0, end: 1 });
  });

  it('inserts blank lines around a block placed between same-line content', () => {
    const edit = insertTemplate('前文后文', { start: 2, end: 2 }, '{{select:块}}', {
      block: true,
    });
    expect(edit.value).toBe('前文\n\n块\n\n后文');
    expect(edit.selection).toEqual({ start: 4, end: 5 });
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('块');
  });

  it('surrounds a block inserted at the start of a line', () => {
    const edit = insertTemplate('前文\n后文', { start: 3, end: 3 }, '块', { block: true });
    expect(edit.value).toBe('前文\n\n块\n\n后文');
    expect(edit.selection).toEqual({ start: 5, end: 5 });
  });

  it('adds only a leading blank line at the end of a non-empty line', () => {
    const edit = insertTemplate('前文', { start: 2, end: 2 }, '块', { block: true });
    expect(edit.value).toBe('前文\n\n块');
    expect(edit.selection).toEqual({ start: 5, end: 5 });
  });

  it('separates a block from content on the previous line', () => {
    const edit = insertTemplate('前文\n', { start: 3, end: 3 }, '块', { block: true });
    expect(edit.value).toBe('前文\n\n块');
    expect(edit.selection).toEqual({ start: 5, end: 5 });

    const emptyLine = insertTemplate('\n', { start: 1, end: 1 }, '块', { block: true });
    expect(emptyLine.value).toBe('\n块');
    expect(emptyLine.selection).toEqual({ start: 2, end: 2 });
  });

  it('keeps select offsets correct after block padding is added', () => {
    const edit = insertTemplate('开头结尾', { start: 2, end: 2 }, '**{{select:目标}}**', {
      block: true,
    });
    expect(edit.value).toBe('开头\n\n**目标**\n\n结尾');
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('目标');
    expect(edit.selection).toEqual({ start: 6, end: 8 });
  });

  it('keeps caret offsets correct after block padding is added', () => {
    const edit = insertTemplate('ab', { start: 1, end: 1 }, 'X{{caret}}Y', { block: true });
    expect(edit.value).toBe('a\n\nXY\n\nb');
    expect(edit.selection).toEqual({ start: 4, end: 4 });
    expect(edit.value.slice(0, edit.selection.start).endsWith('X')).toBe(true);
  });

  it('keeps fallback offsets correct after block padding is added', () => {
    const edit = insertTemplate('前文', { start: 2, end: 2 }, '{{selection:默认}}', {
      block: true,
    });
    expect(edit.value).toBe('前文\n\n默认');
    expect(edit.selection).toEqual({ start: 4, end: 6 });
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('默认');
  });

  it('resolves toolbar tokens nested inside reactive interpolation', () => {
    const edit = insertTemplate(
      '',
      { start: 0, end: 0 },
      '<if when="{{ {{select:true}} }}">\n内容\n</if>',
    );
    expect(edit.value).toBe('<if when="{{ true }}">\n内容\n</if>');
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe('true');
  });

  it('leaves ordinary reactive expressions untouched', () => {
    const edit = insertTemplate('', { start: 0, end: 0 }, '值：{{ 40 }}，光标{{caret}}。');
    expect(edit.value).toBe('值：{{ 40 }}，光标。');
    expect(edit.selection).toEqual({ start: 13, end: 13 });
  });
});

describe('out-of-range selections', () => {
  it('clamps and orders positions before formatting', () => {
    const wide = formatBold('abc', { start: -10, end: 99 });
    expect(wide.value).toBe('**abc**');
    expect(wide.selection).toEqual({ start: 2, end: 5 });

    const reversed = formatBold('abc', { start: 2, end: 0 });
    expect(reversed.value).toBe('**ab**c');
    expect(reversed.selection).toEqual({ start: 2, end: 4 });
  });

  it('clamps link selections', () => {
    const edit = insertLink('abc', { start: 99, end: -3 });
    expect(edit.value).toBe('[abc](https://example.com)');
    expect(edit.selection).toEqual({ start: 6, end: 25 });
  });

  it('clamps heading carets to the document end', () => {
    const edit = formatHeading('line', { start: 999, end: 999 }, 1);
    expect(edit.value).toBe('# line');
    expect(edit.selection).toEqual({ start: 6, end: 6 });
  });

  it('clamps and orders template selections', () => {
    const edit = insertTemplate('abc', { start: 999, end: -5 }, '{{selection}}');
    expect(edit.value).toBe('abc');
    expect(edit.selection).toEqual({ start: 3, end: 3 });
  });

  it('clamps an out-of-range selection for indentation', () => {
    const edit = indentSelection('', { start: -1, end: 1 });
    expect(edit.value).toBe('  ');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });
});
