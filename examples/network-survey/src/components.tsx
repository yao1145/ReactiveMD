import { useEffect, useState } from 'react';
import { createReactHost, defineReactComponent, type LocalComponentContext } from 'reactive-md/react/minimal';
import { defineLocalComponent } from 'reactive-md/sdk';
import { minimalReactPresetPackage } from 'reactive-md/presets/minimal/react';
import networkPreset from 'reactive-md/plugins/network';

/**
 * Two independent components that subscribe to the same `results` channel.
 * Neither knows the endpoint, the transport or the credentials: the host
 * hands both a `ComponentNetwork` through `context.services.network`.
 */

interface Counts {
  readonly yes: number;
  readonly no: number;
}

type Phase = 'idle' | 'connecting' | 'open' | 'closed';

function textProp(context: LocalComponentContext, name: string, fallback: string): string {
  const value = context.props[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readCounts(value: unknown): Counts | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as { readonly [key: string]: unknown };
  const yes = record.yes;
  const no = record.no;
  if (typeof yes !== 'number' || !Number.isInteger(yes) || yes < 0) return null;
  if (typeof no !== 'number' || !Number.isInteger(no) || no < 0) return null;
  return { yes, no };
}

function useResults(context: LocalComponentContext, channel: string) {
  const network = context.services.network;
  const visible = context.visible;
  const supported = network !== undefined && network.supports(channel, 'subscribe');
  const active = visible && supported;
  const [counts, setCounts] = useState<Counts | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || network === undefined || !network.supports(channel, 'subscribe')) return;
    setProblem(null);
    return network.subscribe(channel, (event) => {
      if (event.type === 'status') {
        setPhase(event.state);
        if (event.state === 'open') setProblem(null);
      } else if (event.type === 'data') {
        const next = readCounts(event.value);
        // A host may resend the same snapshot; identical values keep the
        // previous object so the component does not re-render.
        if (next !== null) setCounts((previous) => previous !== null
          && previous.yes === next.yes && previous.no === next.no ? previous : next);
      } else {
        setProblem(event.error.message);
      }
    });
  }, [network, channel, visible]);

  return { active, supported, counts, phase, problem };
}

function statusLabel(active: boolean, supported: boolean, phase: Phase, problem: string | null): string {
  if (!supported) return '此页面未开放 results 订阅';
  if (!active) return '已暂停（组件隐藏）';
  if (problem !== null) return problem;
  if (phase === 'connecting') return '连接中';
  if (phase === 'open') return '已连接';
  if (phase === 'closed') return '连接已关闭';
  return '等待订阅';
}

function statusTone(active: boolean, problem: string | null, phase: Phase): string {
  if (problem !== null) return 'warning';
  if (!active) return 'neutral';
  if (phase === 'open') return 'success';
  if (phase === 'closed') return 'danger';
  return 'neutral';
}

function share(value: number | undefined, total: number): number {
  if (value === undefined || total === 0) return 0;
  return Math.round((value / total) * 100);
}

function Bar(props: {
  readonly label: string;
  readonly value: number | undefined;
  readonly percent: number;
  readonly accent: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3, 12px)' }}>
      <span style={{ inlineSize: '2.5rem', color: 'var(--ink-soft, #55524e)' }}>{props.label}</span>
      <span
        aria-hidden="true"
        style={{
          flex: 1,
          blockSize: '8px',
          borderRadius: '999px',
          background: 'var(--surface-active, #ebe8e4)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            blockSize: '100%',
            inlineSize: `${props.percent}%`,
            background: props.accent ? 'var(--accent, #1f5ae8)' : 'var(--ink-muted, #6f6c68)',
            transition: 'inline-size 180ms ease',
          }}
        />
      </span>
      <output
        style={{
          minInlineSize: '2ch',
          textAlign: 'end',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
        }}
      >
        {props.value ?? '—'}
      </output>
    </div>
  );
}

export function VoteTally(context: LocalComponentContext) {
  const label = textProp(context, 'label', '实时计票');
  const channel = textProp(context, 'channel', 'results');
  const { active, supported, counts, phase, problem } = useResults(context, channel);
  const total = counts === null ? 0 : counts.yes + counts.no;
  const status = statusLabel(active, supported, phase, problem);

  return (
    <section
      className="md-panel"
      data-survey-tally
      data-survey-support={supported ? 'true' : 'false'}
      data-survey-active={active ? 'true' : 'false'}
      data-survey-phase={phase}
      data-survey-yes={counts?.yes ?? ''}
      data-survey-no={counts?.no ?? ''}
      aria-label={label}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3, 12px)' }}>
        <h3 className="md-panel-title">{label}</h3>
        <span className={`md-badge md-badge-${statusTone(active, problem, phase)}`} data-survey-status>
          {status}
        </span>
      </div>
      <div aria-live="polite" style={{ display: 'grid', gap: 'var(--space-2, 8px)' }}>
        <Bar label="会来" value={counts?.yes} percent={share(counts?.yes, total)} accent />
        <Bar label="不来" value={counts?.no} percent={share(counts?.no, total)} accent={false} />
      </div>
      <p style={{ margin: 0, color: 'var(--ink-muted, #6f6c68)', fontSize: 'var(--text-sm, 14px)' }}>
        {counts === null ? '等待第一条统计。' : `共 ${total} 份回答。`}
      </p>
    </section>
  );
}

export function VoteTallyStatic(context: LocalComponentContext) {
  return (
    <section className="md-panel" data-survey-tally-static>
      <h3 className="md-panel-title">{textProp(context, 'label', '实时计票')}</h3>
      <p>{context.locale.t('Live counts appear after the page loads.', '页面加载后显示实时计票。')}</p>
    </section>
  );
}

export function VoteFeed(context: LocalComponentContext) {
  const label = textProp(context, 'label', '计票明细');
  const channel = textProp(context, 'channel', 'results');
  const network = context.services.network;
  const visible = context.visible;
  const supported = network !== undefined && network.supports(channel, 'subscribe');
  const active = visible && supported;
  const [entries, setEntries] = useState<readonly string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || network === undefined || !network.supports(channel, 'subscribe')) return;
    let seen = 0;
    let last: Counts | null = null;
    setProblem(null);
    return network.subscribe(channel, (event) => {
      if (event.type === 'status') {
        setPhase(event.state);
        if (event.state === 'open') setProblem(null);
        return;
      }
      if (event.type === 'error') {
        setProblem(event.error.message);
        return;
      }
      const next = readCounts(event.value);
      if (next === null) return;
      // The host may resend an unchanged snapshot; log actual changes only.
      if (last !== null && last.yes === next.yes && last.no === next.no) return;
      last = next;
      seen += 1;
      setEntries((previous) => [
        `第 ${seen} 次变化：会来 ${next.yes} · 不来 ${next.no}`,
        ...previous,
      ].slice(0, 4));
    });
  }, [network, channel, visible]);

  const status = statusLabel(active, supported, phase, problem);

  return (
    <section
      className="md-panel"
      data-survey-feed
      data-survey-active={active ? 'true' : 'false'}
      data-survey-phase={phase}
      aria-label={label}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3, 12px)' }}>
        <h3 className="md-panel-title">{label}</h3>
        <span className={`md-badge md-badge-${statusTone(active, problem, phase)}`} data-survey-status>
          {status}
        </span>
      </div>
      {entries.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--ink-muted, #6f6c68)' }}>还没有收到消息。</p>
      ) : (
        <ol style={{ margin: 0, paddingInlineStart: '1.25rem', display: 'grid', gap: 'var(--space-1, 4px)' }}>
          {entries.map((entry, index) => (
            <li key={`${entry}-${index}`}>{entry}</li>
          ))}
        </ol>
      )}
      <p style={{ margin: 0, color: 'var(--ink-muted, #6f6c68)', fontSize: 'var(--text-sm, 14px)' }}>
        与实时计票共用同一条通道连接，按收到顺序记录变化。
      </p>
    </section>
  );
}

export function VoteFeedStatic(context: LocalComponentContext) {
  return (
    <section className="md-panel" data-survey-feed-static>
      <h3 className="md-panel-title">{textProp(context, 'label', '计票明细')}</h3>
      <p>{context.locale.t('Counts appear after the page loads.', '页面加载后显示计票明细。')}</p>
    </section>
  );
}

export const voteTally = defineLocalComponent({
  id: 'example/network-survey-tally',
  name: 'vote-tally',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    channel: { kind: 'string', default: 'results' },
    label: { kind: 'string', default: '实时计票' },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Survey tally', zh: '问卷计票' },
    description: {
      en: 'Subscribes to a named results channel and draws two bars.',
      zh: '订阅命名结果通道并绘制两条统计条。',
    },
    category: 'feedback',
    insertText: '<vote-tally channel="results" label="实时计票">',
  },
});

export const voteFeed = defineLocalComponent({
  id: 'example/network-survey-feed',
  name: 'vote-feed',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    channel: { kind: 'string', default: 'results' },
    label: { kind: 'string', default: '计票明细' },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Survey breakdown', zh: '计票明细' },
    description: {
      en: 'Subscribes to the same results channel and lists each change.',
      zh: '订阅同一结果通道并列出每次计数变化。',
    },
    category: 'feedback',
    insertText: '<vote-feed channel="results" label="计票明细">',
  },
});

const tallyImplementation = defineReactComponent(voteTally, {
  render: VoteTally,
  renderStatic: VoteTallyStatic,
});

const feedImplementation = defineReactComponent(voteFeed, {
  render: VoteFeed,
  renderStatic: VoteFeedStatic,
});

/**
 * One host composes the minimal preset, the official network plugin and these
 * two components. The plugin supplies `<submit-button>`; neither custom
 * component declares an endpoint or a transport.
 */
const host = createReactHost({
  presets: [minimalReactPresetPackage, networkPreset],
  components: [tallyImplementation, feedImplementation],
});

export const config = host.config;
export const reactConfig = host.reactConfig;
/** Preset styles (the submit button) from the same host the page renders with. */
export const hostCss = host.css;
