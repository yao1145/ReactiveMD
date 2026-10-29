import { useEffect, useRef, useState } from 'react';
import { LocalCompileScheduler, localCompileOptionsKey } from 'reactive-md';
import type {
  LocalCompileMode,
  LocalCompileOptions,
  LocalCompileResult,
  LocalCompileWorker,
  AuthorAnalysis, LocalCompileEditHint,
} from 'reactive-md';

export type LocalCompiledDocument = Extract<LocalCompileResult, { ok: true }>['document'];

export interface LocalCompilation {
  analysis: {source:string;optionsKey:string;analysis:AuthorAnalysis}|null;
  /** Compile result for the exact source and routing options in use, once it exists. */
  result: LocalCompileResult | null;
  duration: number;
  /** Last successful document for the same options, kept while a newer compile runs. */
  previewDocument: LocalCompiledDocument | null;
  pending: boolean;
  mode: LocalCompileMode;
  /** Why the compile worker was abandoned, if it was. */
  failure: string | null;
}

interface CompilationState {
  analysis: AuthorAnalysis|null;
  resultSource: string | null;
  resultOptionsKey: string | null;
  result: LocalCompileResult | null;
  duration: number;
  previewDocument: LocalCompiledDocument | null;
  previewOptionsKey: string | null;
  schedulerPending: boolean;
  mode: LocalCompileMode;
  failure: string | null;
}

function createCompileWorker(): LocalCompileWorker {
  if (typeof Worker === 'undefined') throw new Error('This browser does not support Web Workers');
  return new Worker(
    new URL('./local-compile-worker.ts', import.meta.url),
    { type: 'module' },
  );
}

export function useLocalCompilation(
  source: string,
  options?: LocalCompileOptions,
  includeAuthorAnalysis = false,
  editHint?: LocalCompileEditHint,
): LocalCompilation {
  const optionsKey = localCompileOptionsKey(options);
  const [state, setState] = useState<CompilationState>(() => ({
    analysis: null,
    resultSource: null,
    resultOptionsKey: null,
    result: null,
    duration: 0,
    previewDocument: null,
    previewOptionsKey: null,
    schedulerPending: true,
    mode: 'worker',
    failure: null,
  }));
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const optionsKeyRef = useRef(optionsKey);
  optionsKeyRef.current = optionsKey;
  const schedulerRef = useRef<LocalCompileScheduler | null>(null);

  // The scheduler captures the routing options for each request. Rebuilding it
  // when a permission primitive changes (rather than reusing it for the same
  // source) means an older, more permissive result can never be delivered to
  // the new route. The previous preview is discarded during render below.
  useEffect(() => {
    const scheduledOptionsKey = optionsKey;
    const scheduler = new LocalCompileScheduler({
      includeAuthorAnalysis,
      createWorker: createCompileWorker,
      shareResults: true,
      // Coalesce a frame's edits without adding the library's conservative
      // 150 ms default to every local preview. In-flight work is still coalesced.
      delay: 20,
      onResult: (outcome) => {
        const outcomeOptionsKey = outcome.options === undefined
          ? scheduledOptionsKey
          : localCompileOptionsKey(outcome.options);
        setState((previous) => {
          if (outcome.source !== sourceRef.current) return previous;
          if (outcomeOptionsKey !== optionsKeyRef.current) return previous;
          return {
            ...previous,
            resultSource: outcome.source,
            resultOptionsKey: outcomeOptionsKey,
            result: outcome.result,
            analysis: outcome.analysis ?? null,
            duration: outcome.duration,
            previewDocument: outcome.result.ok ? outcome.result.document : previous.previewDocument,
            previewOptionsKey: outcome.result.ok ? outcomeOptionsKey : previous.previewOptionsKey,
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
    scheduler.schedule(sourceRef.current, optionsRef.current);
    return () => {
      schedulerRef.current = null;
      scheduler.dispose();
    };
  }, [optionsKey, includeAuthorAnalysis]);

  useEffect(() => {
    schedulerRef.current?.schedule(source, optionsRef.current, editHint);
  }, [source]);

  const sameRoute = state.resultOptionsKey === optionsKey;
  const result = state.resultSource === source && sameRoute ? state.result : null;
  // A preview compiled under another capability set is never shown, even for
  // the frame before the recompile completes.
  const previewDocument = state.previewOptionsKey === optionsKey ? state.previewDocument : null;
  return {
    analysis: result && state.analysis ? {source, optionsKey, analysis: state.analysis} : null,
    result,
    duration: result ? state.duration : 0,
    previewDocument,
    pending: state.schedulerPending || result === null,
    mode: state.mode,
    failure: state.failure,
  };
}
