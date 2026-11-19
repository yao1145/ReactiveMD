import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { LocalComponentContext } from '../../react/component-api';
import type { LocalSubmissionFieldsResult } from '../../local/contracts/types';
import {
  staticText,
  textAttr,
  useComponentView,
  useResetToken,
} from '../../react/component-utils';
import { defineLocalComponent } from '../../sdk/manifest';
import { LOCAL_COMPONENT_PROTOCOL, LOCAL_SDK_VERSION } from '../../sdk/version';
import type { ComponentNetwork } from '../../runtime-services/network';

/**
 * The official optional submit control. It reads one snapshot of the authored
 * fields and asks the runtime to send it through a named channel. The document
 * never contains endpoints or credentials; only the channel name is public.
 */
export const submitButtonDefinition = defineLocalComponent({
  id: 'reactive-md/submit-button',
  name: 'submit-button',
  version: LOCAL_SDK_VERSION,
  protocol: LOCAL_COMPONENT_PROTOCOL,
  form: 'leaf',
  props: {
    channel: { kind: 'string', static: true, required: true },
    fields: { kind: 'string', static: true, required: true },
    label: { kind: 'string', coerce: 'text' },
    disabled: { kind: 'boolean', dynamic: true, default: false },
  },
  structure: { rule: 'none', label: 'none' },
  rules: [
    { kind: 'nonempty', attribute: 'channel' },
    { kind: 'nonempty', attribute: 'fields' },
    { kind: 'dynamic-constraints', attributes: ['disabled'] },
  ],
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  styles: ['reactive-md/network.css'],
  authoring: {
    title: { en: 'Submit button', zh: '提交按钮' },
    description: {
      en: 'Send the selected fields to a channel the host enabled.',
      zh: '把所选字段提交到宿主开放的通道。',
    },
    category: 'action',
    insertText: '<submit-button channel="answers" fields="choice comment">',
  },
});

type SubmitTone = 'pending' | 'success' | 'warning' | 'error';

interface SubmitStatus {
  readonly tone: SubmitTone;
  readonly text: string;
  /** Field named by a pre-send or post-send rejection. */
  readonly field?: string;
}

/** Space-separated public binding names; null when empty or repeated. */
export function parseSubmissionFields(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const names = raw.trim().split(/\s+/).filter((name) => name !== '');
  if (names.length === 0) return null;
  if (new Set(names).size !== names.length) return null;
  if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) return null;
  return names;
}

function supportsSubmit(network: ComponentNetwork | undefined, channel: string): network is ComponentNetwork {
  if (!network || channel === '') return false;
  try {
    return network.supports(channel, 'submit');
  } catch {
    return false;
  }
}

function createIdempotencyKey(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `submit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function SubmitButtonView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const { mode, visible, t } = view;
  const network = context.services.network;
  const channelProp = context.props.channel;
  const channel = typeof channelProp === 'string' ? channelProp.trim() : '';
  const fieldsProp = context.props.fields;
  const fields = typeof fieldsProp === 'string' ? parseSubmissionFields(fieldsProp) : null;
  const label = textAttr(context, 'label', t('Submit', '提交'));

  const [status, setStatus] = useState<SubmitStatus | null>(null);
  const busy = status?.tone === 'pending';
  /** The current controller locks the button synchronously and identifies its result. */
  const controller = useRef<AbortController | null>(null);
  /** Key and payload signature retained only while a send stays unconfirmed. */
  const unconfirmed = useRef<{ key: string; signature: string } | null>(null);

  const cancel = useCallback(() => {
    const pending = controller.current;
    controller.current = null;
    pending?.abort();
  }, []);

  useLayoutEffect(() => {
    unconfirmed.current = null;
    setStatus(null);
    return cancel;
  }, [channel, fieldsProp, network, mode, cancel]);

  useResetToken(context, () => {
    cancel();
    unconfirmed.current = null;
    setStatus(null);
  });

  if (mode === 'static') {
    return (
      <span
        className="local-submit-button local-submit-button-static"
        data-rmd-static-submit=""
        aria-disabled="true"
        hidden={!visible || undefined}
      >
        {staticText(label)}
      </span>
    );
  }

  const unavailable = channel === ''
    ? t('This button has no submit channel.', '此按钮未配置提交通道。')
    : fields === null
      ? t('List valid field names without duplicates.', '请填写有效且不重复的字段名。')
      : !supportsSubmit(network, channel)
        ? t('Submitting is not enabled for this channel.', '此通道未开放提交。')
        : undefined;

  const click = (): void => {
    if (!visible || context.disabled || controller.current || !fields || !supportsSubmit(network, channel)) return;

    // Exactly one snapshot per click. A retained draft never exposes the last
    // committed value: the runtime reports the affected field instead.
    let snapshot: LocalSubmissionFieldsResult;
    try {
      snapshot = context.runtime.readSubmissionFields?.(fields)
        ?? { ok: false, field: fields[0], reason: 'unavailable' };
    } catch {
      snapshot = { ok: false, field: fields[0], reason: 'unavailable' };
    }
    if (!snapshot.ok) {
      const field = snapshot.field;
      const text = snapshot.reason === 'required' ? t(`Field "${field}" is required.`, `字段“${field}”为必填项。`)
        : snapshot.reason === 'invalid' ? t(`Field "${field}" has an invalid value.`, `字段“${field}”的值无效。`)
          : t(`Field "${field}" is unavailable.`, `无法读取字段“${field}”。`);
      setStatus({ tone: 'error', text, field });
      return;
    }

    const payload = snapshot.payload;
    const signature = JSON.stringify(payload);
    if (unconfirmed.current?.signature !== signature) unconfirmed.current = null;
    const key = unconfirmed.current?.key ?? createIdempotencyKey();
    const pending = new AbortController();
    controller.current = pending;
    setStatus({ tone: 'pending', text: t('Submitting…', '正在提交…') });

    void (async () => {
      let result: Awaited<ReturnType<ComponentNetwork['submit']>>;
      try {
        result = await network.submit(channel, payload, {
          signal: pending.signal,
          idempotencyKey: key,
        });
      } catch {
        result = { ok: false, error: { code: 'transport', message: '' } };
      }
      if (controller.current !== pending) return;
      controller.current = null;

      if (result.ok) {
        unconfirmed.current = null;
        setStatus({ tone: 'success', text: t('Submitted.', '已提交。') });
        return;
      }
      const error = result.error;
      const detail = error.message.trim();
      if (error.code === 'cancelled') {
        setStatus(null);
        return;
      }
      if (error.code === 'unconfirmed') {
        // Retrying the same payload reuses this key; a changed payload gets a
        // new one. Confirmation or explicit rejection consumes it.
        unconfirmed.current = { key, signature };
        setStatus({
          tone: 'warning',
          text: t(
            'Submission result is unconfirmed. Retry to send the same fields again.',
            '提交结果未确认。可手动重试同一组字段。',
          ),
        });
        return;
      }
      if (error.code === 'transport') {
        setStatus({ tone: 'error', text: detail || t('The submission could not be sent.', '发送提交失败。') });
        return;
      }
      if (error.code === 'rejected' || error.code === 'invalid-data') {
        unconfirmed.current = null;
        setStatus({
          tone: 'error',
          text: detail
            ? t(`Submission was rejected: ${detail}`, `提交被拒绝：${detail}`)
            : t('Submission was rejected.', '提交被拒绝。'),
        });
        return;
      }
      unconfirmed.current = null;
      setStatus({
        tone: 'error',
        text: t('Submitting is not enabled for this channel.', '此通道未开放提交。'),
      });
    })();
  };

  return (
    <div
      className="local-submit-button-control"
      data-rmd-component="submit-button"
      data-field={status?.field}
      hidden={!visible || undefined}
    >
      <button
        type="button"
        className="md-button md-button-primary local-submit-button"
        disabled={context.disabled || busy || unavailable !== undefined}
        aria-busy={busy || undefined}
        aria-describedby={`${domId}-submit-status`}
        onClick={click}
      >
        {label}
      </button>
      <span
        id={`${domId}-submit-status`}
        className="local-submit-button-status"
        role="status"
        data-tone={unavailable ? 'error' : status?.tone ?? 'idle'}
      >
        {unavailable ?? status?.text ?? ''}
      </span>
    </div>
  );
}
