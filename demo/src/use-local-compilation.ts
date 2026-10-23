import { useEffect, useRef, useState } from 'react';
import { compileLocal } from 'reactive-md';
import type { LocalCompileResult } from 'reactive-md';
import {
  LocalCompileScheduler,
  type LocalCompileMode,
  type LocalCompileWorker,
} from './local-compile-scheduler';

export type LocalCompiledDocument = Extract<LocalCompileResult, { ok: true }>['document'];

export interface LocalCompilation {
  /** Compile result for the exact source currently in the editor, once it exists. */
  result: LocalCompileResult | null;
  duration: number;
  /** Last successful document, kept on screen while a newer compile runs. */
  previewDocument: LocalCompiledDocument | null;
  pending: boolean;
  mode: LocalCompileMode;
  /** Why the compile worker was abandoned, if it was. */
  failure: string | null;
}

interface CompilationState {
  resultSource: string | null;
  result: LocalCompileResult | null;
  duration: number;
  previewDocument: LocalCompiledDocument | null;
  schedulerPending: boolean;
  mode: LocalCompileMode;
  failure: string | null;
}

function createCompileWorker(): LocalCompileWorker {
  if (typeof Worker === 'undefined') throw new Error('This browser does not support Web Workers');
  return new Worker(
    new URL('./local-compile-worker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as LocalCompileWorker;
}

export function useLocalCompilation(source: string): LocalCompilation {
  const [state, setState] = useState<CompilationState>(() => ({
    resultSource: null,
    result: null,
    duration: 0,
    previewDocument: null,
    schedulerPending: true,
    mode: 'worker',
    failure: null,
  }));
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const schedulerRef = useRef<LocalCompileScheduler | null>(null);

  useEffect(() => {
    const scheduler = new LocalCompileScheduler({
      createWorker: createCompileWorker,
      fallbackCompile: compileLocal,
      onResult: (outcome) => {
        setState((previous) => {
          if (outcome.source !== sourceRef.current) return previous;
          return {
            ...previous,
            resultSource: outcome.source,
            result: outcome.result,
            duration: outcome.duration,
            previewDocument: outcome.result.ok ? outcome.result.document : previous.previewDocument,
            mode: outcome.mode,
          };
        });
      },
      onPendingChange: (pending) => {
        setState((previous) => (
          previous.schedulerPending === pending ? previous : { ...previous, schedulerPending: pending }
        ));
      },
      onModeChange: (mode, detail) => {
        setState((previous) => ({
          ...previous,
          mode,
          failure: detail ?? previous.failure,
        }));
      },
    });
    schedulerRef.current = scheduler;
    scheduler.schedule(sourceRef.current);
    return () => {
      schedulerRef.current = null;
      scheduler.dispose();
    };
  }, []);

  useEffect(() => {
    schedulerRef.current?.schedule(source);
  }, [source]);

  const result = state.resultSource === source ? state.result : null;
  return {
    result,
    duration: result ? state.duration : 0,
    previewDocument: state.previewDocument,
    pending: state.schedulerPending || result === null,
    mode: state.mode,
    failure: state.failure,
  };
}
