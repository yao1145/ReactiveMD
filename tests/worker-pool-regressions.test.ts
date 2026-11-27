import { describe, expect, it } from 'vitest';
import {
  startLocalCompileWorker,
  type LocalCompileWorker,
  type LocalCompileWorkerRequest,
  type LocalCompileWorkerResponse,
  type LocalCompileWorkerScope,
} from '../src/local/transport/worker';
import { createLocalCompilePool } from '../src/local/transport/worker-pool';
import { MAX_LOCAL_DOCUMENT_LENGTH } from '../src/contracts/limits';

/** A real worker handler behind a fake scope; the pool owns the fake worker. */
function workerSlot() {
  const jobs: LocalCompileWorkerRequest[] = [];
  const scope: LocalCompileWorkerScope = {
    onmessage: null,
    postMessage: data => { worker.onmessage?.({ data }); },
  };
  const worker: LocalCompileWorker = {
    postMessage: request => { jobs.push(request); },
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: () => control.dispose(),
  };
  const control = startLocalCompileWorker(scope);
  const answer = () => (scope.onmessage as ((event: { data: unknown }) => void) | null)?.({ data: jobs.shift() });
  return { worker, jobs, answer, control };
}

describe('worker pool result status', () => {
  it('derives a patched result status from its own recoveries, not the baseline', async () => {
    const slot = workerSlot();
    const pool = createLocalCompilePool({ workers: 1, createWorker: () => slot.worker });
    try {
      const first = pool.schedule({ documentId: 'doc', revision: 0, source: 'Text', options: { strict: false } });
      await Promise.resolve();
      slot.answer();
      const baseline = await first;
      expect(baseline.result).toMatchObject({ ok: true, status: 'valid' });
      expect('recoveries' in baseline.result).toBe(false);

      // The unclosed <card> is repaired into a literal fallback until the
      // heading, which produces one recovery and therefore status 'recovered'.
      const damaged = '<card>\nopen\n\n## Later\n\nAfter **bold**';
      const patched = pool.schedule({ documentId: 'doc', revision: 1, source: damaged, options: { strict: false } });
      await Promise.resolve();
      expect(slot.jobs[0]).toMatchObject({ protocol: 'patch-v1', documentId: 'doc', baseRevision: 0, revision: 1 });
      slot.answer();
      const outcome = await patched;
      expect(outcome.mode).toBe('worker');
      expect(outcome.result).toMatchObject({ ok: true, status: 'recovered' });
      if (!outcome.result.ok) return;
      expect(outcome.result.recoveries?.length).toBeGreaterThan(0);
      expect(outcome.result.document.source).toBe(damaged);
    } finally {
      pool.dispose();
    }
  });
});

describe('worker pool document state', () => {
  it('rejects an oversized source before it reaches the queue', async () => {
    const slot = workerSlot();
    const pool = createLocalCompilePool({ workers: 1, createWorker: () => slot.worker });
    try {
      await expect(pool.schedule({
        documentId: 'doc', revision: 0, source: 'x'.repeat(MAX_LOCAL_DOCUMENT_LENGTH + 1),
      })).rejects.toMatchObject({ kind: 'source-too-large' });
      await Promise.resolve();
      expect(slot.jobs).toHaveLength(0);

      const accepted = pool.schedule({ documentId: 'doc', revision: 0, source: 'ok' });
      await Promise.resolve();
      slot.answer();
      expect((await accepted).result.ok).toBe(true);
    } finally {
      pool.dispose();
    }
  });

  it('releases a closed document and its pending tasks', async () => {
    const slot = workerSlot();
    const pool = createLocalCompilePool({ workers: 1, createWorker: () => slot.worker });
    try {
      const first = pool.schedule({ documentId: 'doc', revision: 5, source: 'One' });
      await Promise.resolve();
      slot.answer();
      await first;
      await expect(pool.schedule({ documentId: 'doc', revision: 5, source: 'Again' }))
        .rejects.toMatchObject({ kind: 'invalid-revision' });

      const pending = pool.schedule({ documentId: 'doc', revision: 6, source: 'Pending' });
      pool.release('doc');
      await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });

      const fresh = pool.schedule({ documentId: 'doc', revision: 0, source: 'Fresh' });
      await Promise.resolve();
      slot.answer();
      const outcome = await fresh;
      expect(outcome.revision).toBe(0);
      expect(outcome.result.ok).toBe(true);
    } finally {
      pool.dispose();
    }
  });
});

describe('worker router revisions', () => {
  function createScope() {
    const responses: LocalCompileWorkerResponse[] = [];
    const scope: LocalCompileWorkerScope = {
      onmessage: null,
      postMessage: message => { responses.push(message); },
    };
    const control = startLocalCompileWorker(scope);
    return { scope, responses, control };
  }

  it('serves a document-scoped request that omits the optional revision', () => {
    const { scope, responses, control } = createScope();
    try {
      scope.onmessage?.({ data: { id: 1, documentId: 'doc', source: 'text' } });
      expect(responses).toHaveLength(1);
      const response = responses[0];
      expect(response).toMatchObject({ id: 1, documentId: 'doc', ok: true });
      if (response.ok && 'result' in response) {
        expect(response.result).toMatchObject({ ok: true, document: { source: 'text' } });
      }
      // A present but malformed revision is still a protocol error.
      scope.onmessage?.({ data: { id: 2, documentId: 'doc', source: 'text', revision: -1 } });
      expect(responses[1]).toMatchObject({ id: 2, ok: false });
    } finally {
      control.dispose();
    }
  });
});