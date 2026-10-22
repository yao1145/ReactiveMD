# Reactive MD Playground

Playground 使用 [本地交互语法](../docs/local-interaction-syntax.md)，内置 [12 份完整示例](../examples/local/README.md)。第一次使用语法可先读 [新用户入门指南](../docs/local-guide.md)。左侧编辑 Markdown，右侧显示输入、计算结果和可视化；编译错误在诊断区按源码位置显示。

页面顶部的“使用指南”会直接渲染 `docs/local-guide.md`，包含从第一份交互文档到图表、函数曲线和错误速查的完整说明。指南中的文档链接指向仓库，目录锚点可在页内跳转。

线上演示：[yaozi.raricy.com](https://yaozi.raricy.com/)。

## 启动

在仓库根目录执行：

```sh
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。嵌入示例位于 `/embed.html`，展示两个独立的内存文档实例。语言库已构建时，可以在 `demo/` 执行 `npm run dev`。

## 示例

从计数器和费用估算开始，再试参数面板、可勾选清单、本地目录搜索、图表、LaTeX 函数曲线、交互图解与计时器。诊断示例故意含错，预览应停用交互并显示诊断。

示例源码位于根目录 `examples/local/`。Playground 通过 `reactive-md` 的 `compileLocal`、`createLocalRuntime` 和 `reactive-md/react` 的渲染入口使用库，不直接导入语言内部模块。参数由正文控件声明，表格数据直接写在 Markdown 中。

## 开发与检查

在仓库根目录执行：

| 命令 | 内容 |
| --- | --- |
| `npm run build` | 语言包与类型声明，输出 `dist-library/` |
| `npm run build:demo` | 构建语言包和应用，输出 `demo/dist/` |
| `npm run dev:lib` | 监听并重建语言包 |
| `npm test` | 语言、运行时与渲染器测试 |
| `npm run test:demo` | 构建库并检查 Playground 示例 |
| `npm run test:browser` | 新语法浏览器交互检查 |
| `npm run test:docs` | 文档本地链接与导航锚点检查 |
| `npm run test:package` | 公开包入口、示例与样式边界；需先构建 |

修改应用源码会热更新。修改语言库后，重新运行 `npm run build:lib`，或另开终端运行 `npm run dev:lib`。

浏览器检查需要本机 Edge 和已启动的服务器。默认检查 `http://127.0.0.1:5173`，可用 `DEMO_URL` 指定其他地址；报告和截图写入 `demo/artifacts/`。

## 集成

宿主应用使用 [本地模式集成](../docs/local-integration.md) 中的公开 API。
