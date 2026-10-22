# 独立集成示例

这些目录使用包的公开入口，可以复制到仓库外运行。以下命令从当前目录开始。

## Node 核心

需要 Node.js 22.12 或更新版本。核心示例无需 React，也不发起网络请求。

```sh
cd core
npm install reactive-md@0.3.0 --ignore-scripts --no-audit --no-fund
npm start
```

预期先输出 `人数：2，费用：200`，再输出 `人数：5，费用：500`。源码在 [core/index.mjs](core/index.mjs)。

## React 页面

需要 Node.js 22.12 或更新版本。第一次安装会获取 React 19 和 Vite。

```sh
cd react
npm install reactive-md@0.3.0
npm run dev
```

打开终端给出的本地地址，调整人数并观察费用变化。示例入口是 [react/main.jsx](react/main.jsx)，库样式通过 `reactive-md/styles.css` 引入。

在源代码仓库根目录执行 `npm run test:packed`，可自动验证压缩包的独立离线安装、严格类型检查和 React 静态服务端渲染。API 与宿主策略见[集成说明](../../docs/local-integration.md)。
