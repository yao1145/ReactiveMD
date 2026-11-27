import { useEffect, useMemo, useState, type ReactNode } from 'react';

/** Return host data (or a Promise for it). Only undefined means missing. */
export type LocalStaticHostDataResolver = (input: {
  readonly kind: string;
  readonly ref: string;
  readonly signal: AbortSignal;
}) => unknown;

export function StaticHostData({ kind, reference, resolve, render, placeholder }: {
  kind: string;
  reference: string;
  resolve: LocalStaticHostDataResolver;
  render: (data: unknown) => ReactNode;
  placeholder: (reason: 'loading' | 'data' | 'error') => ReactNode;
}) {
  const request = useMemo(() => ({ kind, ref: reference, resolve }), [kind, reference, resolve]);
  const [result, setResult] = useState<
    { request: typeof request; data: unknown } | { request: typeof request; failed: true }
  >();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.resolve().then(() => {
      if (!signal.aborted) return request.resolve({ kind: request.kind, ref: request.ref, signal });
    }).then(data => {
      if (!signal.aborted) setResult({ request, data });
    }, () => {
      if (!signal.aborted) setResult({ request, failed: true });
    });
    return () => controller.abort();
  }, [request]);

  if (result?.request !== request) return placeholder('loading');
  if ('failed' in result) return placeholder('error');
  return result.data === undefined ? placeholder('data') : render(result.data);
}
