# 扩展 SDK 使用方

**中文** · [English](README.md)

该 fixture 通过公开包导出定义了一个评分控件、一个 Markdown 提示容器，以及明暗纸张主题。评分控件与内置数字控件共享数值绑定。

`advanced.tsx` 增加了坐标控件、字符串集合、数字集合和 Markdown 容器。坐标、多选和卡片契约来自 `defaultPreset.components`；项目提供自己的 React 实现。其验收检查覆盖原子回滚、数组限制与复制、重置、禁用/隐藏状态、静态输出、SSR，以及离线桌面/移动端恢复。`advanced-standalone.ts` 为该项导出打包同一组已安装实现。

本 fixture 面向`reactive-md@0.8.0`，SDK 契约仍为 `0.7.0`。验证器在独立目录中安装引擎和 peer 依赖；准备发布时使用新打包的引擎 tarball，0.8.0 发布后再使用公开包。

在仓库根目录：

```powershell
npm.cmd run build:lib
npm.cmd run test:sdk-consumer
```

验证器把该项目复制到独立的临时目录，安装实际的包与 peer tarball，检查 TypeScript 和 Node SSR，构建宿主专用的独立入口，并在全新的浏览器上下文中验证静态及离线交互 HTML。它不使用源码别名或仓库依赖 junction。结果和使用方目录见 `artifacts/sdk-consumer/verification.json`。

手动开发时，在该目录的副本中安装经验证的 tarball，安装其开发依赖，然后运行 `npm run dev`。主题样式表由 `main.tsx` 显式加载。`standalone.ts` 是可信入口，用于在离线输出中恢复同一组已安装实现。

运行时不根据文档声明获取组件代码。宿主代码在挂载前导入实现。导出器在生成 HTML 前检查组件契约、能力、主题和声明的资源。

中文接口说明：[扩展 SDK 预览](../../../docs/integration/extension-sdk-ch.md)。
