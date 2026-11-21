import { useCallback, useLayoutEffect, useRef } from 'react';
import { SourceContext } from '../../source/source-context';
import type { Diagnostic, LocalDocument, LocalRuntime } from '../../types';
import type {
  AuthorAction,
  AuthorBindingReply,
  AuthorBindingRequest,
  AuthorWorkerInput,
  AuthorWorkerOutput,
} from '../../runtime/author-script-protocol';
import AuthorScriptWorker from '../../runtime/author-script.worker?worker&inline';

function applyRequest(runtime: LocalRuntime, request: AuthorBindingRequest): AuthorBindingReply {
  if (request.operation === 'get') {
    const { name } = request;
    const value = runtime.getParameter(name);
    if (value !== undefined) return { ok: true, value };
    if (Object.hasOwn(runtime.document.computations ?? {}, name)) {
      return { ok: true, value: runtime.evaluate(name) };
    }
    return { ok: false, message: `Unknown binding "${name}".` };
  }
  const diagnostics = request.operation === 'set'
    ? runtime.setParameter(request.name, request.value)
    : runtime.setParameters(request.values);
  return diagnostics.length ? { ok: false, message: diagnostics[0].message } : { ok: true };
}

interface ScriptSession {
  worker: Worker;
  actions: Map<string, { takeover: boolean }>;
}

const actionKey = (target: string, action: AuthorAction) => `${target}:${action}`;
const EMPTY_TARGETS: Readonly<Record<string, string>> = Object.freeze({});

export function useAuthorScript(
  document: LocalDocument,
  runtime: LocalRuntime,
  enabled: boolean,
  report: (diagnostics: Diagnostic[]) => void,
) {
  const capabilities = document.capabilities;
  const scriptsKey = enabled && capabilities?.scripts.length
    ? JSON.stringify(capabilities.scripts.map(item => item.text)) : '';
  const targets = capabilities?.actionTargets ?? EMPTY_TARGETS;
  const targetKey = JSON.stringify(Object.keys(targets).sort());
  const latest = useRef({ document, targets, report });
  const active = useRef<ScriptSession | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = { document, targets, report };
  }, [document, targets, report]);

  useLayoutEffect(() => {
    if (!scriptsKey) return;
    let revoked = false;
    let worker: Worker | undefined;
    const reportFailure = (block: number, message: string) => {
      const current = latest.current;
      const range = current.document.capabilities?.scripts[block]?.range ?? { start: 0, end: 0 };
      const source = new SourceContext(current.document.source);
      const line = source.lineIndexAt(range.start);
      current.report([{
        code: 'local.author.javascript', severity: 'warning',
        message, range, line: line + 1, column: range.start - source.lineStarts[line] + 1,
      }]);
    };
    const close = () => {
      revoked = true;
      if (active.current?.worker === worker) active.current = undefined;
      worker?.terminate();
    };
    // Start after the commit and the runtime's state restoration. React effect
    // replay cancels the first startup before it can evaluate any source.
    queueMicrotask(() => {
      if (revoked) return;
      try {
        const opened = new AuthorScriptWorker();
        worker = opened;
        const actions: ScriptSession['actions'] = new Map();
        active.current = { worker: opened, actions };
        const send = (message: AuthorWorkerInput) => opened.postMessage(message);
        opened.onmessage = ({ data }: MessageEvent<AuthorWorkerOutput>) => {
          if (revoked) return;
          if (data.kind === 'request') {
            let result: AuthorBindingReply;
            try { result = applyRequest(runtime, data.request); }
            catch { result = { ok: false, message: 'The binding value is unavailable.' }; }
            send({ kind: 'reply', id: data.id, result });
          } else if (data.kind === 'registered') {
            for (const item of data.registrations) {
              const key = actionKey(item.target, item.action);
              actions.set(key, { takeover: item.takeover || actions.get(key)?.takeover === true });
            }
          } else if (data.kind === 'diagnostic') {
            reportFailure(data.block, data.message);
          } else {
            reportFailure(0, data.message);
            close();
          }
        };
        opened.onerror = () => {
          if (revoked) return;
          reportFailure(0, 'Unable to start the isolated author JavaScript worker.');
          close();
        };
        send({ kind: 'start', blocks: JSON.parse(scriptsKey), targets: JSON.parse(targetKey) });
      } catch {
        if (revoked) return;
        reportFailure(0, 'Unable to create the isolated author JavaScript worker.');
        close();
      }
    });
    return close;
  }, [runtime, scriptsKey, targetKey]);

  return useCallback((nodeId: string, action: AuthorAction) => {
    const session = active.current;
    if (!session) return false;
    const target = Object.keys(latest.current.targets).find(id => latest.current.targets[id] === nodeId);
    if (!target) return false;
    const registered = session.actions.get(actionKey(target, action));
    if (!registered) return false;
    session.worker.postMessage({ kind: 'action', target, action } satisfies AuthorWorkerInput);
    return registered.takeover;
  }, []);
}
