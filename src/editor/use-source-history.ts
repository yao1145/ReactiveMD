import { useCallback, useRef, useState } from 'react';
import type { EditorSelection } from './types';

export interface HistoryEntry {
  value: string;
  selection: EditorSelection;
}

export interface SourceHistoryStore {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  record(value: string, selection: EditorSelection, mode?: 'merge' | 'separate'): void;
  undo(): HistoryEntry | null;
  redo(): HistoryEntry | null;
  reset(value: string, selection?: EditorSelection): void;
}

export type SourceHistory = SourceHistoryStore;

const MERGE_WINDOW = 700;
const HISTORY_LIMIT = 120;
const START: EditorSelection = { start: 0, end: 0 };

export function createSourceHistory(
  initialValue: string,
  initialSelection: EditorSelection = START,
  now: () => number = Date.now,
): SourceHistoryStore {
  let entries: HistoryEntry[] = [{ value: initialValue, selection: initialSelection }];
  let index = 0;
  let lastRecordAt = 0;
  let mergeAllowed = false;

  const record: SourceHistoryStore['record'] = (value, selection, mode = 'merge') => {
    const current = entries[index];
    if (
      value === current.value
      && selection.start === current.selection.start
      && selection.end === current.selection.end
    ) return;

    const timestamp = now();
    const canMerge = mode === 'merge'
      && mergeAllowed
      && index > 0
      && index === entries.length - 1
      && timestamp - lastRecordAt < MERGE_WINDOW;

    if (canMerge) {
      entries[index] = { value, selection };
    } else {
      entries = entries.slice(0, index + 1);
      entries.push({ value, selection });
      if (entries.length > HISTORY_LIMIT) entries.shift();
      index = entries.length - 1;
    }
    lastRecordAt = timestamp;
    mergeAllowed = mode === 'merge';
  };

  const undo: SourceHistoryStore['undo'] = () => {
    if (index <= 0) return null;
    index -= 1;
    lastRecordAt = 0;
    mergeAllowed = false;
    return entries[index];
  };

  const redo: SourceHistoryStore['redo'] = () => {
    if (index >= entries.length - 1) return null;
    index += 1;
    lastRecordAt = 0;
    mergeAllowed = false;
    return entries[index];
  };

  const reset: SourceHistoryStore['reset'] = (value, selection = START) => {
    entries = [{ value, selection }];
    index = 0;
    lastRecordAt = 0;
    mergeAllowed = false;
  };

  return {
    get canUndo() { return index > 0; },
    get canRedo() { return index < entries.length - 1; },
    record,
    undo,
    redo,
    reset,
  };
}

export function useSourceHistory(
  initialValue: string,
  initialSelection: EditorSelection = START,
): SourceHistory {
  const store = useRef<SourceHistoryStore | null>(null);
  if (!store.current) store.current = createSourceHistory(initialValue, initialSelection);
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((version) => version + 1), []);

  const record = useCallback<SourceHistory['record']>((value, selection, mode) => {
    store.current!.record(value, selection, mode);
    bump();
  }, [bump]);

  const undo = useCallback<SourceHistory['undo']>(() => {
    const entry = store.current!.undo();
    bump();
    return entry;
  }, [bump]);

  const redo = useCallback<SourceHistory['redo']>(() => {
    const entry = store.current!.redo();
    bump();
    return entry;
  }, [bump]);

  const reset = useCallback<SourceHistory['reset']>((value, selection) => {
    store.current!.reset(value, selection);
    bump();
  }, [bump]);

  return {
    canUndo: store.current.canUndo,
    canRedo: store.current.canRedo,
    record,
    undo,
    redo,
    reset,
  };
}
