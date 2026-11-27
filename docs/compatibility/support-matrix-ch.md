# 支持矩阵

**中文** · [English](support-matrix-en.md)

本页定义 `reactive-md@0.9.3`、`reactive-md-editor@0.2.1` 和对应 Demo 候选的公开支持范围。配对版本见[版本与兼容性](compatibility-ch.md)。

## 支持等级

| 等级 | 定义 |
| --- | --- |
| Verified | 本页列出的版本或环境已有当前候选的通过记录。 |
| Declared | 声明范围与验收入口已确定，具体通过结果见发布证据。 |
| Unverified | 当前未验证。 |
| Not supported | 超出当前支持范围。 |

包声明的 Node 安装下限为 22.12.0。本发布线验证 Node 22.x 和 24.x 中列出的版本。React 和 Vite 的 peer 范围是安装约束，实测点列在下表。每次完整验收记录三仓来源、兼容清单摘要和单项结果，见 `artifacts/support/latest.json`。

## 支持矩阵

| 领域 | 范围 | 等级 | 检查 | 验证 |
| --- | --- | --- | --- | --- |
| `Node.js` | 22.x（最低 22.12.0） | Verified | `node-runtime` | 在 22.17.0 完成引擎全量检查。 |
| `Node.js` | 24.x | Verified | `node-runtime` | 用 24.22.2 运行发布验收。 |
| React / react-dom | peer `^19.0.0` | Verified | `react-range` | 实测 `19.3.1`。编辑器要求 React 19。 |
| Vite | `reactive-md/vite` 的可选 peer `^8.0.0` | Verified | `vite-range` | 实测 `8.3.5`。 |
| Playwright Chromium | Playwright 内置版本 | Verified | `playwright-chromium-core` | 实测 `156.0.8078.4`。可单独运行。 |
| Google Chrome | Windows 上的 Chrome 渠道 | Verified | `chrome-core` | 引擎 fixture 实测 `157.0.8103.80`。 |
| Microsoft Edge | Windows 上的 Edge 渠道 | Verified | `edge-core` | 引擎 fixture 实测 `135.0.3179.66`。 |
| Playwright Firefox | Playwright 内置版本 | Unverified | `firefox-core` | 可单独运行。 |
| Playwright WebKit | Playwright 内置版本 | Unverified | `webkit-core` | 可单独运行。Safari 实机另测。 |
| Safari | Apple 设备 | Unverified | none | 待实机验证。 |
| 桌面布局 | 桌面浏览器 | Declared | `demo-smoke` | Demo 冒烟在 Edge 下检查 1440 px。 |
| 窄屏布局 | 窄视口 | Declared | `demo-smoke` | Demo 冒烟在 Edge 下检查 390 px。 |
| SSR 静态渲染 | `react-dom/server` | Verified | `ssr-static` | 打包消费者验证服务端标记。 |
| 单文件 HTML 导出 | `reactive-md-html/v1` | Declared | `demo-smoke` | Demo 冒烟生成文件并在 Edge 离线打开。 |
| 交互式单文件 HTML 启动 | `reactive-md-html/v1` 内联运行时 | Declared | `demo-smoke` | Demo 冒烟离线操作滑块并验证内容更新。 |
| 通用 SSR 水合 | 宿主管理的 hydration | Not supported | none | 已支持的交互路径见单文件 HTML 启动。 |
| 引擎 Worker | `LocalCompileScheduler` 与 `LocalCompileWorker` | Verified | `worker-unit` | 通过 Worker 单元测试。 |
| 编辑器分析 Worker | CodeMirror 分析 Worker | Declared | `editor-pack` | 打包检查覆盖 Worker 资源及其导入。 |
| PDF | `reactive-md/pdf` | Verified | `pdf-static` | 实测内置 Chromium 与 `pdftotext`。 |
| 编辑器包 | `reactive-md-editor` 0.2.1 | Declared | `editor-pack` | peer 为 `^0.9.2`。打包验证 SSR、Worker 和 NodeNext 声明。 |
| 兼容性清单 | 三仓候选集合 | Declared | `compatibility-manifest` | 验收检查版本、建议安装组合、候选包及锁文件完整性。 |

## 验证检查

| 检查 | 配置 | 负责方 | 命令 |
| --- | --- | --- | --- |
| `node-runtime` | fast | engine | `built-in` |
| `react-range` | fast | engine | `built-in` |
| `vite-range` | fast | engine | `built-in` |
| `docs-matrix` | fast | engine | `built-in` |
| `documented-versions` | fast | engine | `node scripts/check-versions.mjs` |
| `worker-unit` | fast | engine | `npm run test -- tests/local-compile-worker.test.ts` |
| `compatibility-manifest` | release | engine | `node scripts/verify-compatibility-manifest.mjs --require-workspace` |
| `chrome-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=chrome node scripts/verify-required-form-browser.mjs` |
| `edge-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=msedge node scripts/verify-required-form-browser.mjs` |
| `ssr-static` | release | engine | `npm run test:boundary` after `npm run build` |
| `pdf-static` | release | engine | `node scripts/verify-pdf.mjs` |
| `demo-smoke` | release | demo | `cd ../ReactiveMD-Demo && PLAYWRIGHT_CHANNEL=msedge npm run test:browser:smoke` |
| `editor-pack` | release | editor | `cd ../ReactiveMD-Editor && npm run check` |
| `playwright-chromium-core` | optional | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=chromium node scripts/verify-required-form-browser.mjs` |
| `firefox-core` | optional | engine | `PLAYWRIGHT_ENGINE=firefox node scripts/verify-required-form-browser.mjs` |
| `webkit-core` | optional | engine | `PLAYWRIGHT_ENGINE=webkit node scripts/verify-required-form-browser.mjs` |

## 运行检查

```sh
npm run support:verify
npm run support:verify -- --profile release
npm run support:verify -- --profile optional
npm run compatibility:verify
npm run support:verify -- --only chrome-core
npm run support:verify -- --only edge-core
npm run support:verify -- --only playwright-chromium-core
npm run support:verify -- --only firefox-core
npm run support:verify -- --only webkit-core
npm run support:verify -- --only pdf-static
npm run support:verify -- --include-external --only demo-smoke
npm run support:verify -- --only node-runtime --out artifacts/support/node24.json
```

默认运行 `fast` 配置：内置检查、文档版本检查和 Worker 单元测试，不需要浏览器、构建产物或同级仓库。`--profile release` 运行全部 fast 检查，再追加 release 检查：兼容性清单、Chrome 与 Edge 引擎 fixture、SSR、PDF，以及 Demo 和编辑器仓库负责的外部检查。`--profile optional` 只运行未声明或需要额外下载的环境：Playwright 内置 Chromium、Firefox 与 WebKit。`--profile all` 运行全部检查。

`--only <id>` 只运行指定检查。被 `--only` 点名的检查视为显式请求：缺少外部仓库、缺少 `pdftotext` 或缺少构建产物都会记为失败，不会静默跳过。profile 运行则允许跳过无法运行的可选环境，原因写入证据。`--include-external` 在各自仓库中运行 Demo 和编辑器负责的检查；未传入时这些检查在 profile 运行中跳过，被 `--only` 点名时失败。`--out <path>` 写入指定路径，不更新 `artifacts/support/latest.json`，也不写带时间戳的归档。`--list` 列出全部检查 ID、配置、负责方和命令，不执行检查。Node 24 检查用 Node 24 的 `node` 直接运行同一脚本。

`npm run compatibility:verify` 直接检查兼容性清单，需要编辑器与 Demo 仓库存在。

## 证据

每次运行在 `artifacts/support/` 写入带时间戳的记录，并更新 `artifacts/support/latest.json`；该目录已被 Git 忽略。记录使用 `reactive-md-support-evidence/v2` schema，包含：

- 引擎、编辑器和 Demo 的包名、版本、来源 commit 与未提交标记，兼容性清单的路径、schema 与 SHA256，运行时间、配置、包名与版本。
- `environment`：`node`（完整版本）、`nodeLine`（主版本）、`nodeLineDeclared`（是否为声明的 22.x 或 24.x）、`platform`、`arch`、`playwrightChannel`。
- 每项检查的 `id`、`label`、`owner`、`profile`、`status`（`pass`、`fail` 或 `skip`）、`durationMs`、`command`、`env`、`cwd` 与跳过或失败原因。
- `node-runtime` 的 `details`：`required`、`actual`、`line`、`declaredLine`、平台与架构。
- 浏览器检查的 `details.browser`：`report`（fixture 报告路径）、`requestedChannel`、`browserName`、`browserVersion`、`status`。浏览器 fixture 在 launch 后从驱动读取实际版本，因此证据包含真实浏览器版本和渠道，而不只是请求的渠道。

只有当前候选存在通过记录时，对应行才保持 Verified。发布记录引用发布运行生成的证据摘要。

## 维护

- 支持的运行时、peer 范围或环境变化时更新本矩阵，并在同一次修改中同步中英文版本。
- 包版本、协议修订、Demo 候选包或推荐安装范围变化时，更新 `compatibility-manifest.json`。
- `npm run check:versions` 检查兼容性页面的包版本和矩阵发布线与 `package.json` 一致。
- 发布前运行 `npm run support:verify -- --profile release`；需要覆盖未声明浏览器时另跑 `--profile optional`。
- 只有当前候选的通过记录才能把行标为 Verified；部分运行、失败或跳过的运行不改变等级。历史记录留在“最近记录”列，不随候选更新覆盖。
- 外部检查在各自所属仓库运行。
- 保持检查 ID 稳定。`docs-matrix` 检查两份文档是否都包含全部 ID。
