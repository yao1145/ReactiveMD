import { useEffect, useState } from 'react';
import type { LocalRuntimePool } from '../../../local/runtime/runtime-pool';
import type { LocalRuntime, LocalRuntimeOptions } from '../../../local/types';
import { LocalDocumentView, type LocalDocumentViewProps } from './LocalDocumentView';

export interface LocalPooledDocumentViewProps extends Omit<LocalDocumentViewProps, 'runtime'> {
  pool: LocalRuntimePool;
  runtimeOptions?: LocalRuntimeOptions;
}

export function LocalPooledDocumentView({ pool, runtimeOptions, ...props }: LocalPooledDocumentViewProps) {
  const { document } = props;
  const [current, setCurrent] = useState<{
    pool: LocalRuntimePool; document: typeof document; options?: LocalRuntimeOptions; runtime: LocalRuntime;
  }>();
  useEffect(() => {
    const lease = pool.acquire(document, runtimeOptions);
    setCurrent({ pool, document, options: runtimeOptions, runtime: lease.runtime });
    return lease.release;
  }, [pool, document, runtimeOptions]);
  if (current?.pool !== pool || current.document !== document || current.options !== runtimeOptions) return null;
  return <LocalDocumentView {...props} runtime={current.runtime} />;
}
