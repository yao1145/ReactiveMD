import type { AuthorBindingReply, AuthorBindingRequest, AuthorWorkerInput, AuthorWorkerOutput } from './author-script-protocol';
import { createAuthorScriptVm } from './author-script-vm';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AuthorWorkerInput>) => void) | null;
  postMessage(message: AuthorWorkerOutput): void;
};
let requestId = 0;
let started = false;
let failed = false;
let session: Awaited<ReturnType<typeof createAuthorScriptVm>> | undefined;
let queue = Promise.resolve();
let pendingActions = 0;
const replies = new Map<number, (value: AuthorBindingReply) => void>();

function request(value: AuthorBindingRequest): Promise<AuthorBindingReply> {
  const id = ++requestId;
  return new Promise(resolve => {
    replies.set(id, resolve);
    worker.postMessage({ kind: 'request', id, request: value });
  });
}

function enqueue(task: () => Promise<void>) {
  queue = queue.then(async () => {
    if (failed) return;
    try {
      await task();
    } catch (error) {
      failed = true;
      session?.dispose();
      worker.postMessage({
        kind: 'failed', message: error instanceof Error ? error.message.slice(0, 300) : 'Unable to start author JavaScript.',
      });
    }
  });
}

worker.onmessage = ({ data }) => {
  if (data.kind === 'reply') {
    const resolve = replies.get(data.id);
    replies.delete(data.id);
    resolve?.(data.result);
  } else if (data.kind === 'start' && !started) {
    started = true;
    enqueue(async () => {
      session = await createAuthorScriptVm(
        data.targets,
        request,
        registrations => worker.postMessage({ kind: 'registered', registrations }),
        (block, message) => worker.postMessage({ kind: 'diagnostic', block, message }),
      );
      await session.initialize(data.blocks);
    });
  } else if (data.kind === 'action' && started && !failed) {
    if (pendingActions >= 128) {
      failed = true;
      worker.postMessage({ kind: 'failed', message: 'Author JavaScript action queue is full.' });
      return;
    }
    pendingActions += 1;
    enqueue(async () => {
      try {
        await session?.dispatch(data.target, data.action);
      } finally {
        pendingActions -= 1;
      }
    });
  }
};
