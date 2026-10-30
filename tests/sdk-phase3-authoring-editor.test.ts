import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import type { EditorEdit } from '../src/authoring';
import { insertLocalComponentFromOptions } from '../src/authoring';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent } from '../src/sdk/manifest';
import type { LocalComponentDefinition } from '../src/sdk/types';
import type { LocalCompileOptions } from '../src/local';

const CAPABILITIES = {
  interactive: true,
  static: true,
  ssr: true,
  offline: true,
} as const;

const card: LocalComponentDefinition = defineLocalComponent({
  id: 'example/editor-card',
  name: 'editor-card',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'container',
  props: { title: { kind: 'string' } },
  structure: { rule: 'any', label: 'none' },
  capabilities: CAPABILITIES,
  authoring: {
    title: { en: 'Editor card' },
    description: { en: 'A container used to verify editing history.' },
    category: 'layout',
    insertText: '<editor-card title="Card">\n{{selection:Body text}}\n</editor-card>',
  },
});

const options = {
  config: createLocalConfig({ components: [card] }),
} as LocalCompileOptions;

function applyEdit(state: EditorState, edit: EditorEdit): EditorState {
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: edit.value },
    selection: { anchor: edit.selection.start },
    annotations: isolateHistory.of('full'),
  }).state;
}

function runCommand(state: EditorState, command: typeof undo): EditorState {
  let next = state;
  command({
    state,
    dispatch: (transaction: Transaction) => { next = transaction.state; },
  });
  return next;
}

describe('P3.1 insertion editing and undo/redo', () => {
  it('inserts a selection-aware template as one undoable change', () => {
    const state = EditorState.create({ doc: '', extensions: [history()] });
    const edit = insertLocalComponentFromOptions(
      options,
      'example/editor-card',
      '',
      { start: 0, end: 0 },
      'en',
    );
    const bodyStart = edit.value.indexOf('Body text');
    expect(edit.selection).toEqual({ start: bodyStart, end: bodyStart + 'Body text'.length });

    const inserted = applyEdit(state, edit);
    expect(inserted.doc.toString()).toBe(edit.value);

    const undone = runCommand(inserted, undo);
    expect(undone.doc.toString()).toBe('');
    const redone = runCommand(undone, redo);
    expect(redone.doc.toString()).toBe(edit.value);
  });

  it('keeps repeated insertions as separate history events with fresh bindings', () => {
    const state = EditorState.create({ doc: '', extensions: [history()] });
    const first = insertLocalComponentFromOptions(
      options,
      'example/editor-card',
      '',
      { start: 0, end: 0 },
      'en',
    );
    const afterFirst = applyEdit(state, first);
    const second = insertLocalComponentFromOptions(
      options,
      'example/editor-card',
      afterFirst.doc.toString(),
      { start: afterFirst.doc.length, end: afterFirst.doc.length },
      'en',
    );
    const afterSecond = applyEdit(afterFirst, second);
    expect(afterSecond.doc.toString().match(/<editor-card /g)).toHaveLength(2);

    const undoSecond = runCommand(afterSecond, undo);
    expect(undoSecond.doc.toString()).toBe(afterFirst.doc.toString());
    const undoFirst = runCommand(undoSecond, undo);
    expect(undoFirst.doc.toString()).toBe('');

    const redoFirst = runCommand(undoFirst, redo);
    expect(redoFirst.doc.toString()).toBe(afterFirst.doc.toString());
    const redoSecond = runCommand(redoFirst, redo);
    expect(redoSecond.doc.toString()).toBe(afterSecond.doc.toString());
  });
});
