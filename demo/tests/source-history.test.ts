import { describe, expect, it } from 'vitest';
import { createSourceHistory } from '../src/use-source-history';

function setup(initial = 'a') {
  let clock = 0;
  const history = createSourceHistory(initial, { start: 1, end: 1 }, () => clock);
  return {
    history,
    advance(ms: number) { clock += ms; },
  };
}

describe('source history', () => {
  it('starts without undo or redo', () => {
    const { history } = setup();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it('merges rapid typing into a single undo step and restores caret', () => {
    const { history, advance } = setup();
    history.record('ab', { start: 2, end: 2 });
    advance(200);
    history.record('abc', { start: 3, end: 3 });
    expect(history.canUndo).toBe(true);

    expect(history.undo()).toEqual({ value: 'a', selection: { start: 1, end: 1 } });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    expect(history.redo()).toEqual({ value: 'abc', selection: { start: 3, end: 3 } });
  });

  it('starts a new step after the merge window', () => {
    const { history, advance } = setup();
    history.record('ab', { start: 2, end: 2 });
    advance(900);
    history.record('abc', { start: 3, end: 3 });

    expect(history.undo()).toEqual({ value: 'ab', selection: { start: 2, end: 2 } });
    expect(history.undo()).toEqual({ value: 'a', selection: { start: 1, end: 1 } });
  });

  it('keeps formatting edits separate from following typing', () => {
    const { history } = setup();
    history.record('**a**', { start: 2, end: 3 }, 'separate');
    history.record('**ab**', { start: 3, end: 4 });

    expect(history.undo()).toEqual({ value: '**a**', selection: { start: 2, end: 3 } });
    expect(history.undo()).toEqual({ value: 'a', selection: { start: 1, end: 1 } });
  });

  it('drops redo steps after a new edit', () => {
    const { history, advance } = setup();
    history.record('ab', { start: 2, end: 2 });
    history.undo();
    advance(10);
    history.record('ax', { start: 2, end: 2 });

    expect(history.canRedo).toBe(false);
    expect(history.undo()).toEqual({ value: 'a', selection: { start: 1, end: 1 } });
  });

  it('ignores no-op records and resets to a clean baseline', () => {
    const { history } = setup();
    history.record('a', { start: 1, end: 1 });
    expect(history.canUndo).toBe(false);

    history.record('ab', { start: 2, end: 2 });
    history.reset('fresh', { start: 0, end: 0 });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
  });
});
