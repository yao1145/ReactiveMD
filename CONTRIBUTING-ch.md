# 贡献指南

Reactive MD 是 `local-draft-2` 的 0.x 预览实现。贡献可以包括语法、编译器、运行时、React 渲染器、文档、示例和 Demo。开始前先读[版本与兼容性](docs/compatibility-ch.md)和[本地交互语法规范](docs/local-interaction-syntax-ch.md)。

新增或修改组块时，按[组块协议](docs/component-protocol-ch.md)明确行为，使用[开发指南中的提案模板](docs/component-development-ch.md)记录声明、兼容性和验收证据。这里的组块包括控件、容器、可视化和结构子项。

## 环境

- Node.js 22.12 或更新版本。
- 仓库使用 npm workspaces；在根目录执行 `npm ci`。
- 不提交 `node_modules/`、`dist-library/`、`demo/dist/`、`demo/artifacts/` 或 `.tasks/`。

## 开发与检查

```sh
npm ci
npm run build
npm test
npm run test:package
npm run test:packed
npm run test:docs
npm run build:demo
npm run test:demo
```

| 命令 | 覆盖内容 |
| --- | --- |
| `npm run build` | 类型检查与语言包构建 |
| `npm test` | 编译器、表达式、LaTeX、运行时和渲染器测试 |
| `npm run test:components` | 组块协议的代表性用例和已有语言验收数据；新增组块还需自己的针对性测试 |
| `npm run test:package` | 公开入口、示例可编译和样式边界；需先构建 |
| `npm run test:packed` | 真实 tarball 的独立离线安装、核心和 React 严格类型检查、CSS 导出与静态 SSR |
| `npm run notices` | 从已安装依赖生成第三方许可证清单 |
| `npm run benchmark` | Node 编译、运行时和绘图性能；报告写入 `artifacts/benchmark.json` |
| `npm run test:docs` | 文档相对链接和标题锚点 |
| `npm run build:demo`、`npm run test:demo` | Demo 构建与示例索引 |

浏览器检查需要先启动 Demo，并准备本机浏览器。默认地址是 `http://127.0.0.1:5173`，可用 `DEMO_URL` 指向其他地址；报告写入 `demo/artifacts/`。本地默认使用 Edge，CI 在 Linux 上使用 Playwright 的 Chromium（`PLAYWRIGHT_CHANNEL=chromium`）。

```sh
npm run dev
# 另一个终端
npm run test:browser
```

修改语言包后重新运行 `npm run build:lib`，或使用 `npm run dev:lib` 监听重建。

性能测量条件与当前基线见[性能说明](docs/performance-ch.md)，跨实现可复用的输入与预期结果见[语言验收数据](examples/conformance/README.md)。

## 改动要求

- 保持改动聚焦。行为变化附带测试；用户可见变化更新文档和相关示例。
- 语法或公开 API 的破坏性变化先更新[版本与兼容性](docs/compatibility-ch.md)和[变更记录](CHANGELOG-ch.md)，说明旧写法、新写法和迁移方式。不要在没有语法修订的情况下悄悄改变作者语法。
- 新组件或新属性必须同时实现编译校验、运行时约束、渲染、可访问名称和资源边界。不要只加展示样式。
- 组块提案须给出属性与子内容声明、状态与生命周期规则、诊断、资源预算、兼容分类和对应验收结果；参考 `slider`、`tabs`、`plot` 的[协议验收数据](examples/conformance/README.md)。协议修订不自动改变包版本、语法修订或公开 API。
- 资源上限集中在 `src/local/limits.ts`；新增无界输入、循环、递归或绘图计算时，先定义预算。
- 不引入网络请求、任意 HTML、事件处理器、作者 CSS 或持久化状态。这些不在当前范围内。
- 更新中文文档时保持与现有术语一致；英文 README 保持简洁，不重复工程细节。
- 不要提交凭据、`.npmrc` token 或个人路径。不要手工修改 `dist-library/`；它由构建生成。

## 提交与 PR

- PR 说明写清目的、受影响范围和验证命令及结果。没有运行的检查要明确写出，不要写成已通过。
- 涉及安全的问题不要开公开 issue，按[安全策略](SECURITY-ch.md)处理。
- 发布是维护者的手工流程，见[发布清单](docs/releasing-ch.md)。贡献者不需要接触 npm 凭据。
