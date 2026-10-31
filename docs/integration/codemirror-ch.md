# CodeMirror 6 编辑器集成

`0.7.0` 已统一使用 CM6。推荐从 [`reactive-md/editor`](editor-ch.md) 导入 `ReactiveMarkdownEditor`；本页的 `/editor/codemirror` 路径保留为同一组件的兼容别名。CM6 按视口创建源码行 DOM，使用原生历史和搜索，并提供工具栏、作者面板及视图切换。

```tsx
import { useRef, useState } from 'react';
import { ReactiveMarkdownCodeEditor, type ReactiveMarkdownCodeEditorHandle } from 'reactive-md/editor/codemirror';
import 'reactive-md/editor/codemirror/styles.css';

export function LongSourceEditor() {
  const [source, setSource] = useState('# 文档');
  const editor = useRef<ReactiveMarkdownCodeEditorHandle>(null);
  return <ReactiveMarkdownCodeEditor ref={editor} value={source} onChange={setSource}
    locale="zh" ariaLabel="文档源码" documentKey="document-1" />;
}
```

CM6 依赖随编辑器入口打包，公共类型不要求消费者安装 CodeMirror。组件可在服务端导入并渲染外框；编辑视图在客户端挂载。两条编辑器路径共用运行时代码和样式，基础文档渲染入口保持独立。

ref 支持 `focus`、`selectRange`、`insertText`、`undo`、`redo`、`getSelection`、`getSource`、`getEditorElement` 和 `getVisibleRanges`。旧版 `textareaRef`、`getTextarea` 已移除；完整源码和选区通过 ref 读取。

所有范围均为原始源码中的 UTF-16 偏移。未修改的 CRLF、LF、CR、BOM 和 emoji 会保留；原生输入的新换行使用文档第一个换行的样式。CRLF 内部的偏移映射到该换行之前。受控回传保留历史；外部替换和 `documentKey` 变化重置历史及滚动位置。宿主可延迟回传；超过 120 次未确认修改的旧回传会作为外部替换处理。待确认队列保存逆向编辑。

`onTransaction` 返回 `previousSource`、`source`、修订号、`changes`、选区和组合输入状态。`changes` 的所有范围对应 `previousSource`。多处编辑可合并为覆盖首末变化的替换，再交给 `LocalCompileScheduler.schedule(source, options, {baseSource, edit})`。提示会被验证；基线不同或提示无效时，沿用源码差分和完整请求恢复。

作者分析默认使用私有模块 Worker。宿主已有预览 Worker 时，在现有调度器生命周期启用分析：

```tsx
import { LocalCompileScheduler, localCompileOptionsKey } from 'reactive-md';

// 放入宿主已有的调度器生命周期，不要在 render 中创建。
const scheduler = new LocalCompileScheduler({
  createWorker: createCompileWorker,
  includeAuthorAnalysis: true,
  onResult(outcome) {
    setAnalysis(outcome.analysis ? {
      source: outcome.source,
      optionsKey: localCompileOptionsKey(outcome.options),
      analysis: outcome.analysis,
    } : null);
  },
});
// <ReactiveMarkdownCodeEditor analysis={analysis} ... />
```

`analysis={null}` 表示宿主结果待定，阻止创建私有 Worker；省略 `analysis` 启用私有 Worker。只接受与当前源码和选项签名一致的分析。成功编译复用同一文档及声明元数据生成作者分析；临时语义错误在 Worker 内按相同预算恢复语法高亮，预算或选项失败返回空分析。编译诊断仍通过 `diagnostics` 显示。旧 Worker 可继续编译；未提供分析时，作者面板等待支持分析的结果。

`createAnalysisWorker` 可提供符合宿主 CSP 的工厂。默认模块 Worker 无法启动时使用现有主线程编译降级。分析时间记录在 `metrics.worker.analysisMs`。编辑器只装饰可见语法范围，绑定和引用每页显示 50 项。预览由宿主提供，在视图切换时保留 DOM。

自动检查覆盖组合事件与原生文字插入；物理中文输入法、移动端键盘和辅助技术需在目标设备验收。`npm run test:codemirror-browser` 复现生产 Edge 对照。性能与边界见 [实施报告](../development/performance-overview-ch.md)。
