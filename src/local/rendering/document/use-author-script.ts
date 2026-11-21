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
  targets: Map<string, number>;
  nextEpoch: number;
  resume(): void;
}

const actionKey = (target: string, action: AuthorAction) => `${target}:${action}`;
const EMPTY_TARGETS: Readonly<Record<string, string>> = Object.freeze({});

export function useAuthorScript(
  document: LocalDocument,
  runtime: LocalRuntime,
  enabled: boolean,
  paused: boolean,
  report: (diagnostics: Diagnostic[]) => void,
) {
  const capabilities = document.capabilities;
  const scriptsKey = enabled && capabilities?.scripts.length
    ? JSON.stringify(capabilities.scripts.map(item => item.text)) : '';
  const targets = capabilities?.actionTargets ?? EMPTY_TARGETS;
  const latest = useRef({ document, targets, paused, report });
  const active = useRef<ScriptSession | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = { document, targets, paused, report };
    const session = active.current;
    if (!session) return;
    // Keep registrations for the life of the script. A returning stable ID
    // can use its registration again, with a new epoch for its binding writes.
    for (const id of session.targets.keys()) {
      if (!Object.hasOwn(targets, id)) session.targets.delete(id);
    }
    for (const id of Object.keys(targets)) {
      if (!session.targets.has(id)) session.targets.set(id, ++session.nextEpoch);
    }
    if (!paused) queueMicrotask(session.resume);
  }, [document, targets, paused, report]);

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
        const IDs = Object.keys(latest.current.targets);
        const sessionTargets = new Map(IDs.map((id, index) => [id, index + 1]));
        const send = (message: AuthorWorkerInput) => opened.postMessage(message);
        const pending: Extract<AuthorWorkerOutput, { kind: 'request' }>[] = [];
        const reply = (data: typeof pending[number]) => {
          let result: AuthorBindingReply;
          try {
            result = data.target && sessionTargets.get(data.target.id) !== data.target.epoch
              ? { ok: false, message: 'The action target was removed.' }
              : applyRequest(runtime, data.request);
          } catch { result = { ok: false, message: 'The binding value is unavailable.' }; }
          if (!revoked) send({ kind: 'reply', id: data.id, result });
        };
        active.current = {
          worker: opened, actions, targets: sessionTargets, nextEpoch: IDs.length,
          resume() {
            // A replacement or revoked grant disposes this session before a
            // queued request can act on the newly committed document.
            while (!revoked && !latest.current.paused && pending.length) reply(pending.shift()!);
          },
        };
        opened.onmessage = ({ data }: MessageEvent<AuthorWorkerOutput>) => {
          if (revoked) return;
          if (data.kind === 'request') {
            if (latest.current.paused) pending.push(data);
            else reply(data);
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
        send({ kind: 'start', blocks: JSON.parse(scriptsKey), targets: IDs });
      } catch {
        if (revoked) return;
        reportFailure(0, 'Unable to create the isolated author JavaScript worker.');
        close();
      }
    });
    return close;
  }, [runtime, scriptsKey]);

  return useCallback((nodeId: string, action: AuthorAction) => {
    const session = active.current;
    if (!session || latest.current.paused) return false;
    const target = Object.keys(latest.current.targets).find(id => latest.current.targets[id] === nodeId);
    if (!target) return false;
    const epoch = session.targets.get(target);
    if (epoch === undefined) return false;
    const registered = session.actions.get(actionKey(target, action));
    if (!registered) return false;
    session.worker.postMessage({ kind: 'action', target: { id: target, epoch }, action } satisfies AuthorWorkerInput);
    return registered.takeover;
  }, []);
}
