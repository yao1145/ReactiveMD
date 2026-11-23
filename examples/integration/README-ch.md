# 独立集成示例

**中文** · [English](README.md)

这些目录使用包的公开入口，可以复制到仓库之外。以下命令均从当前目录开始执行。

以下多数示例面向 `reactive-md@0.6.0`。将所需的示例目录复制到仓库之外，再从 npm 安装示例固定的版本。React 和 Vite 按各示例的依赖安装。

[扩展 SDK 使用方](extension-sdk/README-ch.md)面向`reactive-md@0.8.0`，通过公开导出验证静态分享和离线交互分享。准备发布时使用本地构建的 tarball，SDK 契约仍为 `0.7.0`。其余较早的示例保留其 0.6.0 固定版本。

用当前检出运行[流式源码](streaming)示例时，按下文打包并安装 `reactive-md-0.9.2.tgz`。示例独立使用时以 `package.json` 中固定的 `0.9.1` 为基线。

## Node 核心

需要 Node.js 22.12 或更高版本。安装后，核心示例无需 React 或网络访问即可运行。

```sh
cd core
npm install reactive-md@0.6.0 --ignore-scripts --no-audit --no-fund
npm start
```

它应先输出 `People: 2, cost: 200`，然后输出 `People: 5, cost: 500`。源码在 [core/index.mjs](core/index.mjs)。

## React 页面

需要 Node.js 22.12 或更高版本。首次安装会获取 React 19 和 Vite。

```sh
cd react
npm install reactive-md@0.6.0
npm run dev
```

打开终端输出的本地 URL，调整人数并观察费用变化。示例入口是 [react/main.jsx](react/main.jsx)，库样式通过 `reactive-md/styles.css` 导入。

## Worker 编译

[worker](worker) 是一个可复制的浏览器页面，把编译放在主线程之外。它对编辑做防抖，在模块 Worker 中编译，并在 Worker 无法启动或崩溃时回退到主线程。

```sh
cd worker
npm install reactive-md@0.6.0
npm run dev
```

UI 和调度连接位于 [worker/main.js](worker/main.js)；Worker 入口是 [worker/worker.js](worker/worker.js)。

## 流式源码编译

[streaming](streaming) 是流式源码编译的确定性浏览器示例。它按定时器追加固定文本片段，用 `sourcePhase: 'streaming'` 提交每个完整快照，最后用 `sourcePhase: 'final'` 提交完成后的源码。页面展示暂态状态、暂态诊断、最终诊断和编译快照摘要。取消或重新开始会使当前轮次失效；旧轮次的结果只计入丢弃数量，不会重绘页面。示例不调用模型服务、不发起网络请求，也不持有凭据。

在仓库根目录从当前树打包 tarball，然后在示例中安装：

```sh
# 在仓库根目录
npm pack

cd examples/integration/streaming
npm install ../../../reactive-md-0.9.2.tgz
npm run dev
```

如果目录已复制到仓库之外，请改用 tarball 的绝对路径安装。示例只使用 `reactive-md` 的公开入口；调度逻辑位于 [streaming/main.js](streaming/main.js)，Worker 入口是 [streaming/worker.js](streaming/worker.js)。

## 综合宿主示例

[react-comprehensive](react-comprehensive) 在一个页面中组合了面向宿主的各项新增能力：宿主提供的汇率和库存、动态 `max="{{ inventory }}"`、与内置控件共享绑定的 `host-rating` 组块、通过 `initialParameters` 和 `onParametersChange` 保存与恢复公开参数，以及通过 `onSourceNavigate` 从预览导航到源码。

```sh
cd react-comprehensive
npm install reactive-md@0.6.0
npm run dev
```

改变汇率或库存按钮，给课程评分，点击段落或控件标签即可看到上报的源码范围。宿主 schema 与渲染器在 [react-comprehensive/main.jsx](react-comprehensive/main.jsx)。

## 本地包验证

要试用未发布的构建，在仓库根目录运行 `npm pack`，并把安装命令中的 `reactive-md@0.6.0` 替换为生成的 `reactive-md-0.6.0.tgz` 的绝对路径。

在源码仓库根目录，`npm run check` 运行完整门禁，包括从打包 tarball 进行独立离线安装、严格类型检查、组合功能检查、React 渲染和 HTML 导出。构建后可用 `npm run test:boundary` 做聚焦的包检查。API 与宿主策略见[集成指南](../../docs/integration/local-integration-ch.md)。
