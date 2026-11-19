import { useSyncExternalStore, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react/minimal';
import 'reactive-md/styles.css';
import { hostCss, reactConfig } from './components';
import { surveyHost } from './host';
import { source } from './source';

// Preset styles (the network plugin's button) come from the same host object.
const styles = document.createElement('style');
styles.dataset.surveyPresetStyles = '';
styles.textContent = hostCss;
document.head.appendChild(styles);

const subscribeLedger = (listener: () => void): (() => void) => surveyHost.subscribe(listener);

/** Shows the adapter's connection lifecycle as the two components are hidden or shown. */
function HostLedger() {
  const stats = useSyncExternalStore(subscribeLedger, () => surveyHost.stats);
  return (
    <section className="survey-host-ledger" aria-label="宿主连接记录">
      <h2>宿主连接记录</h2>
      <dl>
        <div><dt>传输</dt><dd>{surveyHost.name}</dd></div>
        <div><dt>点击提交</dt><dd data-ledger-submits>{stats.submits}</dd></div>
        <div><dt>已确认</dt><dd data-ledger-accepted>{stats.accepted}</dd></div>
        <div><dt>明确拒绝</dt><dd data-ledger-rejected>{stats.rejected}</dd></div>
        <div><dt>通道打开</dt><dd data-ledger-opens>{stats.streamOpens}</dd></div>
        <div><dt>通道释放</dt><dd data-ledger-releases>{stats.streamReleases}</dd></div>
        <div><dt>当前连接</dt><dd data-ledger-live>{stats.liveStreams}</dd></div>
        {stats.lastError === null ? null : (
          <div><dt>最近错误</dt><dd data-ledger-error>{stats.lastError}</dd></div>
        )}
      </dl>
      <p>
        两个计票组件与正文共用一条连接。关闭实时更新可释放这条连接。
      </p>
    </section>
  );
}

function Page() {
  const [tally, setTally] = useState(true);
  const [feed, setFeed] = useState(true);
  const [live, setLive] = useState(true);
  return (
    <>
      <h1 className="survey-page-title">Reactive MD 命名通道问卷</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={live} onChange={event => setLive(event.target.checked)} />
          启用实时更新与提交
        </label>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={tally}
            onChange={(event) => setTally(event.target.checked)}
          />
          显示实时计票
        </label>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={feed}
            onChange={(event) => setFeed(event.target.checked)}
          />
          显示计票明细
        </label>
        {surveyHost.reset === undefined ? null : (
          <button type="button" onClick={() => surveyHost.reset?.()} data-reset-counts>
            清空内存计数
          </button>
        )}
      </div>
      <LocalReactiveDocument
        source={source}
        externalValues={{ showTally: tally, showFeed: feed, votesReady: false, votesYes: 0, votesNo: 0 }}
        reactConfig={reactConfig}
        network={live ? surveyHost.network : undefined}
        documentId="network-survey"
        locale="zh"
      />
      <HostLedger />
    </>
  );
}

const host = document.getElementById('app');
if (!host) throw new Error('页面缺少 #app。');
createRoot(host).render(<Page />);
