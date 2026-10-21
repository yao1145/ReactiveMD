import { useEffect, useId, useRef, useState } from 'react';
import type { Capability, Diagnostic } from '../core';
import { DocumentSession, type CommittedDocument, type StorageAdapter } from '../session';
import { RuntimeDocumentView } from '../ui/viewer';

export interface ReactiveDocumentProps {
  source: string;
  documentId?: string;
  storage?: StorageAdapter;
  capabilities?: Record<string, Capability>;
  preserveState?: boolean;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

/** Embeddable React surface. The host supplies effects and optional persistence. */
export function ReactiveDocument({ source, documentId, storage, capabilities, preserveState = true, onDiagnostics }: ReactiveDocumentProps) {
  const instanceId = useId();
  const [view, setView] = useState<CommittedDocument | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const currentSession = useRef<DocumentSession | null>(null);
  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  useEffect(() => {
    const session = new DocumentSession({ id: documentId ?? instanceId, storage, runtime: { capabilities } });
    currentSession.current = session;
    return () => { session.dispose(); if (currentSession.current === session) currentSession.current = null; };
  }, [documentId, instanceId, storage, capabilities]);
  useEffect(() => {
    const session = currentSession.current;
    if (!session) return;
    const result = session.update(source, { preserveState });
    setDiagnostics(result.diagnostics);
    reportRef.current?.(result.diagnostics);
    setView(result.ok ? result : null);
  }, [documentId, instanceId, storage, capabilities, source, preserveState]);
  if (!view) return <div role="status">{diagnostics.length ? diagnostics.map(d => `${d.line}:${d.column} ${d.message}`).join('\n') : '正在准备文档…'}</div>;
  return <RuntimeDocumentView document={view.document} runtime={view.runtime}
    report={next => { setDiagnostics(next); reportRef.current?.(next); }} focusDiagnostic={() => {}} />;
}
