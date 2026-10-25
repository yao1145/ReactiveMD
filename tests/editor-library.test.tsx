import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/local/types';
import { ReactiveMarkdownEditor } from '../src/editor';
import type { ReactiveMarkdownEditorProps } from '../src/editor';
import { createSourceHistory } from '../src/editor/use-source-history';

function render(props: Partial<ReactiveMarkdownEditorProps> = {}): string {
  return renderToStaticMarkup(
    <ReactiveMarkdownEditor
      value="hello"
      onChange={() => {}}
      authoring={false}
      {...props}
    />,
  );
}

function diagnostic(line: number): Diagnostic {
  return {
    code: 'test.diagnostic',
    message: 'Something is wrong',
    severity: 'error',
    range: { start: 0, end: 1 },
    line,
    column: 1,
  };
}

describe('ReactiveMarkdownEditor public contract', () => {
  it('exports a forwardRef component with the editor root class', () => {
    expect((ReactiveMarkdownEditor as unknown as { $$typeof: symbol }).$$typeof)
      .toBe(Symbol.for('react.forward_ref'));
  });

  it('renders the editor shell, default toolbar and default height on the server', () => {
    const html = render();
    expect(html).toContain('class="reactive-md-editor"');
    expect(html).toContain('data-editor-theme="auto"');
    expect(html).toContain('class="editor-frame"');
    expect(html).toContain('height:560px');
    expect(html).toContain('min-height:280px');
    expect(html).toContain('class="editor-toolbar"');
    expect(html).toContain('editor-gutter');
    expect(html).toContain('editor-input');
    expect(html).toContain('editor-mirror');
    expect(html).toContain('>Reactive MD source<');
    expect(html).not.toContain('source-authoring');
  });

  it('turns the toolbar and authoring tools off independently', () => {
    const html = render({ toolbar: false, authoring: true });
    expect(html).not.toContain('class="editor-toolbar"');
    expect(html).toContain('class="source-authoring"');

    const bare = render({ toolbar: false, authoring: false });
    expect(bare).not.toContain('class="editor-toolbar"');
    expect(bare).not.toContain('class="source-authoring"');
  });

  it('applies Chinese copy, an explicit id and a dark theme per instance', () => {
    const html = render({ id: 'my-source', locale: 'zh', theme: 'dark' });
    expect(html).toContain('id="my-source"');
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('data-editor-theme="dark"');
    expect(html).toContain('文档编辑工具栏');
    expect(html).toContain('Reactive MD 源码');
  });

  it('keeps two instances independent in ids and themes', () => {
    const html = renderToStaticMarkup(
      <>
        <ReactiveMarkdownEditor value="one" onChange={() => {}} theme="light" authoring={false} />
        <ReactiveMarkdownEditor value="two" onChange={() => {}} theme="dark" authoring={false} />
      </>,
    );
    const ids = [...html.matchAll(/id="(reactive-md-editor-[^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(html).toContain('data-editor-theme="light"');
    expect(html).toContain('data-editor-theme="dark"');
  });

  it('escapes source text instead of rendering it as HTML', () => {
    const html = render({
      value: '<img src=x onerror="alert(1)">\n<script>alert(2)</script>',
      authoring: false,
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });

  it('forwards readOnly, disabled, height and minHeight', () => {
    const html = render({ readOnly: true, disabled: true, height: 480, minHeight: '300px' });
    expect(html).toMatch(/readonly=""/i);
    expect(html).toContain('disabled=""');
    expect(html).toContain('inert=""');
    expect(html).toContain('height:480px');
    expect(html).toContain('min-height:300px');
  });

  it('marks diagnostic lines in the gutter without changing the value', () => {
    const html = render({
      value: 'first\nsecond\nthird',
      diagnostics: [diagnostic(2)],
    });
    const marked = /class="gutter-line[^"]*is-diagnostic"[^>]*>(\d+)</.exec(html);
    expect(marked?.[1]).toBe('2');
    expect(html).toContain('second');
  });

  it('hides the download action unless a host handler exists', () => {
    expect(render()).not.toContain('aria-label="Download document"');
    const withExport = render({ onExport: () => {} });
    expect(withExport).toContain('aria-label="Download document"');
  });
});

describe('source history', () => {
  function setup(initial = 'a') {
    let clock = 0;
    return {
      history: createSourceHistory(initial, { start: 1, end: 1 }, () => clock),
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  it('starts clean and merges rapid typing into one step', () => {
    const { history, advance } = setup();
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBeNull();

    history.record('ab', { start: 2, end: 2 });
    advance(200);
    history.record('abc', { start: 3, end: 3 });
    expect(history.undo()).toEqual({ value: 'a', selection: { start: 1, end: 1 } });
    expect(history.redo()).toEqual({ value: 'abc', selection: { start: 3, end: 3 } });
  });

  it('starts a new step after the merge window and for separate edits', () => {
    const { history, advance } = setup();
    history.record('ab', { start: 2, end: 2 });
    advance(900);
    history.record('abc', { start: 3, end: 3 });
    history.record('**abc**', { start: 2, end: 5 }, 'separate');

    expect(history.undo()).toEqual({ value: 'abc', selection: { start: 3, end: 3 } });
    expect(history.undo()).toEqual({ value: 'ab', selection: { start: 2, end: 2 } });
    expect(history.undo()).toEqual({ value: 'a', selection: { start: 1, end: 1 } });
  });

  it('ignores an echoed no-op and resets to a host replacement', () => {
    const { history } = setup();
    history.record('ab', { start: 2, end: 2 });
    // The controlled value echoing the recorded edit adds no second entry.
    history.record('ab', { start: 2, end: 2 });
    expect(history.undo()).toEqual({ value: 'a', selection: { start: 1, end: 1 } });

    history.reset('fresh', { start: 0, end: 0 });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it('keeps separate stores isolated', () => {
    const first = createSourceHistory('one', { start: 3, end: 3 }, () => 0);
    const second = createSourceHistory('two', { start: 3, end: 3 }, () => 0);
    first.record('one!', { start: 4, end: 4 }, 'separate');

    expect(second.canUndo).toBe(false);
    expect(first.undo()).toEqual({ value: 'one', selection: { start: 3, end: 3 } });
  });
});
