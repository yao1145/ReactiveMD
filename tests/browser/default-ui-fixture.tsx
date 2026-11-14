import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { compileLocal, createLocalRuntime } from '../../src/index';
import { LocalDocumentView, LocalReactiveDocument } from '../../src/react/index';
import type { LocalRuntime } from '../../src/local/contracts/types';
import '../../src/styles.css';

const source = `<panel title="实验参数" reset="true">
<slider bind="progress" label="完成进度" initial="40" min="0" max="100">
<radio-group bind="purpose" label="用途" initial="study">
<option value="study">学习</option>
<option value="explore">探索</option>
</radio-group>
<select bind="course" label="课程类型">
<option value="lecture">理论课程</option>
<option value="lab">实验课程</option>
</select>
<date label="日期" initial="2026-11-01">
</panel>`;
const result = compileLocal(source);
if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('; '));
const document = result.document;
const runtime = createLocalRuntime(document);
declare global { interface Window { defaultUiAcceptance: { runtime: LocalRuntime } } }
window.defaultUiAcceptance = { runtime };
const paper = { name: 'paper', protocol: 'reactive-md-theme-1' as const, colorSchemes: ['light', 'dark'] as const };

function Fixture() {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [mode, setMode] = useState<'interactive' | 'static'>('interactive');
  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <button onClick={() => { runtime.setParameter('progress', 65); runtime.setParameter('purpose', 'explore'); }}>加载一组实验参数</button>
      <button onClick={() => setScheme('dark')}>切换深色</button>
      <button onClick={() => setMode('static')}>静态预览</button>
      <button onClick={() => setMode('interactive')}>返回交互</button>
    </div>
    <div id="document"><LocalDocumentView document={document} runtime={runtime} colorScheme={scheme} mode={mode} locale="zh" /></div>
    <div id="isolated-document"><LocalReactiveDocument source={'# 独立文档\n\n<counter label="独立计数">'} colorScheme="light" locale="zh" /></div>
    <div id="other-theme"><LocalReactiveDocument source={'<theme name="paper">\n\n<slider label="其他主题" initial="3">'} themes={[paper]} colorScheme={scheme} locale="zh" /></div>
  </>;
}

createRoot(window.document.getElementById('root')!).render(<Fixture />);
