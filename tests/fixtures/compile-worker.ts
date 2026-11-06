import { LOCAL_RESULT_PATCH_PROTOCOL } from '../../src/local/transport/compile-patch';
import type {
  LocalCompilePatchRequest,
  LocalCompileRequest,
  LocalCompileWorker,
  LocalCompileWorkerRequest,
  LocalCompileWorkerResponse,
} from '../../src/local/transport/worker';
import type { LocalCompileResult, LocalNode, LocalRecovery } from '../../src/local/contracts/types';

/** A typed scheduler-side worker double shared by the transport tests. */
export class FakeWorker implements LocalCompileWorker {
  onmessage: ((event: MessageEvent<LocalCompileWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  /** Every post, including incremental requests without a source. */
  readonly requests: LocalCompileWorkerRequest[] = [];
  /** Complete-source posts only, for backwards-compatible assertions. */
  readonly messages: LocalCompileRequest[] = [];
  terminated = false;

  postMessage(message: LocalCompileWorkerRequest): void {
    this.requests.push(message);
    if ('source' in message && typeof message.source === 'string') {
      this.messages.push(message);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  receive(response: LocalCompileWorkerResponse): void {
    this.onmessage?.({ data: response } as unknown as MessageEvent<LocalCompileWorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as unknown as ErrorEvent);
  }
}

export function okResult(
  source: string,
  recoveries?: readonly LocalRecovery[],
  nodes: readonly LocalNode[] = [],
): LocalCompileResult {
  return {
    ok: true,
    document: { syntax: 'local', source, nodes: [...nodes], initialState: {}, bindings: {} },
    diagnostics: [],
    ...(recoveries === undefined ? {} : { recoveries: [...recoveries] }),
  };
}

export function textNode(id: string, value: string, length = value.length): LocalNode {
  return {
    type: 'text',
    id,
    range: { start: 0, end: length },
    value,
  };
}

export function nodeResult(source: string, value: string): LocalCompileResult {
  return okResult(source, undefined, [{
    type: 'paragraph',
    id: 'p',
    range: { start: 0, end: source.length },
    children: [textNode('p-text', value, source.length)],
  }]);
}

export function fullRequest(request: LocalCompileWorkerRequest): LocalCompileRequest {
  if (!('source' in request)) throw new Error('expected a complete-source request');
  return request;
}

export function patchRequest(request: LocalCompileWorkerRequest): LocalCompilePatchRequest {
  if (!('edit' in request)) throw new Error('expected an incremental request');
  return request;
}

export function negotiatedResponse(
  request: LocalCompileRequest,
  result: LocalCompileResult,
): LocalCompileWorkerResponse {
  return {
    id: request.id,
    ok: true,
    result,
    duration: 1,
    protocol: LOCAL_RESULT_PATCH_PROTOCOL,
    revision: request.revision ?? 1,
  };
}
